import Feature from "ol/Feature.js"
import Polygon from "ol/geom/Polygon.js"
import LineString from "ol/geom/LineString.js"
import Point from "ol/geom/Point.js"
import type Geometry from "ol/geom/Geometry.js"
import { createEmpty, extendCoordinate } from "ol/extent.js"
import { createMapTransform, validateMapLocation } from "./surveyMapGeometry"
import type { SurveyMapData } from "./surveyMapGeometry"
import type { MapCrs } from "./mapCoordinates"
import type { SurveyGeometryLayer, SurveyVertex } from "./surveyGeometry"

export function buildGisMapData(crs: MapCrs, layer: SurveyGeometryLayer): SurveyMapData {
  const project = createMapTransform(crs)
  const features: Feature<Geometry>[] = []
  const extent = createEmpty()
  const groups: SurveyMapData["groups"] = []
  const featureLimit = 5000
  const vertexLimit = 50000
  let drawnVertices = 0
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity
  const anchor: { point?: SurveyVertex } = {}
  function include(vertex: SurveyVertex) {
    anchor.point ??= vertex
    minE = Math.min(minE, vertex.easting); maxE = Math.max(maxE, vertex.easting)
    minN = Math.min(minN, vertex.northing); maxN = Math.max(maxN, vertex.northing)
  }
  layer.points.forEach(include)
  layer.lines.forEach((line) => line.vertices.forEach(include))
  layer.polygons.forEach((polygon) => polygon.rings.forEach((ring) => ring.forEach(include)))
  if (!anchor.point) throw new Error("There is no geometry to preview.")
  validateMapLocation(crs, anchor.point.easting, anchor.point.northing)
  for (let i = 0; i <= 8; i++) {
    const e = minE + (maxE - minE) * i / 8, n = minN + (maxN - minN) * i / 8
    for (const coordinate of [project(e, minN), project(e, maxN), project(minE, n), project(maxE, n)]) extendCoordinate(extent, coordinate)
  }
  function coordinates(vertices: SurveyVertex[]) { return vertices.map((vertex) => project(vertex.easting, vertex.northing)) }
  function canDraw(vertices: number) {
    if (features.length >= featureLimit || drawnVertices + vertices > vertexLimit) return false
    drawnVertices += vertices
    return true
  }
  const total = layer.points.length + layer.lines.length + layer.polygons.length
  if (layer.polygons.length) groups.push({ id: "gis-polygons", label: `Polygons (${layer.polygons.length.toLocaleString()})`, colour: "#60a5fa" })
  for (const polygon of layer.polygons) {
    const count = polygon.rings.reduce((sum, ring) => sum + ring.length, 0)
    if (!canDraw(count)) continue
    features.push(new Feature({ geometry: new Polygon(polygon.rings.map(coordinates)), group: "gis-polygons", colour: "#60a5fa", name: `${polygon.id}${polygon.code ? ` · ${polygon.code}` : ""}` }))
  }
  if (layer.lines.length) groups.push({ id: "gis-lines", label: `Lines (${layer.lines.length.toLocaleString()})`, colour: "#fbbf24" })
  for (const line of layer.lines) {
    if (!canDraw(line.vertices.length)) continue
    features.push(new Feature({ geometry: new LineString(coordinates(line.vertices)), group: "gis-lines", colour: "#fbbf24", name: `${line.id}${line.code ? ` · ${line.code}` : ""}` }))
  }
  if (layer.points.length) groups.push({ id: "gis-points", label: `Points (${layer.points.length.toLocaleString()})`, colour: "#22d3ee" })
  let previewIndices: number[] | null = null
  if (layer.pointColours) {
    const budget = Math.max(0, Math.min(featureLimit - features.length, vertexLimit - drawnVertices))
    const firstByGroup = new Map<string, number>()
    layer.points.forEach((point, index) => { if (!firstByGroup.has(point.code)) firstByGroup.set(point.code, index) })
    const selected = new Set(Array.from(firstByGroup.values()).slice(0, budget))
    const remaining = budget - selected.size
    if (remaining > 0) for (let i = 0; i < remaining; i++) selected.add(Math.floor(i * layer.points.length / remaining))
    previewIndices = Array.from(selected).sort((a, b) => a - b)
  }
  for (const pointIndex of previewIndices ?? layer.points.keys()) {
    const point = layer.points[pointIndex]
    if (!canDraw(1)) continue
    features.push(new Feature({ geometry: new Point(project(point.easting, point.northing)), group: layer.pointColours ? `status-${point.code}` : "gis-points", colour: layer.pointColours?.[point.code] ?? "#22d3ee", name: `${point.id}${point.code ? ` · ${point.code}` : ""}`, ...point }))
  }
  if (!features.length) throw new Error("The geometry is too large for the bounded map preview. All features remain available for export.")
  if (layer.pointColours) {
    const pointGroup = groups.findIndex((group) => group.id === "gis-points")
    if (pointGroup >= 0) groups.splice(pointGroup, 1)
    for (const [status, colour] of Object.entries(layer.pointColours)) groups.push({ id: `status-${status}`, label: status, colour })
  }
  return { features, extent, groups, note: features.length < total ? `Map preview: ${features.length.toLocaleString()} of ${total.toLocaleString()} complete features. Export retains every feature and vertex.` : "" }
}
