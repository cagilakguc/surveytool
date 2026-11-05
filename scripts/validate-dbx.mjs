import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import zlib from "node:zlib"
import { createHash } from "node:crypto"
import { parseDbxJob, readDbxTable, prepareDbxPoints, selectDbxRecords } from "../src/lib/leicaDbx.ts"
import { makeDbxExample } from "../src/lib/dbxExample.ts"
import { readHeightGrid, sampleHeightGrid, loadNzHeightGrid } from "../src/lib/nzHeightModels.ts"
import { dbxDxf, dbxPointCsv } from "../src/lib/dbxExport.ts"
import { parseSurveyGeometryFile } from "../src/lib/surveyGeometry.ts"
import { parsePointFileText } from "../src/lib/pointFile.ts"

const bytes = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
const settings = { includePoint: true, includePointId: true, includeElevation: true, includeCode: true, layerByCode: true, textHeight: .3 }
const options = { coordinateClass: "all", sourceHeightDatum: "unspecified", sourceGrid: "job", targetHeightDatum: "preserve" }
const folder = process.env.SURVEYTOOL_DBX_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "surveytool-dbx-qa-"))
fs.mkdirSync(folder, { recursive: true })
function constantGrid(value = .25) {
  const b = new ArrayBuffer(56), d = new DataView(b)
  ;[-90, -180, 180, 360].forEach((v, i) => d.setFloat64(i * 8, v))
  d.setInt32(32, 2); d.setInt32(36, 2)
  for (let i = 0; i < 4; i++) d.setFloat32(40 + i * 4, value)
  return readHeightGrid(b)
}
const example = makeDbxExample(), job = parseDbxJob(example)
assert.equal(job.source, "grid"); assert.equal(job.records.length, 3)
assert.deepEqual(job.records.map((p) => p.code), ["CONTROL", "KERB", "KERB"])
let calls = 0
const load = async () => { calls++; return constantGrid() }
const unchanged = await prepareDbxPoints(job, options, load)
assert.equal(calls, 0); assert.equal(unchanged.points[0].easting, 1750000); assert.equal(unchanged.points[0].northing, 5920000); assert.equal(unchanged.points[0].elevation, 10.125)
assert.match(unchanged.heightDatum, /Unspecified/)
await assert.rejects(prepareDbxPoints(job, { ...options, targetHeightDatum: "NZVD2016" }, load), /confirm.*source datum/)
await assert.rejects(prepareDbxPoints(job, { ...options, sourceHeightDatum: "AUCK46", targetHeightDatum: "NZVD2016" }, load), /NZTM2000/)
const nz = await prepareDbxPoints(job, { ...options, sourceHeightDatum: "AUCK46", sourceGrid: "NZTM2000", targetHeightDatum: "NZVD2016" }, load)
assert.equal(nz.points[0].elevation, 9.875, "AUCK46 to NZVD2016 subtracts the local relationship offset")
const back = await prepareDbxPoints({ ...job, records: job.records.map((p) => ({ ...p, height: p.height - .25 })) }, { ...options, sourceHeightDatum: "NZVD2016", sourceGrid: "NZTM2000", targetHeightDatum: "AUCK46" }, load)
assert.equal(back.points[0].elevation, 10.125)
const trueZero = await prepareDbxPoints({ ...job, records: [{ ...job.records[0], height: 0 }] }, options, load)
assert.equal(trueZero.points[0].elevation, 0)
const duplicates = { ...job, records: [...job.records, { ...job.records[0], recordId: 9, coordinateClass: "15", height: 99 }] }
assert.equal(selectDbxRecords(duplicates, "all").omittedCount, 2)
assert.equal(selectDbxRecords(duplicates, "all").records.length, 2)
assert.equal(selectDbxRecords(duplicates, "35").records.length, 3)
assert.equal(selectDbxRecords(duplicates, "15").records[0].height, 99)
assert.throws(() => parseDbxJob(example.filter((f) => !f.name.endsWith("XCF"))), /matching.*XCF/)
assert.throws(() => parseDbxJob(example.map((f, i) => i === 0 ? { ...f, name: "OTHER.X01" } : f)), /mixed jobs|same job/)
assert.throws(() => parseDbxJob([...example, example[0]]), /duplicate/i)
assert.throws(() => parseDbxJob(example.filter((f) => !f.name.endsWith("X06"))), /missing.*X06/)
for (const mutate of [
  (d) => d.setUint32(68, 99, true),
  (d) => d.setUint16(2048 + 16, 1006, true),
  (d) => d.setUint8(2048 + 18, 250),
  (d) => d.setUint8(2048 + 20, 1),
]) {
  const copy = structuredClone(example), file = copy.find((f) => f.name.endsWith("X01"))
  mutate(new DataView(file.buffer))
  assert.throws(() => parseDbxJob(copy), /DBX:/)
}
assert.throws(() => readDbxTable(new ArrayBuffer(1024)), /layout/)
const geo = parseDbxJob(makeDbxExample(true))
assert.equal(geo.source, "geographic"); assert.equal(geo.instrumentHeightDatum, "AUCK46")
const fakeModels = async (name) => constantGrid(name === "geoid" ? 30 : .25)
const geoNz = await prepareDbxPoints(geo, { ...options, targetHeightDatum: "NZVD2016" }, fakeModels)
const geoAuk = await prepareDbxPoints(geo, { ...options, targetHeightDatum: "AUCK46" }, fakeModels)
assert.ok(Math.abs(geoNz.points[0].elevation - (geo.records[0].height - 30)) < 1e-10)
assert.ok(Math.abs(geoAuk.points[0].elevation - (geoNz.points[0].elevation + .25)) < 1e-10)
await assert.rejects(prepareDbxPoints(geo, options, fakeModels), /ellipsoidal/)
for (const target of [1600000, 173 * Math.PI / 180, .9996]) {
  const broken = makeDbxExample(true), f = broken.find((p) => p.name.endsWith("X18")), b = Buffer.from(f.buffer), pattern = Buffer.alloc(8)
  pattern.writeDoubleLE(target)
  const at = b.indexOf(pattern)
  assert.ok(at >= 0); b.writeDoubleLE(target + 1, at)
  assert.throws(() => parseDbxJob(broken), /projection parameters/)
}
const shifted = makeDbxExample(true), transform = shifted.find((p) => p.name.endsWith("X18")), t = Buffer.from(transform.buffer)
const transformKey = t.indexOf(Buffer.from("WGS84-NZGD2000\0"), 2048)
assert.ok(transformKey > 0)
t.writeDoubleLE(1, transformKey + Buffer.byteLength("WGS84-NZGD2000\0") + 4 + 3)
assert.throws(() => parseDbxJob(shifted), /non-identity/)

// Fragment assembly uses physical page entries, not floating-point heuristics.
const fragment = structuredClone(example[0].buffer), f = new Uint8Array(fragment), fd = new DataView(fragment)
f.fill(0, 1024); fd.setUint32(68, 1, true)
const write = (at, kind, flag, data) => { f.set([data.length + 6, kind, flag, 1, 0, 0, 0, ...data], at); return at + data.length + 7 }
const keyEnd = write(1042, 1, 0x80, [...Buffer.from("key\0")])
fd.setUint16(1038, 1, true); fd.setUint16(1040, 2048 - keyEnd, true)
const payload = Uint8Array.from({ length: 300 }, (_, i) => i % 251)
let dataEnd = write(2066, 0x13, 0, payload.slice(0, 244)); dataEnd = write(dataEnd, 0x13, 0x81, payload.slice(244))
fd.setUint16(2062, 2, true); fd.setUint16(2064, 3072 - dataEnd, true)
assert.deepEqual(readDbxTable(fragment).records.get(1), payload)

const grid = constantGrid(.25)
grid.values.set([0, 2, 4, 6])
assert.equal(sampleHeightGrid(grid, 0, 0), 3)
assert.equal(sampleHeightGrid(grid, -90, -180), 0)
assert.equal(sampleHeightGrid(grid, 90, 180), 6)
assert.throws(() => sampleHeightGrid(grid, 91, 0), /outside/)
grid.values[0] = NaN
assert.throws(() => sampleHeightGrid(grid, 0, 0), /valid coverage/)
assert.throws(() => readHeightGrid(new ArrayBuffer(56)), /header/)

const dxf = dbxDxf(nz, settings, "3d"), flat = dbxDxf(nz, settings, "2d")
for (const [name, content, z] of [["synthetic", dxf, 9.875], ["flat", flat, 0]]) {
  const geometry = await parseSurveyGeometryFile(new File([content], name + ".dxf"))
  assert.equal(geometry.points.length, 3); assert.equal(geometry.points[0].elevation, z); assert.equal(geometry.lines.length, 0)
  assert.match(content, /Height datum=NZVD2016/); assert.match(content, /AC1021/)
  fs.writeFileSync(path.join(folder, name + ".dxf"), content)
}
const csv = parsePointFileText(dbxPointCsv(job, nz))
assert.equal(csv.rows.length, 4); assert.equal(csv.rows[0][5], "Height datum"); assert.equal(csv.rows[1][5], "NZVD2016"); assert.equal(Number(csv.rows[1][9]), 10.125)
assert.match(dbxPointCsv(job, { ...nz, points: [{ ...nz.points[0], id: "=FORMULA" }] }), /'=FORMULA/)

const sources = JSON.parse(fs.readFileSync("public/height-models/sources.json"))
const actualModels = new Map()
for (const m of sources.models) {
  const b = zlib.gunzipSync(fs.readFileSync(path.join("public/height-models", m.file)))
  assert.equal(b.length, m.bytes); assert.equal(createHash("sha256").update(b).digest("hex"), m.sha256)
  actualModels.set(m.file.includes("auck") ? "auckland" : "geoid", readHeightGrid(bytes(b)))
}
const realLoad = async (name) => actualModels.get(name)
assert.ok(sampleHeightGrid(actualModels.get("auckland"), -37, 175) > .2)
assert.ok(sampleHeightGrid(actualModels.get("auckland"), -37, 175) < .4)

// Verify the actual browser loader's checksum, decompression and retry behavior.
const priorFetch = globalThis.fetch, priorSelf = globalThis.self
let message
try {
  globalThis.fetch = async () => new Response(zlib.gzipSync(Buffer.from("corrupt model")))
  await assert.rejects(loadNzHeightGrid("auckland"), /integrity/)
  globalThis.fetch = async (url) => new Response(fs.readFileSync(path.join("public", String(url))))
  assert.ok((await loadNzHeightGrid("auckland")).rows > 2)
  globalThis.fetch = async (url) => new Response(zlib.gunzipSync(fs.readFileSync(path.join("public", String(url)))))
  assert.ok((await loadNzHeightGrid("geoid")).rows > 2, "Hosts may transparently decode Content-Encoding:gzip")
  globalThis.self = { postMessage: (m) => { message = m } }
  await import("../src/workers/dbx.worker.ts")
  await self.onmessage({ data: { type: "parse", components: makeDbxExample() } })
  assert.equal(message.result.records.length, 3)
  await self.onmessage({ data: { type: "prepare", job: geo, options: { ...options, targetHeightDatum: "NZVD2016" } } })
  assert.equal(message.result.points.length, 3)
  await self.onmessage({ data: { type: "export", job, prepared: nz, settings, mode: "3d", format: "dxf" } })
  assert.ok(message.buffer instanceof ArrayBuffer)
} finally { globalThis.fetch = priorFetch; globalThis.self = priorSelf }

let referenceSummary
if (process.argv[2]) {
  const directory = process.argv[2], stem = process.argv[3]
  assert.ok(stem, "Supply the local job stem after the source directory")
  const components = fs.readdirSync(directory).filter((s) => s.startsWith(stem) && /\.(xcf|x\d\d|m\d\d)$/i.test(s)).map((name) => { const b = fs.readFileSync(path.join(directory, name)); return { name, size: b.length, buffer: bytes(b) } })
  const real = parseDbxJob(components)
  const result = await prepareDbxPoints(real, { ...options, sourceHeightDatum: "AUCK46", sourceGrid: "NZTM2000", targetHeightDatum: "NZVD2016" }, realLoad)
  fs.writeFileSync(path.join(folder, "source-nzvd2016.dxf"), dbxDxf(result, settings, "3d"))
  fs.writeFileSync(path.join(folder, "source-nzvd2016.csv"), dbxPointCsv(real, result))
  const pipes = { ...result, points: result.points.filter((p) => p.code.toUpperCase().includes("PIPE")) }
  fs.writeFileSync(path.join(folder, "pipe-nzvd2016.dxf"), dbxDxf(pipes, settings, "3d"))
  if (process.argv[4]) {
    const reference = parsePointFileText(fs.readFileSync(process.argv[4], "utf8")).rows
    const expected = new Map(reference.map((r) => [r[0], r]))
    const auk = await prepareDbxPoints(real, { ...options, sourceHeightDatum: "AUCK46", sourceGrid: "NZTM2000", targetHeightDatum: "AUCK46" }, realLoad)
    assert.equal(auk.points.length, expected.size)
    let horizontalMm = 0, verticalMm = 0
    for (const p of auk.points) {
      const ref = expected.get(p.id); assert.ok(ref); assert.equal(p.code, ref[4])
      horizontalMm = Math.max(horizontalMm, Math.abs(p.easting - Number(ref[1])) * 1000, Math.abs(p.northing - Number(ref[2])) * 1000)
      verticalMm = Math.max(verticalMm, Math.abs(p.elevation - Number(ref[3])) * 1000)
    }
    assert.ok(horizontalMm < .6); assert.ok(verticalMm < 1.3)
    referenceSummary = { matchedPoints: auk.points.length, horizontalMm, verticalMm }
    fs.writeFileSync(path.join(folder, "source-auck46.dxf"), dbxDxf(auk, settings, "3d"))
  }
  fs.writeFileSync(path.join(folder, "source-prepared.json"), JSON.stringify(result))
}
console.log(JSON.stringify({ passed: true, reference: referenceSummary, folder }))
