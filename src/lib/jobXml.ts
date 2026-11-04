import { SaxesParser } from "saxes"

export type JobXmlPoint = { id: string; recordId: string; easting: number; northing: number; elevation: number | null; code: string; method: string; classification: string }
export type JobXmlIssue = { point: string; reason: string }
export type JobXmlDocument = {
  fileName: string; jobName: string; version: string; systemName: string; gridName: string;
  points: JobXmlPoint[]; sourcePointCount: number; fieldBookPointCount: number;
  missingHeightCount: number; duplicateCount: number; omittedCount: number;
  issues: JobXmlIssue[]; warnings: string[]
}
export const maximumJobXmlBytes = 50 * 1024 * 1024
const maximumJobXmlPoints = 500_000
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const pointFields = new Set(["ID", "Name", "Code", "SurveyMethod", "Classification", "Deleted", "Grid/East", "Grid/North", "Grid/Elevation"])
const environmentFields = new Set(["SystemName", "ZoneName", "GridOrientation"])
const geometryRecords = new Set(["LineRecord", "ArcRecord", "PolylineRecord", "PolygonRecord", "GeometricFeatures", "GeometricFeature", "Polyline", "Polygon"])
function numberValue(value: string | undefined) {
  const text = value?.trim() ?? ""
  if (!numeric.test(text)) return null
  const result = Number(text)
  return Number.isFinite(result) ? result : null
}
function deleted(value: string | undefined) {
  if (!value?.trim()) return false
  if (!/^(true|false|0|1)$/i.test(value.trim())) throw new Error("An invalid Deleted flag was found in the JobXML. Review the source job.")
  return /^(true|1)$/i.test(value.trim())
}

/** Only authoritative Reductions/Point/Grid coordinates are used. JobXML stores
 * numeric coordinates in metres, independently of Environment display units.
 * Schema overview: https://github.com/KubaSzostak/JobXML/blob/master/JobXML.xsd
 * Trimble: https://help.fieldsystems.trimble.com/tbc/4107.htm
 */
export function parseJobXml(text: string, fileName = "survey.jxl"): JobXmlDocument {
  if (text.length > maximumJobXmlBytes) throw new Error("Choose a JobXML file smaller than 50 MB.")
  const parser = new SaxesParser({ xmlns: true })
  const frames: Array<{ name: string; text: string; capture: boolean }> = []
  const candidates: Array<{ values: Record<string, string>; index: number }> = []
  const deletedRecords = new Set<string>()
  const environment: Record<string, string> = {}
  let candidate: Record<string, string> | null = null
  let recordId = "", recordDeleted = false, rootSeen = false
  let version = "", jobName = "", sourcePointCount = 0, fieldBookPointCount = 0, unsupportedGeometry = 0
  const attribute = (attributes: Record<string, { value: string; local: string }>, name: string) => Object.values(attributes).find((item) => item.local === name)?.value ?? ""
  parser.on("doctype", () => { throw new Error("JobXML files containing a document type declaration are not supported.") })
  parser.on("error", (error) => { throw new Error(`Invalid JobXML: ${error.message}`) })
  parser.on("opentag", (tag) => {
    const name = tag.local
    if (frames.length > 64) throw new Error("The XML nesting is too deep for a JobXML survey file.")
    if (frames.length === 0) {
      if (name !== "JOBFile") throw new Error("This is not a Trimble JobXML file. Choose a .jxl with a JOBFile root element.")
      rootSeen = true
      version = attribute(tag.attributes, "version")
      jobName = attribute(tag.attributes, "jobName")
      if (!/^[56](?:\.\d+)?$/.test(version)) throw new Error(`JobXML version ${version || "unknown"} is not yet supported. Use a JobXML 5.x or 6.x file.`)
    }
    const path = [...frames.map((frame) => frame.name), name].join("/")
    if (path === "JOBFile/Reductions/Point") {
      if (++sourcePointCount > maximumJobXmlPoints) throw new Error("This job has more than 500,000 reduced points. Export a smaller job.")
      candidate = {}
    }
    if (path === "JOBFile/FieldBook/PointRecord") {
      if (++fieldBookPointCount > 1_000_000) throw new Error("This job has more than 1,000,000 field-book point records. Export a smaller job.")
      recordId = attribute(tag.attributes, "ID"); recordDeleted = false
    }
    if (geometryRecords.has(name)) unsupportedGeometry++
    const reducedField = path.startsWith("JOBFile/Reductions/Point/") ? path.slice("JOBFile/Reductions/Point/".length) : ""
    const environmentField = path.startsWith("JOBFile/Environment/CoordinateSystem/") && environmentFields.has(name)
    frames.push({ name, text: "", capture: pointFields.has(reducedField) || Boolean(environmentField) || path === "JOBFile/FieldBook/PointRecord/Deleted" })
  })
  const appendText = (value: string) => {
    const frame = frames.at(-1)
    if (frame?.capture) {
      frame.text += value
      if (frame.text.length > 16_384) throw new Error("A JobXML point name, code or coordinate field is too long.")
    }
  }
  parser.on("text", appendText); parser.on("cdata", appendText)
  parser.on("closetag", () => {
    const path = frames.map((frame) => frame.name).join("/"), frame = frames.at(-1)!
    if (frame.capture) {
      const value = frame.text.trim()
      if (path.startsWith("JOBFile/Reductions/Point/") && candidate) candidate[path.slice("JOBFile/Reductions/Point/".length)] = value
      else if (path === "JOBFile/FieldBook/PointRecord/Deleted") recordDeleted = deleted(value)
      else if (path.startsWith("JOBFile/Environment/CoordinateSystem/")) {
        if (environment[frame.name] && environment[frame.name] !== value) throw new Error(`Conflicting ${frame.name} definitions in the job coordinate system.`)
        environment[frame.name] = value
      }
    }
    if (path === "JOBFile/Reductions/Point" && candidate) { candidates.push({ values: candidate, index: sourcePointCount }); candidate = null }
    if (path === "JOBFile/FieldBook/PointRecord") { if (recordDeleted && recordId) deletedRecords.add(recordId); recordId = "" }
    frames.pop()
  })
  parser.write(text.replace(/^\uFEFF/, "")).close()
  if (!rootSeen) throw new Error("The file contains no JobXML job.")
  if (environment.GridOrientation && environment.GridOrientation !== "IncreasingNorthEast") throw new Error(`The job uses ${environment.GridOrientation} axes. This release requires an increasing North/East grid; no axis conversion has been applied.`)

  const pointsByName = new Map<string, JobXmlPoint>(), conflicts = new Set<string>(), issues: JobXmlIssue[] = []
  let duplicateCount = 0
  const issue = (point: string, reason: string) => { if (issues.length < 1000) issues.push({ point, reason }) }
  for (const { values, index } of candidates) {
    const id = values.Name?.trim() ?? "", reference = values.ID?.trim() ?? ""
    const label = id || `Reduced record ${index}`
    if (deleted(values.Deleted) || deletedRecords.has(reference)) { issue(label, "Deleted in the source job"); continue }
    if (!id) { issue(label, "Missing point name"); continue }
    const easting = numberValue(values["Grid/East"]), northing = numberValue(values["Grid/North"])
    if (easting === null || northing === null) { issue(label, "No valid reduced Grid East/North coordinates"); continue }
    const elevation = numberValue(values["Grid/Elevation"])
    if (values["Grid/Elevation"]?.trim() && elevation === null) { issue(label, "Invalid reduced grid elevation"); continue }
    if (conflicts.has(id)) { issue(label, "Conflicting duplicate point name"); continue }
    const point: JobXmlPoint = { id, recordId: reference, easting, northing, elevation, code: values.Code ?? "", method: values.SurveyMethod || "Unspecified", classification: values.Classification || "Unspecified" }
    const previous = pointsByName.get(id)
    if (previous) {
      if (previous.easting === easting && previous.northing === northing && previous.elevation === elevation && previous.code === point.code && previous.method === point.method && previous.classification === point.classification) { duplicateCount++; continue }
      pointsByName.delete(id); conflicts.add(id); issue(id, "Conflicting duplicate point name; all versions excluded"); continue
    }
    pointsByName.set(id, point)
  }
  const points = [...pointsByName.values()]
  if (!points.length) throw new Error("No usable reduced grid points were found. This converter needs Reductions → Point → Grid coordinates. Raw observations and latitude/longitude alone are not converted to DXF.")
  const missingHeightCount = points.reduce((sum, point) => sum + (point.elevation === null ? 1 : 0), 0)
  const omittedCount = sourcePointCount - points.length
  const warnings: string[] = []
  if (omittedCount > 0) warnings.push(`${omittedCount.toLocaleString()} reduced record(s) omitted, including ${duplicateCount.toLocaleString()} identical duplicate(s). Review the import issues.`)
  if (missingHeightCount) warnings.push(`${missingHeightCount.toLocaleString()} point(s) have no grid RL. Use 2D output to include them at Z = 0, or keep 3D output to exclude them.`)
  if (unsupportedGeometry) warnings.push("This job contains geometry records. This release exports reduced points and labels; linework and curves are not included.")
  return { fileName, jobName: jobName || fileName, version, systemName: environment.SystemName || "Not specified", gridName: environment.ZoneName || "Not specified", points, sourcePointCount, fieldBookPointCount, missingHeightCount, duplicateCount, omittedCount, issues, warnings }
}

export function decodeJobXml(buffer: ArrayBuffer) {
  if (buffer.byteLength > maximumJobXmlBytes) throw new Error("Choose a JobXML file smaller than 50 MB.")
  const bytes = new Uint8Array(buffer)
  let encoding = "utf-8"
  if (bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0x3c && bytes[1] === 0x00) encoding = "utf-16le"
  else if (bytes[0] === 0xfe && bytes[1] === 0xff || bytes[0] === 0x00 && bytes[1] === 0x3c) encoding = "utf-16be"
  return new TextDecoder(encoding, { fatal: true }).decode(buffer)
}
