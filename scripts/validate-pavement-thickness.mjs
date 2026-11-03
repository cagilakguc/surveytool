import assert from "node:assert/strict"
import fs from "node:fs"
import { checkBottomSurfaceThickness } from "../src/lib/pavementBottomSurface.ts"
import { thicknessAcceptanceLabel, thicknessCriteriaMetadata, thicknessPasses, restoreThicknessRule } from "../src/lib/pavementThickness.ts"
import { buildPavementMapGeometry, defaultPavementWorkspace, filterThicknessPoints, thicknessClass, pavementThicknessColours } from "../src/lib/pavementMap.ts"
import { checkPavementDesign, defaultPavementDesign } from "../src/lib/pavementDesign.ts"
import { analysePavementSection } from "../src/lib/pavementSection.ts"
import { pavementSectionPdf, pavementSectionReport } from "../src/lib/pavementSectionReports.ts"

const e = 1755000, n = 5923000
const p = (x, y = 10, elevation = 100) => ({ easting: e + x, northing: n + y, elevation })
const surface = { name: "Basecourse", points: { a: p(0, 0), b: p(100, 0), c: p(100, 20), d: p(0, 20) }, faces: [["a", "b", "c"], ["a", "c", "d"]], minElevation: 100, maxElevation: 100 }
const values = [65, 74.9, 75, 85, 150, 300]
const top = values.map((thickness, i) => ({ ...p(5 + i * 10, 10, 100 + thickness / 1000), id: `AC20-${i + 1}`, code: "AC20T" }))
top.push({ ...p(120, 10, 100.075), id: "OUTSIDE", code: "AC20T" })
const request = { surface, units: "meter", points: top, targetMm: 75, toleranceMm: 20, rule: "minimum" }
const original = structuredClone(request)
const result = checkBottomSurfaceThickness(request)
assert.deepEqual(result.results.map((row) => row.status), ["fail", "fail", "pass", "pass", "pass", "pass"])
assert.equal(result.unassessed.length, 1)
assert.equal(result.unassessed[0].reason, "OUTSIDE")
assert.deepEqual(request, original)
assert.deepEqual(result.results.map((row) => thicknessClass(row, 20, "minimum")), ["TOO THIN", "TOO THIN", "MEETS MINIMUM", "MEETS MINIMUM", "MEETS MINIMUM", "MEETS MINIMUM"])
assert.deepEqual(filterThicknessPoints(result.results, "outside", 150, 20, "minimum").map((row) => row.id), ["AC20-1", "AC20-2"], "The failure filter uses the required minimum, independent of the custom display cutoff")
assert.equal(filterThicknessPoints(result.results, "below", 150, 20, "minimum").length, 4)
assert.equal(filterThicknessPoints(result.results, "at-above", 150, 20, "minimum").length, 2)
const geometry = buildPavementMapGeometry(result.results, 20, result.unassessed, "minimum")
assert.deepEqual(Object.keys(geometry.pointColours), ["TOO THIN", "MEETS MINIMUM", "UNASSESSED"])
assert.equal(geometry.pointColours[geometry.points[5].code], "#38bdf8", "300 mm must be blue and pass a 75 mm minimum")
assert.ok(geometry.points[0].radius > geometry.points[2].radius)
assert.deepEqual(checkBottomSurfaceThickness({ ...request, targetMm: 150 }).results.map((row) => row.status), ["fail", "fail", "fail", "fail", "pass", "pass"])
assert.deepEqual(checkBottomSurfaceThickness({ ...request, rule: "target-tolerance", toleranceMm: 10 }).results.map((row) => row.status), ["pass", "pass", "pass", "pass", "fail", "fail"])
assert.deepEqual(checkBottomSurfaceThickness({ ...request, toleranceMm: 0 }).results.map((row) => row.status), result.results.map((row) => row.status), "A minimum-only rule ignores the saved two-sided tolerance")
assert.equal(thicknessPasses(-.001, 20, "minimum"), false)
assert.equal(thicknessPasses(0, 20, "minimum"), true)
assert.equal(thicknessPasses(1_000_000, 0, "minimum"), true)
assert.equal(thicknessPasses(NaN, 20, "minimum"), false)
assert.throws(() => checkBottomSurfaceThickness({ ...request, rule: "invalid" }), /acceptance rule/)
assert.equal(restoreThicknessRule(JSON.parse(JSON.stringify({ thicknessRule: "minimum" })).thicknessRule), "minimum")
assert.equal(restoreThicknessRule(undefined), "target-tolerance", "Old saved projects retain their original assessment rule")
assert.throws(() => restoreThicknessRule("invalid"), /acceptance rule/)
assert.equal(thicknessAcceptanceLabel(75, 20, "minimum"), "Minimum 75 mm · no upper limit")
assert.ok(thicknessCriteriaMetadata(75, 20, "minimum").some(([key, value]) => key === "Upper thickness limit" && value === "None"))
assert.ok(thicknessCriteriaMetadata(75, 20, "minimum").every(([key]) => !/tolerance|target/i.test(key)))

// FSL point checks remain ±10 mm, independently of the minimum thickness rule.
const fsl = { ...surface, name: "FSL", points: Object.fromEntries(Object.entries(surface.points).map(([id, point]) => [id, { ...point, elevation: 100.075 }])), minElevation: 100.075, maxElevation: 100.075 }
const levels = checkPavementDesign({ points: top, surface: fsl, lowerMm: -10, upperMm: 10 })
assert.deepEqual(levels.rows.map((row) => row.status), ["PASS", "PASS", "PASS", "PASS", "HIGH", "HIGH", "OUTSIDE"])
assert.equal(checkPavementDesign({ points: [{ ...top[0], elevation: 100.064 }], surface: fsl, lowerMm: -10, upperMm: 10 }).rows[0].status, "LOW")
assert.equal(checkPavementDesign({ points: [{ ...top[0], elevation: 100.086 }], surface: fsl, lowerMm: -10, upperMm: 10 }).rows[0].status, "HIGH")

const alignment = { name: "MC30", startStation: 30300, length: 120, points: [p(0), p(120)] }
const document = { fileName: "basecourse.xml", version: "1.2", projectName: "Minimum thickness QA", applicationName: "QA", units: "meter", surfaces: [surface], alignments: [], cogoPoints: [], warnings: [] }
const designDocument = { ...document, fileName: "fsl.xml", surfaces: [fsl], alignments: [alignment] }
const measurements = [...result.results.map((row) => ({ id: row.id, easting: row.easting, northing: row.northing, elevation: row.topElevation, code: row.code, thicknessMm: row.thicknessMm, deviationMm: row.deviationMm, status: thicknessClass(row, 20, "minimum"), colour: pavementThicknessColours[thicknessClass(row, 20, "minimum")], bottom: { easting: row.bottomEasting, northing: row.bottomNorthing, elevation: row.bottomElevation } })), ...result.unassessed.map((row) => ({ ...row, elevation: row.topElevation, status: "UNASSESSED", colour: "#94a3b8" }))]
const sectionRequest = { line: { start: p(0), end: p(120) }, corridor: .3, points: measurements, document: designDocument, bottomDocument: document, alignmentName: "MC30", mode: "thickness", scope: "All top / asbuilt points", crs: "EPSG:2193", datum: "NZVD2016", criteria: { targetMm: 75, toleranceMm: 20, thicknessRule: "minimum" } }
const section = analysePavementSection(sectionRequest)
const report = pavementSectionReport(sectionRequest, section)
assert.ok(report.metadata.some(([key, value]) => key === "Minimum thickness (mm)" && value === 75))
assert.ok(report.metadata.some(([key, value]) => key === "Upper thickness limit" && value === "None"))
assert.ok(report.metadata.every(([key]) => !key.includes("tolerance")))
assert.equal(report.rows[5][10], "MEETS MINIMUM")
assert.match(report.columns[7], /minimum/)
assert.ok(report.notes.some((note) => /No upper thickness limit/.test(note)))
const levelReport = pavementSectionReport({ ...sectionRequest, mode: "level", criteria: { lowerMm: -10, upperMm: 10 } }, section)
assert.ok(levelReport.metadata.some(([key, value]) => key === "FSL lower tolerance (mm)" && value === -10))
assert.ok(levelReport.metadata.every(([key]) => !key.includes("thickness")))

const folder = "/workspace/scratch/pavement-minimum-qa-20261103"
fs.mkdirSync(folder, { recursive: true })
const bottom = top.slice(0, 6).map((point) => ({ ...point, elevation: 100, code: "BASECOURSE" }))
const state = { topFile: { name: "ac20t.csv", points: top, warnings: [] }, targetThicknessMm: 75, toleranceMm: 20, thicknessRule: "minimum", coordinateTolerance: .05, matchMode: "auto", mapSettings: { defaultCrs: "EPSG:2193", sourceCrs: {}, basemap: "none", opacity: 90 }, designState: { ...defaultPavementDesign, alignmentDocument: { ...designDocument, surfaces: [] }, fslDocument: designDocument, surfaceName: "FSL", alignmentName: "MC30", datum: "NZVD2016", confirmed: true }, workspace: { ...defaultPavementWorkspace, sectionLine: sectionRequest.line } }
for (const [mode, additions] of Object.entries({ points: { bottomFile: { name: "basecourse.csv", points: bottom, warnings: [] } }, tin: { bottomFile: null, bottomState: { mode: "surface", document, surfaceName: "Basecourse" } } })) fs.writeFileSync(`${folder}/${mode}.surveytool.json`, JSON.stringify({ format: "surveytool-project", version: 1, id: `minimum-${mode}-qa`, tool: "pavement", title: `Minimum 75 mm ${mode} QA`, savedAt: new Date().toISOString(), state: { ...state, ...additions } }))
const originalFetch = globalThis.fetch
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => { const bytes = fs.readFileSync("public/fonts/survey-report.ttf"); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } })
fs.writeFileSync(`${folder}/section.pdf`, new Uint8Array(await pavementSectionPdf(sectionRequest, section)))
globalThis.fetch = originalFetch
console.log("Thickness acceptance passed: exact 75/150 mm minima, no upper limit, red/blue classes and filters, separate ±10 mm FSL checks, legacy and new saved rules, section metadata and PDF.")
