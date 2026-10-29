import proj4 from "proj4"
import { isGeographicCrs } from "./mapCoordinates"
import type { Basemap, MapCrs } from "./mapCoordinates"
import type { SurveyGeometryLayer, SurveyVertex } from "./surveyGeometry"

export function canonicalCrsDefinition(crs: MapCrs): string {
  if (crs.note && !crs.canonicalProj4) throw new Error("The CRS catalogue has changed. Reload the page before converting GIS data.")
  return crs.canonicalProj4 ?? crs.proj4
}

export function angularDegreesPerUnit(crs: MapCrs) {
  if (!isGeographicCrs(crs)) return 1
  const unit = crs.unit.toLowerCase()
  if (unit.includes("grad") || unit === "gon") return 0.9
  if (unit.includes("radian")) return 180 / Math.PI
  if (unit.includes("degree")) return 1
  throw new Error(`The angular units for ${crs.code} are not supported for reprojection.`)
}

export function transformGlobalSurveyGeometry(layer: SurveyGeometryLayer, source: MapCrs, target: MapCrs): SurveyGeometryLayer {
  const sameCrs = source.code === target.code
  let converter: proj4.Converter | null = null
  const sourceFactor = angularDegreesPerUnit(source)
  const targetFactor = angularDegreesPerUnit(target)
  try {
    if (!sameCrs) converter = proj4(canonicalCrsDefinition(source), canonicalCrsDefinition(target))
  } catch {
    throw new Error(`The ${source.code} → ${target.code} projection is not supported in this browser. Keep the source CRS or reproject the file in GIS software.`)
  }

  function transform(vertex: SurveyVertex): SurveyVertex {
    if (![vertex.easting, vertex.northing, vertex.elevation].every(Number.isFinite)) throw new Error("The file contains a non-finite coordinate. Correct it before exporting.")
    const input: [number, number] = [vertex.easting * sourceFactor, vertex.northing * sourceFactor]
    if (isGeographicCrs(source) && (Math.abs(input[0]) > 180.000001 || Math.abs(input[1]) > 90.000001)) throw new Error("The input coordinates are outside the longitude/latitude range. Check the source CRS and X/Y column order.")
    if (sameCrs) return { ...vertex }
    let result: number[] | undefined
    try { result = converter!.forward(input) }
    catch { result = undefined }
    if (!result || !Number.isFinite(result[0]) || !Number.isFinite(result[1])) {
      const needsGrid = /\+nadgrids=(?!@null(?:\s|$))/.test(`${canonicalCrsDefinition(source)} ${canonicalCrsDefinition(target)}`)
      if (needsGrid) throw new Error("This datum transformation requires a grid file that is not available in this browser. Keep the source CRS, or reproject the file with the required grid in GIS software. The approximate background-map transform is never used for GIS exports.")
      throw new Error(`Coordinates could not be transformed from ${source.code} to ${target.code}. Check the input CRS, units and coordinate range.`)
    }
    if (isGeographicCrs(target) && (Math.abs(result[0]) > 180.000001 || Math.abs(result[1]) > 90.000001)) throw new Error("The converted coordinates are outside the valid geographic range. Check the selected systems.")
    return { easting: result[0] / targetFactor, northing: result[1] / targetFactor, elevation: vertex.elevation }
  }

  function path(vertices: SurveyVertex[]) {
    const converted = vertices.map(transform)
    if (isGeographicCrs(target)) {
      for (let i = 1; i < converted.length; i++) {
        if (Math.abs((converted[i].easting - converted[i - 1].easting) * targetFactor) > 180) throw new Error("This line or polygon crosses the antimeridian. Split it at the date line in GIS software before exporting to geographic coordinates.")
      }
    }
    return converted
  }

  return {
    ...layer,
    points: layer.points.map((point) => ({ ...point, ...transform(point) })),
    lines: layer.lines.map((line) => ({ ...line, vertices: path(line.vertices) })),
    polygons: layer.polygons.map((polygon) => ({ ...polygon, rings: polygon.rings.map(path) })),
  }
}

export type GisPreferences = { source: string; target: string; format: "SHAPEFILE" | "GEOPACKAGE"; basemap: Basemap; opacity: number }
const defaults: GisPreferences = { source: "", target: "EPSG:4326", format: "SHAPEFILE", basemap: "street", opacity: 75 }
export function readGisPreferences(storage?: Pick<Storage, "getItem">): GisPreferences {
  try {
    const value = JSON.parse((storage ?? window.localStorage).getItem("surveytool:gis:v1") ?? "null")
    if (!value) return { ...defaults }
    return {
      source: /^EPSG:\d{4,6}$/.test(value.source) ? value.source : "",
      target: /^EPSG:\d{4,6}$/.test(value.target) ? value.target : "EPSG:4326",
      format: value.format === "GEOPACKAGE" ? "GEOPACKAGE" : "SHAPEFILE",
      basemap: ["street", "aerial", "none"].includes(value.basemap) ? value.basemap : "street",
      opacity: typeof value.opacity === "number" && Number.isFinite(value.opacity) ? Math.max(0, Math.min(100, value.opacity)) : 75,
    }
  } catch { return { ...defaults } }
}

export function saveGisPreferences(preferences: GisPreferences, storage?: Pick<Storage, "setItem">) {
  try { (storage ?? window.localStorage).setItem("surveytool:gis:v1", JSON.stringify(preferences)); return true }
  catch { return false }
}
