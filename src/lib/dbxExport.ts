import type { DxfSettings } from "../components/DxfExportSettings"
import type { DbxJob, DbxPrepared } from "./leicaDbx"
import { createPointDxf } from "./pointDxf"
import { jobXmlDxfPoints } from "./jobXmlExport"

export function dbxDxf(prepared: DbxPrepared, settings: DxfSettings, mode: "3d" | "2d") {
  const metadata = `SurveyTool DBX; Grid=${prepared.grid}; Height datum=${prepared.heightDatum}; ${prepared.conversion}; ${mode === "2d" ? "Drawing Z=0; height labels retain output RLs" : "3D output RLs"}`.replace(/[\r\n]+/g, " ")
  return `999\r\n${metadata}\r\n` + createPointDxf(jobXmlDxfPoints(prepared.points, mode), settings, { metres: true, flatten: mode === "2d" })
}
export function dbxPointCsv(job: DbxJob, prepared: DbxPrepared) {
  const source = new Map(job.records.map((p) => [String(p.recordId), p]))
  const cell = (value: string | number) => {
    let text = String(value)
    if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = "'" + text
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const rows: Array<Array<string | number>> = [["Point ID", "Easting", "Northing", "Output RL", "Code", "Height datum", "Grid", "Source first", "Source second", "Source height", "Source coordinates", "Stored class", "DBX record"]]
  for (const p of prepared.points) {
    const r = source.get(p.recordId)!
    rows.push([p.id, p.easting, p.northing, p.elevation!, p.code, prepared.heightDatum, prepared.grid, r.first, r.second, r.height, r.type === "geographic" ? "Latitude / longitude (radians); ellipsoidal height (m)" : "North / East / stored RL (m)", r.coordinateClass, r.recordId])
  }
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n"
}
