import proj4 from "proj4"
import type { JobXmlPoint } from "./jobXml"
import { sampleHeightGrid } from "./nzHeightModels"
import type { HeightGrid, NzHeightDatum } from "./nzHeightModels"

export type DbxComponent = { name: string; size: number; buffer?: ArrayBuffer }
export type DbxRecord = { recordId: number; pointId: number; id: string; coordinateClass: string; type: "grid" | "geographic"; first: number; second: number; height: number; code: string }
export type DbxJob = { jobName: string; stem: string; records: DbxRecord[]; components: string[]; source: "grid" | "geographic"; instrumentHeightDatum: NzHeightDatum | "unspecified"; geoidName: string; warnings: string[] }
export type DbxOptions = { coordinateClass: string; sourceHeightDatum: NzHeightDatum | "unspecified"; sourceGrid: "job" | "NZTM2000"; targetHeightDatum: NzHeightDatum | "preserve" }
export type DbxPrepared = { points: JobXmlPoint[]; omittedCount: number; issues: string[]; heightDatum: string; grid: string; conversion: string; models: string[] }
type Table = { records: Map<number, Uint8Array>; keys: Map<number, Uint8Array> }
const maximumBytes = 200 * 1024 * 1024, maximumRecords = 500_000
const decoder = new TextDecoder("utf-8", { fatal: true })
const longlat = "+proj=longlat +ellps=GRS80 +no_defs"
const nztm = "+proj=tmerc +lat_0=0 +lon_0=173 +k=0.9996 +x_0=1600000 +y_0=10000000 +ellps=GRS80 +units=m +no_defs"
const invalid = (message: string): never => { throw new Error(`DBX: ${message}`) }
const view = (a: Uint8Array) => new DataView(a.buffer, a.byteOffset, a.byteLength)
function text(a: Uint8Array) { try { return decoder.decode(a) } catch { return invalid("the job uses an unsupported text encoding.") } }
function stringAt(a: Uint8Array, pos: number): [string, number] {
  const end = a.indexOf(0, pos)
  if (end < pos || end - pos > 4096) return invalid("a text field is truncated or too long.")
  return [text(a.subarray(pos, end)), end + 1]
}
function contains(a: Uint8Array, b: Uint8Array) {
  outer: for (let i = 0; i <= a.length - b.length; i++) { for (let j = 0; j < b.length; j++) if (a[i + j] !== b[j]) continue outer; return true }
  return false
}
function field(a: Uint8Array, pos: number, id: number, size: number) {
  if (pos + 2 + size > a.length || view(a).getUint16(pos, true) !== id) invalid(`an unsupported or incomplete field ${id} was found.`)
  return pos + 2
}

/** A deliberately bounded reader of the observed ALI DBX page format. All leaf
 * records, lengths, fragment sequences, live key references and header counts
 * must agree. It never scans floating-point bytes for plausible coordinates.
 * Unknown coordinate encodings and custom transformations are rejected.
 */
export function readDbxTable(buffer: ArrayBuffer): Table {
  const b = new Uint8Array(buffer), d = view(b)
  if (b.length < 2048 || b.length > maximumBytes || b.length % 1024 || d.getUint32(4, true) !== 86 || d.getUint32(8, true) !== 1 || d.getUint32(16, true) !== 65 || d.getUint32(20, true) !== 76 || d.getUint32(24, true) !== 73) return invalid("this database table layout is not supported, or the file is incomplete.")
  const expected = d.getUint32(68, true)
  if (expected > maximumRecords) return invalid("the table contains too many records. Split the source job first.")
  const fragments = new Map<number, Map<number, { last: boolean; data: Uint8Array }>>(), keys = new Map<number, Uint8Array>()
  for (let base = 1024; base < b.length; base += 1024) {
    const level = d.getUint16(base + 12, true), count = d.getUint16(base + 14, true), free = d.getUint16(base + 16, true)
    if (!count && b.subarray(base, base + 1024).every((value) => value === 0)) continue
    if (level > 16 || free > 1006 || count > 143) return invalid("an invalid database page was found.")
    let pos = base + 18
    for (let i = 0; i < count; i++) {
      const length = b[pos] + 1
      if (length < 7 || pos + length > base + 1024 - free) return invalid("a database record is truncated.")
      const kind = b[pos + 1], flags = b[pos + 2], id = d.getUint32(pos + 3, true), data = b.slice(pos + 7, pos + length)
      if (!level && kind === 0x13) {
        const part = flags & 0x7f
        if (!fragments.has(id)) fragments.set(id, new Map())
        if (fragments.get(id)!.has(part)) return invalid("duplicate record fragments were found.")
        fragments.get(id)!.set(part, { last: Boolean(flags & 0x80), data })
      } else if (!level && kind === 1) {
        if (flags !== 0x80 || keys.has(id)) return invalid("an unsupported or duplicate live index entry was found.")
        keys.set(id, data)
      }
      pos += length
    }
    if (pos !== base + 1024 - free) return invalid("a database page's record count does not match its contents.")
  }
  const records = new Map<number, Uint8Array>()
  for (const [id, parts] of fragments) {
    let length = 0
    for (let i = 0; i < parts.size; i++) { const p = parts.get(i); if (!p || p.last !== (i === parts.size - 1)) return invalid("a database record has missing or unordered fragments."); length += p.data.length }
    if (length > 2 * 1024 * 1024) return invalid("an individual database record is too large.")
    const assembled = new Uint8Array(length)
    let offset = 0
    for (let i = 0; i < parts.size; i++) { assembled.set(parts.get(i)!.data, offset); offset += parts.get(i)!.data.length }
    if (!keys.has(id)) return invalid("a coordinate or code record has no live index entry.")
    records.set(id, assembled)
  }
  if (records.size !== expected || keys.size !== expected) return invalid("the database's live record count does not agree with its index. This DBX variant cannot be exported safely yet.")
  return { records, keys }
}

function readPoint(recordId: number, body: Uint8Array, key: Uint8Array): DbxRecord {
  if (body.length < 40 || body[1] !== 0x48 || body[2] !== 0xbd) return invalid("an unsupported coordinate record type was found.")
  const [nameKey, start] = stringAt(body, 8), parts = nameKey.split("\n")
  if (parts.length !== 3 || !parts[0] || /[\u0000-\u001f\u007f]/.test(parts[0]) || !/^\d+$/.test(parts[1]) || !/^[01]$/.test(parts[2])) return invalid("an unsupported coordinate key was found.")
  if (stringAt(key, 0)[0] !== nameKey) return invalid("a point's live index does not agree with its stored coordinate key.")
  const fields: Record<number, number> = {}, d = view(body)
  let pos = start, previous = -1
  while (pos + 2 <= body.length && d.getUint16(pos, true) !== 17) {
    const id = d.getUint16(pos, true), size = id === 1 ? 2 : [2, 3, 4].includes(id) ? 4 : id === 7 ? 8 : id === 9 || id >= 10 && id <= 16 ? 1 : 0
    if (!size || id <= previous) return invalid(`point ${parts[0]} has an unsupported coordinate field.`)
    const value = field(body, pos, id, size)
    fields[id] = size === 8 ? d.getFloat64(value, true) : size === 4 ? d.getUint32(value, true) : size === 2 ? d.getUint16(value, true) : body[value]
    previous = id; pos = value + size
  }
  const first = d.getFloat64(field(body, pos, 17, 8), true); pos += 10
  const second = d.getFloat64(field(body, pos, 18, 8), true); pos += 10
  const height = d.getFloat64(field(body, pos, 19, 8), true)
  if (![first, second, height].every(Number.isFinite) || Math.abs(height) > 100_000 || !fields[2] || String(fields[10]) !== parts[1]) return invalid(`point ${parts[0]} has invalid coordinates or inconsistent classification.`)
  const geographic = parts[2] === "0" && fields[15] === 2 && fields[16] === 1
  const grid = parts[2] === "1" && fields[15] === 3 && fields[16] === 2
  if (!geographic && !grid) return invalid(`point ${parts[0]} uses a coordinate/height encoding that is not supported yet.`)
  if (geographic && (Math.abs(first) > Math.PI / 2 || second < -Math.PI || second > 2 * Math.PI) || grid && (Math.abs(first) > 1e9 || Math.abs(second) > 1e9)) return invalid(`point ${parts[0]} has coordinates outside the supported range.`)
  return { recordId, pointId: fields[2], id: parts[0], coordinateClass: parts[1], type: geographic ? "geographic" : "grid", first, second, height, code: "" }
}

function codeDictionary(table: Table) {
  const result = new Map<number, string>()
  for (const [id, key] of table.keys) {
    const [value] = stringAt(key, 0)
    if (!value.startsWith("4")) continue
    const fields = value.slice(1).split("\n"), body = table.records.get(id)!
    if (fields.length !== 2 || !/^\d+$/.test(fields[1]) || body[1] !== 0x48 || body[2] !== 0xbf || !contains(body, new Uint8Array([7, 0, ...key]))) return invalid("a feature code's index and definition do not agree.")
    result.set(id, fields[0])
  }
  return result
}
function assignCodes(points: DbxRecord[], assignments: Table | null, dictionary: Map<number, string>) {
  if (!assignments) return
  const codes = new Map<number, string>()
  for (const body of assignments.records.values()) {
    const d = view(body)
    if (body.length < 35 || body[1] !== 0xb4 || body[2] !== 0x19 || body[8] !== 1) return invalid("a code assignment uses an unsupported object type.")
    const point = d.getUint32(field(body, 9, 2, 4), true), code = d.getUint32(field(body, 15, 3, 4), true)
    field(body, 21, 4, 8); field(body, 31, 5, 0)
    if (!dictionary.has(code)) return invalid("a point's feature code is missing. Include the matching .X06 code-list file.")
    if (codes.has(point) && codes.get(point) !== dictionary.get(code)) return invalid("multiple different codes were assigned to one point. Code edit histories are not supported by this reader yet.")
    codes.set(point, dictionary.get(code)!)
  }
  for (const point of points) point.code = codes.get(point.pointId) ?? ""
}

function nzGeographicProfile(table: Table) {
  const contexts = [...table.records.values()].filter((r) => r[1] === 0x48 && r[2] === 0xd8)
  if (contexts.length !== 1) return invalid("the job does not have one supported coordinate-system definition.")
  const c = contexts[0], d = view(c)
  const ellipsoid = table.records.get(d.getUint32(8, true)), projection = table.records.get(d.getUint32(field(c, 12, 1, 4), true)), transformation = table.records.get(d.getUint32(field(c, 18, 2, 4), true)), geoid = table.records.get(d.getUint32(field(c, 24, 3, 4), true))
  if (!ellipsoid || !projection || !transformation || !geoid) return invalid("the geographic coordinate system is incomplete.")
  const e = view(ellipsoid), [ellipsoidName, ellipsoidEnd] = stringAt(ellipsoid, field(ellipsoid, 16, 1, 1))
  if (ellipsoidName !== "GRS80" || Math.abs(e.getFloat64(8, true) - 6378137) > 1e-7 || Math.abs(e.getFloat64(field(ellipsoid, ellipsoidEnd, 2, 8), true) - 1 / 298.257222101) > 1e-12) return invalid("this release requires the job's GRS80 / NZGD2000 definition for geographic coordinates.")
  const [projectionName, projectionEnd] = stringAt(projection, field(projection, 19, 2, 1)), p = view(projection)
  if (projection[18] !== 1) return invalid("only the validated NZTM2000 projection is currently supported for geographic DBX points.")
  const block = field(projection, projectionEnd, 3, 50), expected = [1600000, 10000000, 0, 173 * Math.PI / 180, .9996, 16 * Math.PI / 180]
  if (p.getUint16(block, true) !== 48 || !expected.every((n, i) => Math.abs(p.getFloat64(block + 2 + i * 8, true) - n) < 1e-11)) return invalid("the job's projection parameters are not the validated NZTM2000 parameters.")
  const [transformationName, transformationEnd] = stringAt(transformation, field(transformation, 19, 2, 1)), t = view(transformation)
  const tb = field(transformation, transformationEnd, 3, 86)
  if (transformation[18] !== 1 || transformationName !== "WGS84-NZGD2000" || t.getUint16(tb, true) !== 84) return invalid("a custom or unsupported datum transformation is configured. No approximate transformation has been substituted.")
  const data = transformation.subarray(tb + 2, tb + 86), identity = new Uint8Array(84)
  identity[2] = 1; view(identity).setFloat64(75, 1, true); identity[83] = 1
  if (!data.every((value, i) => value === identity[i])) return invalid("the job has non-identity datum parameters. This release does not replay custom datum transformations.")
  const [geoidName] = stringAt(geoid, field(geoid, 12, 3, 1))
  const normalized = geoidName.toLowerCase().replace(/[^a-z0-9]/g, "")
  const instrumentHeightDatum = normalized.includes("auk4616") ? "AUCK46" : normalized.includes("nzgeoid2016") || normalized.includes("nzvd2016") ? "NZVD2016" : "unspecified"
  return { projectionName, geoidName, instrumentHeightDatum: instrumentHeightDatum as DbxJob["instrumentHeightDatum"] }
}

export function parseDbxJob(components: DbxComponent[]): DbxJob {
  if (!components.length || components.length > 128 || components.reduce((n, f) => n + f.size, 0) > maximumBytes) return invalid("select one job containing up to 128 files and 200 MB.")
  const files = new Map<string, DbxComponent>(), stems = new Set<string>()
  for (const file of components) {
    const name = file.name.replaceAll("\\", "/").split("/").at(-1)!, match = name.match(/^(.*)\.(x\d\d|xcf|m\d\d)$/i)
    if (!match) continue
    stems.add(match[1].toLowerCase())
    const ext = match[2].toLowerCase()
    if (files.has(ext)) return invalid("duplicate component extensions or mixed jobs were selected. Choose all files for one job only.")
    files.set(ext, file)
  }
  if (stems.size !== 1 || !files.has("xcf") || !files.has("x01")) return invalid("select the matching .XCF and .X01 files, together with the other files for the same job.")
  const required = (name: string) => { const f = files.get(name); if (!f?.buffer || f.buffer.byteLength !== f.size) return invalid(`the matching .${name.toUpperCase()} component is missing or incomplete.`); return f.buffer }
  const xcf = new Uint8Array(required("xcf"))
  if (xcf.length < 32 || view(xcf).getUint32(0, true) !== 0x0a0b0c0d || xcf[4] !== 4) return invalid("this job-index version is not supported.")
  const [jobName] = stringAt(xcf, 16), table = readDbxTable(required("x01"))
  const records = [...table.records].map(([id, body]) => readPoint(id, body, table.keys.get(id)!))
  if (!records.length) return invalid("the job contains no supported coordinate records.")
  if (new Set(records.map((r) => r.type)).size !== 1) return invalid("the job mixes grid and geographic coordinate encodings. Split the job or use a calculated point export.")
  const dictionary = files.has("x06") ? codeDictionary(readDbxTable(required("x06"))) : new Map<number, string>()
  assignCodes(records, files.has("x14") ? readDbxTable(required("x14")) : null, dictionary)
  const source = records[0].type, warnings = ["This reader exports stored coordinate positions and main feature codes. It does not reduce raw observations, replay code attributes, or draw connecting strings and curves."]
  const profile = source === "geographic" ? nzGeographicProfile(readDbxTable(required("x18"))) : { geoidName: "Not specified for stored grid coordinates", instrumentHeightDatum: "unspecified" as const }
  if (source === "grid") warnings.push("Stored grid coordinates do not establish their horizontal or vertical datum. Confirm the source datums before requesting a height conversion.")
  if (files.has("x16") || files.has("x24")) warnings.push("Geometry components are present. This release exports points and labels only.")
  return { jobName, stem: [...stems][0], records, components: [...files.keys()].map((s) => s.toUpperCase()), source, instrumentHeightDatum: profile.instrumentHeightDatum, geoidName: profile.geoidName, warnings }
}

export function selectDbxRecords(job: DbxJob, coordinateClass: string) {
  const candidates = job.records.filter((r) => coordinateClass === "all" || r.coordinateClass === coordinateClass), names = new Map<string, DbxRecord[]>(), issues: string[] = []
  for (const r of candidates) { if (!names.has(r.id)) names.set(r.id, []); names.get(r.id)!.push(r) }
  const records: DbxRecord[] = []
  for (const [name, versions] of names) {
    if (versions.length !== 1) issues.push(`${name}: ${versions.length} stored positions share this point name. All versions omitted; select one coordinate class to resolve them.`)
    else records.push(versions[0])
  }
  return { records, issues, omittedCount: candidates.length - records.length }
}

export async function prepareDbxPoints(job: DbxJob, options: DbxOptions, load: (name: "geoid" | "auckland") => Promise<HeightGrid>): Promise<DbxPrepared> {
  const selected = selectDbxRecords(job, options.coordinateClass)
  if (!selected.records.length) return invalid("no unambiguous points are selected. Choose a coordinate class.")
  if (job.source === "geographic" && options.targetHeightDatum === "preserve") return invalid("geographic DBX points contain ellipsoidal heights. Choose NZVD2016 or Auckland 1946 for RL output.")
  if (job.source === "grid" && options.targetHeightDatum !== "preserve" && options.sourceHeightDatum === "unspecified") return invalid("confirm the stored grid heights' source datum, or choose Preserve stored grid RLs.")
  const needConversion = job.source === "geographic" || options.targetHeightDatum !== "preserve" && options.targetHeightDatum !== options.sourceHeightDatum
  if (needConversion && job.source === "grid" && options.sourceGrid !== "NZTM2000") return invalid("height conversion needs NZGD2000 positions. Confirm that these stored Eastings and Northings use NZTM2000, or preserve the source RLs.")
  const [geoid, auckland] = await Promise.all([
    job.source === "geographic" ? load("geoid") : Promise.resolve(null),
    needConversion && (job.source === "grid" || options.targetHeightDatum === "AUCK46") ? load("auckland") : Promise.resolve(null),
  ])
  const models = [...(geoid ? ["NZGeoid2016"] : []), ...(auckland ? ["AUK46-NZVD16 v2016.1"] : [])]
  const projection = job.source === "geographic" ? proj4(longlat, nztm) : needConversion ? proj4(nztm, longlat) : null
  const points = selected.records.map((r) => {
    let latitude = 0, longitude = 0, easting = r.second, northing = r.first, elevation = r.height
    if (r.type === "geographic") {
      latitude = r.first * 180 / Math.PI; longitude = r.second * 180 / Math.PI
      ;[easting, northing] = projection!.forward([longitude, latitude])
      elevation -= sampleHeightGrid(geoid!, latitude, longitude)
      if (options.targetHeightDatum === "AUCK46") elevation += sampleHeightGrid(auckland!, latitude, longitude)
    } else if (needConversion) {
      ;[longitude, latitude] = projection!.forward([easting, northing])
      const offset = sampleHeightGrid(auckland!, latitude, longitude)
      elevation += options.sourceHeightDatum === "AUCK46" ? -offset : offset
    }
    if (![easting, northing, elevation].every(Number.isFinite)) return invalid(`point ${r.id} could not be transformed.`)
    return { id: r.id, recordId: String(r.recordId), easting, northing, elevation, code: r.code, classification: `DBX class ${r.coordinateClass}`, method: r.type === "geographic" ? "Stored GNSS position" : "Stored grid position" }
  })
  const heightDatum = options.targetHeightDatum === "preserve" ? options.sourceHeightDatum === "unspecified" ? "Unspecified · stored RLs preserved" : options.sourceHeightDatum : options.targetHeightDatum
  const conversion = job.source === "geographic" ? `Ellipsoidal heights → ${heightDatum} using LINZ models` : needConversion ? `${options.sourceHeightDatum} → ${heightDatum} using the LINZ relationship grid` : "Stored grid coordinates and RLs preserved"
  return { points, omittedCount: selected.omittedCount, issues: selected.issues, heightDatum, grid: job.source === "geographic" || options.sourceGrid === "NZTM2000" ? "NZTM2000" : "Source job grid · unspecified", conversion, models }
}
