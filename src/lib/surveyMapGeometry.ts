import proj4 from "proj4"
import Feature from "ol/Feature.js"
import Polygon from "ol/geom/Polygon.js"
import LineString from "ol/geom/LineString.js"
import Point from "ol/geom/Point.js"
import type Geometry from "ol/geom/Geometry.js"
import { createEmpty, extendCoordinate } from "ol/extent.js"
import type { LandXmlDocument, PlanPoint } from "./landxml"
import type { MapCrs } from "./mapCoordinates"
import type { SurfaceComparison } from "./surfaceCompare"
import { mapInputUnitError } from "./surfaceMapAnalysis"
import { angularDegreesPerUnit } from "./globalGis"

export const maximumMapFaces = 5000
const maximumMapPoints = 2000

export function createMapTransform(crs: MapCrs) {
  if (/\+nadgrids=(?!@null(?:\s|$))/.test(crs.proj4)) throw new Error("This CRS needs a datum grid that is not included in the browser map. Use plan view, or export the file to a supported CRS.")
  const geographic = proj4(crs.proj4, "EPSG:4326")
  const mercator = proj4("EPSG:4326", "EPSG:3857")
  const angularScale = angularDegreesPerUnit(crs)
  return (easting: number, northing: number): [number, number] => {
    const [longitude, latitude] = geographic.forward([easting * angularScale, northing * angularScale])
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180.000001 || Math.abs(latitude) > 85.05112878) {
      throw new Error("These coordinates cannot be placed on the background map. Check the source CRS. Areas beyond 85° latitude remain available in plan view.")
    }
    return mercator.forward([longitude, latitude]) as [number, number]
  }
}

export function validateMapLocation(crs: MapCrs, easting: number, northing: number) {
  const angularScale = angularDegreesPerUnit(crs)
  const [longitude, latitude] = proj4(crs.proj4, "EPSG:4326", [easting * angularScale, northing * angularScale])
  const box = crs.bbox
  if (!box) return
  const [north, west, south, east] = box
  const longitudeFits = west > east ? longitude >= west - 1 || longitude <= east + 1 : longitude >= west - 1 && longitude <= east + 1
  if (!longitudeFits || latitude < south - 1 || latitude > north + 1) throw new Error(`The surface falls outside the area of use for ${crs.code}. Check the coordinate system before placing it on a map.`)
}

export type SurveyMapData = {
  features: Feature<Geometry>[]
  extent: number[]
  groups: Array<{ id: string; label: string; colour: string }>
  note: string
}

export function buildSurveyMapData(crs: MapCrs, document?: LandXmlDocument, comparison?: SurfaceComparison): SurveyMapData {
  if (document) {
    const unitError = mapInputUnitError(document, crs)
    if (unitError) throw new Error(unitError)
  }
  const project = createMapTransform(crs)
  const features: Feature<Geometry>[] = []
  const extent = createEmpty()
  const groups: SurveyMapData["groups"] = []
  const colours = ["#22d3ee", "#60a5fa", "#a78bfa", "#34d399", "#f472b6"]
  let firstPoint: [number, number] | null = null
  function coordinate(easting: number, northing: number) {
    firstPoint ??= [easting, northing]
    const point = project(easting, northing)
    extendCoordinate(extent, point)
    return point
  }
  const pointCoordinate = (point: PlanPoint) => coordinate(point.easting, point.northing)

  if (comparison) {
    groups.push({ id: "difference", label: "Cut / fill", colour: "#22d3ee" })
    const half = comparison.cellSize / 2
    const maximum = Math.max(Math.abs(comparison.minDifference), Math.abs(comparison.maxDifference), 0.001)
    comparison.cells.forEach((cell) => {
      const ring = [
        coordinate(cell.easting - half, cell.northing - half),
        coordinate(cell.easting + half, cell.northing - half),
        coordinate(cell.easting + half, cell.northing + half),
        coordinate(cell.easting - half, cell.northing + half),
      ]
      ring.push(ring[0])
      features.push(new Feature({ geometry: new Polygon([ring]), group: "difference", name: "Surface difference", easting: cell.easting, northing: cell.northing, difference: cell.difference, intensity: Math.round(Math.min(1, Math.abs(cell.difference) / maximum) * 30) }))
    })
  }

  let totalFaces = 0
  let displayedFaces = 0
  if (document) {
    totalFaces = document.surfaces.reduce((sum, surface) => sum + surface.faces.length, 0)
    const faceStep = Math.max(1, Math.ceil(totalFaces / maximumMapFaces))
    document.surfaces.forEach((surface, surfaceIndex) => {
      const group = `surface-${surfaceIndex}`
      const colour = colours[surfaceIndex % colours.length]
      groups.push({ id: group, label: surface.name, colour })
      // Bounds include all TIN vertices, even when mesh drawing is sampled.
      const points = Object.values(surface.points)
      if (points.length) {
        let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity
        for (const point of points) {
          minE = Math.min(minE, point.easting); maxE = Math.max(maxE, point.easting)
          minN = Math.min(minN, point.northing); maxN = Math.max(maxN, point.northing)
        }
        for (let step = 0; step <= 8; step += 1) {
          const easting = minE + (maxE - minE) * step / 8
          const northing = minN + (maxN - minN) * step / 8
          coordinate(easting, minN); coordinate(easting, maxN)
          coordinate(minE, northing); coordinate(maxE, northing)
        }
      }
      for (let index = 0; index < surface.faces.length; index += faceStep) {
        const vertices = surface.faces[index].map((id) => surface.points[id])
        if (vertices.some((point) => !point)) continue
        const ring = vertices.map(pointCoordinate)
        ring.push(ring[0])
        const elevation = vertices.every((point) => point.elevation !== null) ? vertices.reduce((sum, point) => sum + (point.elevation ?? 0), 0) / 3 : null
        features.push(new Feature({ geometry: new Polygon([ring]), group, colour, name: surface.name, easting: vertices.reduce((sum, point) => sum + point.easting, 0) / 3, northing: vertices.reduce((sum, point) => sum + point.northing, 0) / 3, elevation, coordinateLabel: "Face centre" }))
        displayedFaces += 1
      }
      if (!surface.faces.length) {
        const values = Object.values(surface.points)
        const step = Math.max(1, Math.ceil(values.length / maximumMapPoints))
        for (let index = 0; index < values.length; index += step) {
          const point = values[index]
          features.push(new Feature({ geometry: new Point(pointCoordinate(point)), group, colour, name: surface.name, ...point }))
        }
      }
    })
    if (document.alignments.length) groups.push({ id: "alignments", label: "Alignments", colour: "#fbbf24" })
    document.alignments.forEach((alignment) => {
      if (alignment.points.length < 2) return
      features.push(new Feature({ geometry: new LineString(alignment.points.map(pointCoordinate)), group: "alignments", colour: "#fbbf24", name: alignment.name }))
    })
    if (document.cogoPoints.length) groups.push({ id: "points", label: "COGO points", colour: "#f8fafc" })
    const pointStep = Math.max(1, Math.ceil(document.cogoPoints.length / maximumMapPoints))
    for (let index = 0; index < document.cogoPoints.length; index += pointStep) {
      const point = document.cogoPoints[index]
      features.push(new Feature({ geometry: new Point(pointCoordinate(point)), group: "points", colour: "#f8fafc", ...point }))
    }
  }
  if (!features.length || !firstPoint) throw new Error("There is no supported geometry to show on the map.")
  validateMapLocation(crs, firstPoint[0], firstPoint[1])
  return {
    features, extent, groups,
    note: totalFaces > displayedFaces ? `Mesh preview: ${displayedFaces.toLocaleString()} of ${totalFaces.toLocaleString()} triangles. Original surface data is retained.` : "",
  }
}
