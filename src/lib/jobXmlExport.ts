import type { JobXmlPoint } from "./jobXml"
import type { PointDxfPoint } from "./pointDxf"

export function jobXmlDxfPoints(points: JobXmlPoint[], mode: "3d" | "2d"): PointDxfPoint[] {
  return points.filter((point) => mode === "2d" || point.elevation !== null).map((point, i) => ({ rowNumber: i + 1, pointId: point.id, easting: point.easting, northing: point.northing, elevation: point.elevation, code: point.code, valid: true }))
}

export function jobXmlPointCsv(points: JobXmlPoint[]) {
  const cell = (value: string | number | null) => {
    let text = value === null ? "" : String(value)
    if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = "'" + text
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  return "\uFEFF" + [["Point ID", "Easting", "Northing", "Elevation", "Code"], ...points.map((point) => [point.id, point.easting, point.northing, point.elevation, point.code])].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n"
}
