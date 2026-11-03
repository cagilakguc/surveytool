import assert from "node:assert/strict"
import fs from "node:fs"
import { checkBottomSurfaceThickness, defaultPavementBottom, restorePavementBottom } from "../src/lib/pavementBottomSurface.ts"
import { buildPavementMapGeometry, filterThicknessPoints, defaultPavementWorkspace, thicknessClass, pavementThicknessColours } from "../src/lib/pavementMap.ts"
import { analysePavementSection } from "../src/lib/pavementSection.ts"
import { pavementSectionPdf, pavementSectionReport } from "../src/lib/pavementSectionReports.ts"
import { defaultPavementDesign } from "../src/lib/pavementDesign.ts"

const e = 1755000, n = 5923000
const z = (x, y) => 10 + .002 * x - .003 * y
const p = (x, y = 10, elevation = z(x, y)) => ({ easting: e + x, northing: n + y, elevation })
const surface = { name: "Basecourse Survey", points: { a: p(0, 0), b: p(100, 0), c: p(100, 20), d: p(0, 20) }, faces: [["a", "b", "c"], ["a", "c", "d"]], minElevation: 9.94, maxElevation: 10.2 }
const other = { ...surface, name: "Other Bottom", points: Object.fromEntries(Object.entries(surface.points).map(([id, p]) => [id, { ...p, elevation: p.elevation + 1 }])) }
const values = [75, 65, 85, 55, 95]
const points = values.map((thickness, i) => ({ ...p(10 + i * 15, 10, z(10 + i * 15, 10) + thickness / 1000), id: `AC20-${i + 1}`, code: "AC20T" }))
points.push({ ...p(120, 10, z(120, 10) + .075), id: "OUTSIDE-1", code: "AC20T" })
const request = { surface, units: "meter", points, targetMm: 75, toleranceMm: 10 }
const original = structuredClone(request)
const progress = []
const checked = checkBottomSurfaceThickness(request, (p) => progress.push(p))
assert.equal(progress.at(-1), 100)
assert.deepEqual(checked.results.map((row) => row.status), ["pass", "pass", "pass", "fail", "fail"])
assert.deepEqual(checked.results.map((row) => Math.round(row.thicknessMm)), values)
assert.ok(Math.abs(checked.results[0].bottomElevation - z(10, 10)) < 1e-10)
assert.equal(checked.results[0].matchMethod, "bottom-tin")
assert.equal(checked.results[0].horizontalDifference, 0)
assert.equal(checked.results[0].bottomEasting, points[0].easting)
assert.equal(checked.results[0].bottomNorthing, points[0].northing)
assert.equal(checked.unassessed.length, 1)
assert.equal(checked.unassessed[0].reason, "OUTSIDE")
assert.equal("thicknessMm" in checked.unassessed[0], false)
assert.deepEqual(request, original)
assert.equal(filterThicknessPoints(checked.results, "below", 75, 10).length, 2)
assert.equal(filterThicknessPoints(checked.results, "unassessed", 75, 10).length, 0)
const map = buildPavementMapGeometry(checked.results, 10, checked.unassessed)
assert.equal(map.points.at(-1).code, "UNASSESSED")
assert.equal(map.pointColours.UNASSESSED, "#94a3b8")
assert.match(map.points.at(-1).id, /unassessed/)
assert.equal(checkBottomSurfaceThickness({ ...request, surface: other }).results[0].status, "fail")
assert.ok(Math.abs(checkBottomSurfaceThickness({ ...request, surface: other }).results[0].thicknessMm + 925) < 1e-7)
const missing = structuredClone(surface); missing.points.a.elevation = null
assert.equal(checkBottomSurfaceThickness({ ...request, surface: missing }).unassessed[0].reason, "NO_DESIGN_LEVEL")
const overlap = structuredClone(surface)
for (const [id, point] of Object.entries(surface.points)) overlap.points[`${id}2`] = { ...point, elevation: point.elevation + 1 }
overlap.faces.push(["a2", "b2", "c2"], ["a2", "c2", "d2"])
assert.equal(checkBottomSurfaceThickness({ ...request, surface: overlap }).unassessed[0].reason, "AMBIGUOUS")
const hole = { ...surface, faces: [["a", "b", "c"]] }
assert.equal(checkBottomSurfaceThickness({ ...request, surface: hole, points: [{ ...p(10, 15), id: "HOLE", code: "" }] }).unassessed[0].reason, "OUTSIDE")
assert.throws(() => checkBottomSurfaceThickness({ ...request, units: "foot" }), /metre/)
assert.throws(() => checkBottomSurfaceThickness({ ...request, toleranceMm: -1 }), /non-negative/)
assert.throws(() => checkBottomSurfaceThickness({ ...request, surface: { ...surface, hasBoundaryDefinitions: true } }), /boundary/)
const noCoverage = checkBottomSurfaceThickness({ ...request, points: [points.at(-1)] })
assert.equal(noCoverage.results.length, 0)
assert.equal(noCoverage.unassessed.length, 1)

const alignment = { name: "MC30", startStation: 30300, length: 120, points: [p(0, 10), p(120, 10)] }
const document = { fileName: "basecourse.xml", version: "1.2", projectName: "Basecourse to AC20T QA", applicationName: "QA", units: "meter", surfaces: [surface, other], alignments: [alignment], cogoPoints: [], warnings: [] }
const bottomState = { mode: "surface", document, surfaceName: surface.name }
assert.deepEqual(restorePavementBottom(JSON.parse(JSON.stringify(bottomState))), bottomState)
assert.deepEqual(restorePavementBottom(undefined), defaultPavementBottom)
assert.throws(() => restorePavementBottom({ ...bottomState, surfaceName: "Not present" }), /could not be found/)
assert.throws(() => restorePavementBottom({ ...bottomState, mode: "invalid" }), /Invalid/)
const measurements = [...checked.results.map((row) => ({ id: row.id, easting: row.easting, northing: row.northing, elevation: row.topElevation, code: row.code, thicknessMm: row.thicknessMm, deviationMm: row.deviationMm, status: thicknessClass(row, 10), colour: pavementThicknessColours[thicknessClass(row, 10)], bottom: { easting: row.bottomEasting, northing: row.bottomNorthing, elevation: row.bottomElevation } })), ...checked.unassessed.map((row) => ({ id: row.id, easting: row.easting, northing: row.northing, elevation: row.topElevation, code: row.code, status: "UNASSESSED", colour: "#94a3b8" }))]
const sectionRequest = { line: { start: p(0, 10), end: p(120, 10) }, corridor: .3, points: measurements, document: { ...document, surfaces: [] }, bottomDocument: { ...document, surfaces: [surface], alignments: [] }, alignmentName: "MC30", mode: "thickness", scope: "All top / asbuilt points", crs: "EPSG:2193", datum: "NZVD2016", criteria: { targetMm: 75, toleranceMm: 10 } }
const section = analysePavementSection(sectionRequest)
assert.equal(section.points.length, 6)
assert.ok(section.samples.every((sample) => sample.level === null), "The basecourse surface must not be treated as FSL")
assert.ok(Math.abs(section.samples[0].bottomLevel - z(0, 10)) < 1e-10)
assert.equal(section.samples.at(-1).bottomLevel, null)
assert.equal(section.points.at(-1).bottom, undefined)
assert.equal(section.points[0].fslLevel, null)
const sectionReport = pavementSectionReport(sectionRequest, section)
assert.ok(sectionReport.metadata.some(([label, value]) => label === "Bottom TIN surface" && value === surface.name))
assert.equal(sectionReport.rows.at(-1)[6], null)

const folder = "/workspace/scratch/pavement-bottom-qa-20261103"
fs.mkdirSync(folder, { recursive: true })
const xmlSurface = (s) => `<Surface name="${s.name}"><Definition surfType="TIN"><Pnts>${Object.entries(s.points).map(([id, p]) => `<P id="${id}">${p.northing} ${p.easting} ${p.elevation}</P>`).join("")}</Pnts><Faces><F>a b c</F><F>a c d</F></Faces></Definition></Surface>`
fs.writeFileSync(`${folder}/basecourse.xml`, `<?xml version="1.0"?><LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2"><Units><Metric linearUnit="meter"/></Units><Surfaces>${xmlSurface(surface)}${xmlSurface(other)}</Surfaces></LandXML>`)
fs.writeFileSync(`${folder}/ac20t.csv`, ["Point ID,Easting,Northing,Elevation,Code", ...points.map((p) => [p.id, p.easting, p.northing, p.elevation, p.code].join(","))].join("\n"))
fs.writeFileSync(`${folder}/project.surveytool.json`, JSON.stringify({ format: "surveytool-project", version: 1, id: "bottom-tin-qa", tool: "pavement", title: "Basecourse to AC20T QA", savedAt: new Date().toISOString(), state: { bottomFile: null, topFile: { name: "ac20t.csv", points, warnings: [] }, targetThicknessMm: 75, toleranceMm: 10, coordinateTolerance: .05, matchMode: "auto", mapSettings: { defaultCrs: "EPSG:2193", sourceCrs: {}, basemap: "none", opacity: 90 }, bottomState, designState: { ...defaultPavementDesign, alignmentDocument: { ...document, surfaces: [] }, alignmentName: "MC30", datum: "NZVD2016" }, workspace: { ...defaultPavementWorkspace, sectionLine: sectionRequest.line } } }))
const originalFetch = globalThis.fetch
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => { const bytes = fs.readFileSync("public/fonts/survey-report.ttf"); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } })
fs.writeFileSync(`${folder}/section.pdf`, new Uint8Array(await pavementSectionPdf(sectionRequest, section)))
globalThis.fetch = originalFetch
console.log("Bottom TIN passed: original-XY interpolation, independent point IDs, inclusive tolerances, selected surfaces, holes/outside/missing/conflicting levels, unit guard, grey unassessed points, saved state and a separate bottom section profile/PDF.")
