import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { decodeJobXml, parseJobXml } from "../src/lib/jobXml.ts"
import { jobXmlDxfPoints, jobXmlPointCsv } from "../src/lib/jobXmlExport.ts"
import { createPointDxf } from "../src/lib/pointDxf.ts"
import { parseSurveyGeometryFile } from "../src/lib/surveyGeometry.ts"
import { parsePointFileText } from "../src/lib/pointFile.ts"

const settings = { includePoint: true, includePointId: true, includeElevation: true, includeCode: true, layerByCode: true, textHeight: .4 }
const wrap = (points, field = "", environment = "") => `<?xml version="1.0"?><JOBFile version="6.31" jobName="QA"><FieldBook>${field}</FieldBook><Reductions>${points}</Reductions><Environment>${environment}</Environment></JOBFile>`
const point = (name, east = "1000.000123456", north = "2000.123456789", height = "0", extra = "", code = "KERB") => `<Point><ID>${name}</ID><Name>${name}</Name><Code>${code}</Code><SurveyMethod>Fix</SurveyMethod><Classification>Stakeout</Classification><Grid><East>${east}</East><North>${north}</North>${height === null ? "" : `<Elevation>${height}</Elevation>`}</Grid>${extra}</Point>`
const first = point("001"), second = point("B", "1005.75", "2007.5", "123.456789")
const xml = wrap(first + second)
const basic = parseJobXml(xml)
assert.equal(basic.points.length, 2)
assert.equal(basic.points[0].id, "001")
assert.equal(basic.points[0].easting, 1000.000123456)
assert.equal(basic.points[0].northing, 2000.123456789)
assert.equal(basic.points[0].elevation, 0, "A true zero height is valid")
assert.equal(basic.points[1].elevation, 123.456789)
assert.equal(basic.issues.length, 0)
const namespaced = xml.replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/g, "<$1j:$2").replace('<j:JOBFile ', '<j:JOBFile xmlns:j="urn:jobxml-test" ')
assert.deepEqual(parseJobXml(namespaced).points, basic.points)
assert.deepEqual(parseJobXml(xml.replace('version="6.31"', 'version="5.64"')).points, basic.points)
const feet = parseJobXml(wrap(first, "", "<DisplaySettings><DistanceUnits>Feet</DistanceUnits><HeightUnits>USSurveyFeet</HeightUnits></DisplaySettings>"))
assert.equal(feet.points[0].easting, basic.points[0].easting, "Display units must never rescale stored metre coordinates")
assert.equal(parseJobXml(wrap(first + second, '<PointRecord ID="001"><Deleted>true</Deleted></PointRecord>')).points[0].id, "B")
assert.equal(parseJobXml(wrap(first + point("D", "1", "2", "3", "<Deleted>1</Deleted>"))).points.length, 1)
const duplicate = parseJobXml(wrap(first + first + second))
assert.equal(duplicate.points.length, 2); assert.equal(duplicate.duplicateCount, 1); assert.equal(duplicate.omittedCount, 1)
const conflict = parseJobXml(wrap(first + point("001", "1001") + second))
assert.deepEqual(conflict.points.map((p) => p.id), ["B"])
assert.equal(conflict.omittedCount, 2)
assert.match(conflict.issues[0].reason, /Conflicting duplicate/)
const partial = parseJobXml(wrap(first + point("MISSING", "1", "2", null) + point("BAD", "oops") + point("BADHEIGHT", "1", "2", "NaN") + point("", "1", "2", "3")))
assert.equal(partial.points.length, 2); assert.equal(partial.missingHeightCount, 1); assert.equal(partial.omittedCount, 3)
assert.equal(jobXmlDxfPoints(partial.points, "3d").length, 1)
assert.equal(jobXmlDxfPoints(partial.points, "2d").length, 2)
const noRawCoordinates = parseJobXml(wrap(first, '<PointRecord ID="99"><Name>RAW</Name><Grid><East>9999</East><North>9999</North><Elevation>9999</Elevation></Grid><Circle><HorizontalCircle>12</HorizontalCircle></Circle></PointRecord>'))
assert.equal(noRawCoordinates.points.length, 1); assert.equal(noRawCoordinates.fieldBookPointCount, 1)
assert.equal(parseJobXml(wrap(first + '<LineRecord><From>001</From><To>B</To></LineRecord>')).warnings.length, 1)
const hiddenDesign = parseJobXml(wrap(first.replace('<Grid>', '<Design><ComputedGrid><East>9999</East><North>9999</North><Elevation>9999</Elevation></ComputedGrid></Design><Grid>')))
assert.equal(hiddenDesign.points[0].easting, 1000.000123456, "Design and computed observation subtrees are not authoritative reduced Grid points")
assert.throws(() => parseJobXml("<LandXML/>"), /not a Trimble/)
assert.throws(() => parseJobXml(xml.replace('version="6.31"', 'version="7.0"')), /not yet supported/)
assert.throws(() => parseJobXml(wrap('<Point><Name>GPS</Name><WGS84><Latitude>-36</Latitude><Longitude>174</Longitude><Height>12</Height></WGS84></Point>')), /No usable reduced grid/)
assert.throws(() => parseJobXml(xml.replace('</Grid>', '</Point>')), /Invalid JobXML/)
assert.throws(() => parseJobXml(xml.replace('?><JOBFile', '?><!DOCTYPE JOBFile [<!ENTITY x "no">]><JOBFile')), /document type/)
assert.throws(() => parseJobXml(wrap(first, "", '<CoordinateSystem><Projection><GridOrientation>IncreasingSouthWest</GridOrientation></Projection></CoordinateSystem>')), /axes/)
assert.throws(() => parseJobXml(wrap(first, '<PointRecord ID="001"><Deleted>maybe</Deleted></PointRecord>')), /Deleted flag/)
const utf16 = Buffer.from("\uFEFF" + xml, "utf16le")
assert.equal(decodeJobXml(utf16.buffer.slice(utf16.byteOffset, utf16.byteOffset + utf16.byteLength)), xml)
const utf16be = Buffer.from(utf16); utf16be.swap16()
assert.equal(decodeJobXml(utf16be.buffer.slice(utf16be.byteOffset, utf16be.byteOffset + utf16be.byteLength)), xml)
const entities = parseJobXml(wrap(point("P&amp;Q", "-1.25", "2e3", "-4.5", "", "KÉRB &amp; ROAD")))
assert.equal(entities.points[0].id, "P&Q"); assert.equal(entities.points[0].code, "KÉRB & ROAD")
const escapedCsv = jobXmlPointCsv([{ ...entities.points[0], id: '=HYPERLINK("x")' }])
assert.match(escapedCsv, /'=/)
const csv = parsePointFileText(jobXmlPointCsv(basic.points))
assert.equal(csv.rows.length, 3)
assert.equal(csv.rows[1][0], "001"); assert.equal(Number(csv.rows[1][1]), basic.points[0].easting)

const dxf = createPointDxf(jobXmlDxfPoints(basic.points, "3d"), settings, { metres: true })
const geometry = await parseSurveyGeometryFile(new File([dxf], "roundtrip.dxf"))
assert.equal(geometry.points.length, 2)
for (const [i, p] of geometry.points.entries()) {
  assert.equal(p.easting, basic.points[i].easting); assert.equal(p.northing, basic.points[i].northing); assert.equal(p.elevation, basic.points[i].elevation)
}
assert.equal(geometry.lines.length, 0, "Shared feature codes must not invent connecting lines")
assert.match(dxf, /\$INSUNITS\r\n70\r\n6\r\n/)
assert.match(dxf, /\$ACADVER\r\n1\r\nAC1021/)
const oldDxf = createPointDxf(jobXmlDxfPoints(basic.points, "3d"), settings)
assert.match(oldDxf, /AC1009/); assert.doesNotMatch(oldDxf, /INSUNITS/)
const flat = createPointDxf(jobXmlDxfPoints(partial.points, "2d"), settings, { metres: true, flatten: true })
const flatPoints = (await parseSurveyGeometryFile(new File([flat], "flat.dxf"))).points
assert.equal(flatPoints.length, 2); assert.ok(flatPoints.every((p) => p.elevation === 0))

const folder = process.env.SURVEYTOOL_JXL_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "surveytool-jxl-qa-"))
fs.mkdirSync(folder, { recursive: true })
fs.writeFileSync(path.join(folder, "synthetic.dxf"), dxf)
fs.writeFileSync(path.join(folder, "unicode.dxf"), createPointDxf(jobXmlDxfPoints(entities.points, "3d"), settings, { metres: true }))
fs.writeFileSync(path.join(folder, "flat.dxf"), flat)
fs.writeFileSync(path.join(folder, "legacy-csv.dxf"), oldDxf)
const input = process.argv[2] || "public/examples/jobxml-points.jxl"
const bytes = fs.readFileSync(input)
const job = parseJobXml(decodeJobXml(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), path.basename(input))
const output = createPointDxf(jobXmlDxfPoints(job.points, "3d"), settings, { metres: true })
const outputPoints = (await parseSurveyGeometryFile(new File([output], "source-grid.dxf"))).points
const sourcePoints = job.points.filter((p) => p.elevation !== null)
assert.equal(outputPoints.length, sourcePoints.length)
for (const [i, p] of outputPoints.entries()) for (const key of ["easting", "northing", "elevation"]) assert.equal(p[key], sourcePoints[i][key])
fs.writeFileSync(path.join(folder, "source-grid.dxf"), output)
fs.writeFileSync(path.join(folder, "source-points.csv"), jobXmlPointCsv(job.points))
fs.writeFileSync(path.join(folder, "source-points.json"), JSON.stringify(job.points))
// Exercise the same worker message protocol used by the browser, including the
// filtered stakeout export and its transferable UTF-8 output buffer.
const priorSelf = globalThis.self
let workerMessage
try {
  globalThis.self = { postMessage: (message) => { workerMessage = message } }
  await import("../src/workers/jobXml.worker.ts")
  const stakeout = job.points.filter((point) => point.classification === "Stakeout")
  self.onmessage({ data: { type: "export", points: stakeout, mode: "3d", format: "dxf", settings } })
  assert.ok(workerMessage.buffer instanceof ArrayBuffer)
  const workerDxf = new TextDecoder().decode(workerMessage.buffer)
  assert.equal((await parseSurveyGeometryFile(new File([workerDxf], "stakeout.dxf"))).points.length, stakeout.filter((p) => p.elevation !== null).length)
  fs.writeFileSync(path.join(folder, "source-stakeout.dxf"), workerDxf)
} finally { globalThis.self = priorSelf }
console.log(JSON.stringify({ passed: true, points: job.points.length, rawPointRecords: job.fieldBookPointCount, issues: job.issues.length, missingHeightCount: job.missingHeightCount, grid: job.gridName, folder }))
