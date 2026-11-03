import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { createTinSampler } from "../src/lib/asBuiltConformance.ts"
import { checkPavementDesign, defaultPavementDesign, restorePavementDesign } from "../src/lib/pavementDesign.ts"
import { checkBottomSurfaceThickness } from "../src/lib/pavementBottomSurface.ts"
import { analysePavementSection, pavementSectionTicks } from "../src/lib/pavementSection.ts"
import { pavementSectionPdf } from "../src/lib/pavementSectionReports.ts"
import { defaultPavementWorkspace } from "../src/lib/pavementMap.ts"
import { assertDocument } from "../src/lib/projectWorkspace.ts"

const e = 1755000, n = 5923000
const z = (x, y) => 10 + .002 * x - .003 * y
const p = (x, y = 10) => ({ easting: e + x, northing: n + y, elevation: z(x, y) })
const rectangle = (x0, y0, x1, y1) => [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)]
const boundary = (type, points, edgeTrim = true) => ({ name: type, type, edgeTrim, points })
const surface = { name: "FSL with boundary polygons", points: { a: p(-10, -10), b: p(130, -10), c: p(130, 30), d: p(-10, 30) }, faces: [["a", "b", "c"], ["a", "c", "d"]], minElevation: 9.8, maxElevation: 10.3, excludedFaces: 0, hasBoundaryDefinitions: true,
  boundaries: [boundary("outer", rectangle(0, 0, 100, 20)), boundary("void", rectangle(40, 5, 60, 15)), boundary("island", rectangle(48, 8, 52, 12))] }
const original = structuredClone(surface)
const sampler = createTinSampler(surface)
const sample = (x, y = 10) => sampler.find(e + x, n + y)
for (const x of [0, 10, 39, 49, 50, 51, 70, 100]) assert.ok(Math.abs(sample(x).level - z(x, 10)) < 1e-10)
for (const x of [-1, 40, 45, 55, 60, 101]) assert.deepEqual(sample(x), { level: null, status: "OUTSIDE" })
assert.equal(sample(50, 4).status, "PASS")
assert.equal(sample(50, 16).status, "PASS")
assert.deepEqual(surface, original)
const reverse = createTinSampler({ ...surface, boundaries: [...surface.boundaries, boundary("hide", rectangle(48, 8, 52, 12))] })
assert.equal(reverse.find(e + 50, n + 10).status, "OUTSIDE")
const latestOuter = createTinSampler({ ...surface, boundaries: [...surface.boundaries, boundary("outer", rectangle(20, 0, 30, 20))] })
assert.equal(latestOuter.find(e + 25, n + 10).status, "PASS")
assert.equal(latestOuter.find(e + 10, n + 10).status, "OUTSIDE")
assert.equal(createTinSampler({ ...surface, boundaries: [boundary("outer", rectangle(0, 0, 100, 20).reverse())] }).find(e + 10, n + 10).status, "PASS")
const concave = [p(0, 0), p(100, 0), p(100, 20), p(60, 20), p(60, 5), p(40, 5), p(40, 20), p(0, 20)]
const concaveSampler = createTinSampler({ ...surface, boundaries: [boundary("outer", concave)] })
assert.equal(concaveSampler.find(e + 50, n + 10).status, "OUTSIDE")
assert.equal(concaveSampler.find(e + 50, n + 2).status, "PASS")

// edgeTrim=false keeps complete faces only; it must not sample the surviving portion of a crossing face.
const single = { ...surface, points: { a: p(0, 0), b: p(100, 0), c: p(50, 20) }, faces: [["a", "b", "c"]] }
const noTrim = createTinSampler({ ...single, boundaries: [boundary("outer", rectangle(0, 0, 60, 20), false)] })
assert.equal(noTrim.find(e + 50, n + 5).status, "OUTSIDE")
const trim = createTinSampler({ ...single, boundaries: [boundary("outer", rectangle(0, 0, 60, 20), true)] })
assert.equal(trim.find(e + 50, n + 5).status, "PASS")
const noTrimHole = createTinSampler({ ...single, boundaries: [boundary("void", rectangle(49, 4, 51, 6), false)] })
assert.equal(noTrimHole.find(e + 30, n + 5).status, "OUTSIDE")
const full = createTinSampler({ ...single, boundaries: [boundary("outer", rectangle(0, 0, 100, 20), false)] })
assert.equal(full.find(e + 50, n + 5).status, "PASS")
// All three triangle vertices are inside this concave polygon, but a triangle edge crosses its notch.
const notched = createTinSampler({ ...single, boundaries: [boundary("outer", [p(-1, -1), p(101, -1), p(101, 21), p(76, 21), p(76, 1), p(74, 1), p(74, 21), p(-1, 21)], false)] })
assert.equal(notched.find(e + 50, n + 5).status, "OUTSIDE")

const malformed = [boundary("outer", [p(0, 0), p(100, 20), p(0, 20), p(100, 0)]), boundary("outer", [p(0, 0), p(1, 1)]), boundary("unsupported", rectangle(0, 0, 100, 20))]
for (const bad of malformed) assert.throws(() => createTinSampler({ ...surface, boundaries: [bad] }), /Surface boundary/)
assert.throws(() => createTinSampler({ ...surface, boundaries: undefined }), /Re-upload.*LandXML/)

// Exercise the actual upload worker, including namespace prefixes, 3D NEZ order, closing vertices and invisible faces.
const messages = [], context = { self: { postMessage: (message) => messages.push(message) }, TextDecoder }
vm.runInNewContext(fs.readFileSync("src/workers/landxmlParser.worker.js", "utf8"), context)
const prefix = "lx:"
const boundariesXml = surface.boundaries.map((b, i) => `<${prefix}Boundary bndType="${b.type}" edgeTrim="true" name="${b.type}"><${prefix}PntList${i === 0 ? 3 : 2}D>${[...b.points, b.points[0]].map((p) => [p.northing, p.easting, ...(i === 0 ? [p.elevation] : [])].join(" ")).join(" ")}</${prefix}PntList${i === 0 ? 3 : 2}D></${prefix}Boundary>`).join("")
const xml = `<?xml version="1.0"?><lx:LandXML xmlns:lx="http://www.landxml.org/schema/LandXML-1.2" version="1.2"><lx:Units><lx:Metric linearUnit="meter"/></lx:Units><lx:Surfaces><lx:Surface name="${surface.name}"><lx:SourceData><lx:Boundaries>${boundariesXml}</lx:Boundaries></lx:SourceData><lx:Definition surfType="TIN"><lx:Pnts>${Object.entries(surface.points).map(([id, p]) => `<lx:P id="${id}">${p.northing} ${p.easting} ${p.elevation}</lx:P>`).join("")}</lx:Pnts><lx:Faces><lx:F>a b c</lx:F><lx:F>a c d</lx:F></lx:Faces></lx:Definition></lx:Surface></lx:Surfaces></lx:LandXML>`
function parse(xml) {
  messages.length = 0
  context.self.onmessage({ data: { buffer: new TextEncoder().encode(xml).buffer, fileName: "boundary-fsl.xml" } })
  const result = messages.find((message) => message.type === "result")
  assert.ok(result, JSON.stringify(messages))
  return JSON.parse(JSON.stringify(result.document))
}
const document = parse(xml), parsedSurface = document.surfaces[0]
assert.equal(parsedSurface.boundaries.length, 3)
assert.equal(parsedSurface.excludedFaces, 0)
assert.equal(parsedSurface.boundaries[0].points[0].easting, e)
assert.equal(parsedSurface.boundaries[0].points[0].northing, n)
assert.equal(createTinSampler(parsedSurface).find(e + 45, n + 10).status, "OUTSIDE")
assert.equal(createTinSampler(parsedSurface).find(e + 50, n + 10).status, "PASS")
const hidden = parse(xml.replace("<lx:F>a c d</lx:F>", '<lx:F i="1">a c d</lx:F>'))
assert.equal(createTinSampler(hidden.surfaces[0]).find(e + 10, n + 10).status, "OUTSIDE", "An island/show boundary cannot restore an invisible face")
const emptyBoundary = parse(xml.replace(/<lx:Boundaries>[\s\S]*?<\/lx:Boundaries>/, '<lx:Boundaries><lx:Boundary bndType="outer" edgeTrim="true"/></lx:Boundaries>'))
assert.throws(() => createTinSampler(emptyBoundary.surfaces[0]), /readable PntList/)
const invalidNumbers = parse(xml.replace(/<lx:PntList3D>[\s\S]*?<\/lx:PntList3D>/, "<lx:PntList3D>0 0 bad 1 2 3 4 5 6</lx:PntList3D>"))
assert.throws(() => createTinSampler(invalidNumbers.surfaces[0]), /readable PntList/)

const points = [10, 45, 50, 70, 110].map((x, i) => ({ ...p(x), id: `ASB-${i + 1}`, code: "AC20T", elevation: z(x, 10) + (i === 3 ? .025 : .005) }))
const alignment = { name: "MC30", startStation: 30300, length: 120, points: [p(0), p(120)] }
const checked = checkPavementDesign({ surface: parsedSurface, points, alignment, lowerMm: -10, upperMm: 10 })
assert.deepEqual(checked.rows.map((row) => row.status), ["PASS", "OUTSIDE", "PASS", "HIGH", "OUTSIDE"])
assert.equal(checked.rows[1].designLevel, null)
assert.ok(Math.abs(checked.rows[0].differenceMm - 5) < 1e-7)
const bottom = checkBottomSurfaceThickness({ surface: parsedSurface, points, units: "meter", targetMm: 5, toleranceMm: 10 })
assert.equal(bottom.results.length, 3)
assert.equal(bottom.unassessed.length, 2)
const designDocument = { ...document, alignments: [alignment] }
const request = { line: { start: p(0), end: p(120) }, corridor: .3, points: points.map((point) => ({ ...point, colour: "#38bdf8", status: "ASBUILT" })), document: designDocument, alignmentName: alignment.name, mode: "level", scope: "All asbuilt points", crs: "EPSG:2193", datum: "NZVD2016", criteria: { lowerMm: -10, upperMm: 10 } }
const section = analysePavementSection(request)
assert.equal(section.points.length, 5)
assert.equal(section.points[1].fslLevel, null)
assert.ok(section.points[2].fslLevel !== null)
assert.equal(section.samples.find((sample) => sample.distance === 45).level, null)
assert.equal(section.samples.at(-1).level, null)
assert.equal(section.startChainage, 30300)
assert.equal(section.endChainage, 30420)
for (const [i, tick] of pavementSectionTicks(section).entries()) { assert.equal(tick.distance, i * 24); assert.ok(Math.abs(tick.chainage - 30300 - i * 24) < 1e-5) }
const narrowSurface = { ...surface, boundaries: [boundary("outer", rectangle(0, 0, 100, 20)), boundary("void", rectangle(46.01, 0, 46.02, 20))] }
const narrowSection = analysePavementSection({ ...request, document: { ...designDocument, surfaces: [narrowSurface] } })
assert.ok(narrowSection.samples.some((sample) => sample.distance > 46.01 && sample.distance < 46.02 && sample.level === null), "A 10 mm void between regular samples must break the section profile")
const state = { ...defaultPavementDesign, fslDocument: document, alignmentDocument: { ...document, surfaces: [], alignments: [alignment] }, alignmentName: alignment.name, surfaceName: surface.name, datum: "NZVD2016", confirmed: true }
const restored = restorePavementDesign(JSON.parse(JSON.stringify(state)))
assert.deepEqual(restored, state)
assert.equal(createTinSampler(restored.fslDocument.surfaces[0]).find(e + 45, n + 10).status, "OUTSIDE")
assertDocument(document)
const badSaved = structuredClone(document); badSaved.surfaces[0].boundaries[0].points[0].northing = "bad"
assert.throws(() => assertDocument(badSaved), /boundary coordinates/)

const folder = "/workspace/scratch/pavement-boundary-qa-20261103"
fs.mkdirSync(folder, { recursive: true })
fs.writeFileSync(`${folder}/fsl.xml`, xml)
fs.writeFileSync(`${folder}/asbuilt.csv`, ["Point ID,Easting,Northing,Elevation,Code", ...points.map((p) => [p.id, p.easting, p.northing, p.elevation, p.code].join(","))].join("\n"))
fs.writeFileSync(`${folder}/project.surveytool.json`, JSON.stringify({ format: "surveytool-project", version: 1, id: "boundary-qa", tool: "pavement", title: "LandXML boundary QA", savedAt: new Date().toISOString(), state: { bottomFile: null, topFile: { name: "asbuilt.csv", points, warnings: [] }, targetThicknessMm: 75, toleranceMm: 10, coordinateTolerance: .05, matchMode: "auto", mapSettings: { defaultCrs: "EPSG:2193", sourceCrs: {}, basemap: "none", opacity: 90 }, designState: state, workspace: { ...defaultPavementWorkspace, sectionLine: request.line } } }))
const originalFetch = globalThis.fetch
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => { const bytes = fs.readFileSync("public/fonts/survey-report.ttf"); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } })
fs.writeFileSync(`${folder}/section.pdf`, new Uint8Array(await pavementSectionPdf(request, section)))
globalThis.fetch = originalFetch
console.log("TIN boundaries passed: upload parsing, outer/void/island order, concave polygons, edges, edgeTrim modes, invisible faces, invalid polygons, FSL and bottom checks, sections and saved projects.")
