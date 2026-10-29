import type { SurveyPoint } from "./surveyPointFile"
import {
  transformCoordinate,
} from "./nzCoordinates"
import type {
  CoordinateReferenceSystem,
} from "./nzCoordinates"
import type { MapCrs } from "./mapCoordinates"
import { crsUnitScale, isGeographicCrs } from "./mapCoordinates"
import { createGlobalCoordinateTransform } from "./globalGis"

export type PointCoordinateSystem = CoordinateReferenceSystem | MapCrs
const wgs84: MapCrs = { code: "EPSG:4326", name: "WGS 84", proj4: "+proj=longlat +datum=WGS84 +no_defs", area: "World.", bbox: [90, -180, -90, 180], unit: "degree" }
const geographicSystem = (crs: PointCoordinateSystem) => typeof crs === "string" ? crs === "EPSG:4167" : isGeographicCrs(crs)

export type SurveyOutputFormat =
  | "CSV"
  | "TXT"
  | "DXF"
  | "KML"
  | "GEOJSON"

export type ConvertedSurveyPoint = SurveyPoint & {
  sourceEasting: number
  sourceNorthing: number
}

export function transformSurveyPoints(
  points: SurveyPoint[],
  source: PointCoordinateSystem,
  target: PointCoordinateSystem,
): ConvertedSurveyPoint[] {
  if (typeof source !== "string" && typeof target !== "string") {
    const convert = createGlobalCoordinateTransform(source, target)
    return points.map((point) => ({ ...point, ...convert(point), sourceEasting: point.easting, sourceNorthing: point.northing }))
  }
  if (typeof source !== "string" || typeof target !== "string") throw new Error("Load both coordinate-system definitions before converting points.")
  return points.map((point) => {
    const transformed = transformCoordinate(
      { x: point.easting, y: point.northing },
      source,
      target,
    )

    return {
      ...point,
      sourceEasting: point.easting,
      sourceNorthing: point.northing,
      easting: transformed.x,
      northing: transformed.y,
    }
  })
}

function csvValue(value: string | number) {
  const text = String(value)
  return /[",\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text
}

function xmlValue(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function dxfText(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim()
}

export function createCsv(
  points: SurveyPoint[],
  target: PointCoordinateSystem,
) {
  const geographic = geographicSystem(target)
  const rows = [
    [
      "Point ID",
      geographic ? "Longitude" : "Easting",
      geographic ? "Latitude" : "Northing",
      "Elevation",
      "Code",
    ],
    ...points.map((point) => [
      point.id,
      point.easting.toFixed(geographic ? 9 : 4),
      point.northing.toFixed(geographic ? 9 : 4),
      point.elevation.toFixed(4),
      point.code,
    ]),
  ]

  return `${rows.map((row) => row.map(csvValue).join(",")).join("\r\n")}\r\n`
}

export function createTxt(
  points: SurveyPoint[],
  target: PointCoordinateSystem,
) {
  const geographic = geographicSystem(target)
  const rows = [
    [
      "Point ID",
      geographic ? "Longitude" : "Easting",
      geographic ? "Latitude" : "Northing",
      "Elevation",
      "Code",
    ],
    ...points.map((point) => [
      point.id,
      point.easting.toFixed(geographic ? 9 : 4),
      point.northing.toFixed(geographic ? 9 : 4),
      point.elevation.toFixed(4),
      point.code.replace(/[\t\r\n]+/g, " "),
    ]),
  ]

  return `${rows.map((row) => row.join("\t")).join("\r\n")}\r\n`
}

export function createDxf(points: SurveyPoint[]) {
  const lines: string[] = []
  const add = (code: number, value: string | number) => {
    lines.push(String(code), String(value))
  }

  add(0, "SECTION")
  add(2, "HEADER")
  add(9, "$ACADVER")
  add(1, "AC1009")
  add(0, "ENDSEC")
  add(0, "SECTION")
  add(2, "TABLES")
  add(0, "TABLE")
  add(2, "LAYER")
  add(70, 1)
  add(0, "LAYER")
  add(2, "SURVEY_POINTS")
  add(70, 0)
  add(62, 7)
  add(6, "CONTINUOUS")
  add(0, "ENDTAB")
  add(0, "ENDSEC")
  add(0, "SECTION")
  add(2, "ENTITIES")

  points.forEach((point) => {
    add(0, "POINT")
    add(8, point.code.trim() || "SURVEY_POINTS")
    add(10, point.easting)
    add(20, point.northing)
    add(30, point.elevation)

    add(0, "TEXT")
    add(8, point.code.trim() || "SURVEY_POINTS")
    add(10, point.easting + 0.25)
    add(20, point.northing + 0.25)
    add(30, point.elevation)
    add(40, 0.3)
    add(1, dxfText(point.id))
    add(7, "STANDARD")
  })

  add(0, "ENDSEC")
  add(0, "EOF")
  return `${lines.join("\r\n")}\r\n`
}

function geographicPoints(
  points: SurveyPoint[],
  coordinateSystem: PointCoordinateSystem,
) {
  if (typeof coordinateSystem !== "string") return transformSurveyPoints(points, coordinateSystem, wgs84)
  return coordinateSystem === "EPSG:4167"
    ? points
    : transformSurveyPoints(points, coordinateSystem, "EPSG:4167")
}

export function createKml(
  points: SurveyPoint[],
  coordinateSystem: PointCoordinateSystem,
) {
  const geographic = geographicPoints(points, coordinateSystem)
  const placemarks = geographic.map((point) => `
    <Placemark>
      <name>${xmlValue(point.id)}</name>
      <description>${xmlValue(point.code || "Survey point")}</description>
      <ExtendedData>
        <Data name="code"><value>${xmlValue(point.code)}</value></Data>
        <Data name="elevation"><value>${point.elevation.toFixed(4)}</value></Data>
      </ExtendedData>
      <Point><coordinates>${point.easting.toFixed(9)},${point.northing.toFixed(9)},${point.elevation.toFixed(4)}</coordinates></Point>
    </Placemark>`)

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>SurveyTool points</name>${placemarks.join("")}
  </Document>
</kml>
`
}

export function createGeoJson(
  points: SurveyPoint[],
  coordinateSystem: PointCoordinateSystem,
) {
  const geographic = geographicPoints(points, coordinateSystem)

  return `${JSON.stringify(
    {
      type: "FeatureCollection",
      name: "SurveyTool points",
      features: geographic.map((point) => ({
        type: "Feature",
        properties: {
          pointId: point.id,
          code: point.code,
          elevation: point.elevation,
        },
        geometry: {
          type: "Point",
          coordinates: [
            Number(point.easting.toFixed(9)),
            Number(point.northing.toFixed(9)),
            Number(point.elevation.toFixed(4)),
          ],
        },
      })),
    },
    null,
    2,
  )}\n`
}

export function createSurveyOutput(
  points: SurveyPoint[],
  coordinateSystem: PointCoordinateSystem,
  format: SurveyOutputFormat,
) {
  switch (format) {
    case "CSV":
      return {
        content: createCsv(points, coordinateSystem),
        extension: "csv",
        mimeType: "text/csv;charset=utf-8",
      }
    case "TXT":
      return {
        content: createTxt(points, coordinateSystem),
        extension: "txt",
        mimeType: "text/plain;charset=utf-8",
      }
    case "DXF":
      if (geographicSystem(coordinateSystem) || (typeof coordinateSystem !== "string" && crsUnitScale(coordinateSystem) !== 1)) {
        throw new Error("DXF export requires a projected coordinate system in metres.")
      }
      return {
        content: createDxf(points),
        extension: "dxf",
        mimeType: "application/dxf;charset=utf-8",
      }
    case "KML":
      return {
        content: createKml(points, coordinateSystem),
        extension: "kml",
        mimeType: "application/vnd.google-earth.kml+xml;charset=utf-8",
      }
    case "GEOJSON":
      return {
        content: createGeoJson(points, coordinateSystem),
        extension: "geojson",
        mimeType: "application/geo+json;charset=utf-8",
      }
  }
}
