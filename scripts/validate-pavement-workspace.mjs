import assert from "node:assert/strict"
import fs from "node:fs"
import { buildPavementMapGeometry, defaultPavementWorkspace, filterThicknessPoints, thicknessClass, pavementThicknessColours, pavementDxfGroups, withPavementDxf, restorePavementWorkspace, pavementReportLines } from "../src/lib/pavementMap.ts"
import { buildGisMapData } from "../src/lib/gisMapGeometry.ts"
import { parseSurveyGeometryFile } from "../src/lib/surveyGeometry.ts"
import { analysePavementSection } from "../src/lib/pavementSection.ts"
import { pavementSectionCsv, pavementSectionPdf } from "../src/lib/pavementSectionReports.ts"
import { createReportPdf } from "../src/lib/surveyReports.ts"
import { defaultPavementDesign } from "../src/lib/pavementDesign.ts"

const e = 1755000, n = 5923000
const p = (x, y = 0, elevation = 100 + .001 * x + .002 * y) => ({ easting: e + x, northing: n + y, elevation })
const values = [50, 75, 150, 165, 200, 140]
const top = values.map((thickness, i) => ({ id: `P${i + 1}`, ...p((i + 1) * 10, .15), code: "AC20" }))
const bottom = top.map((point, i) => ({ ...point, easting: point.easting + .005, elevation: point.elevation - values[i] / 1000, code: "BC" }))
const rows = top.map((point, i) => ({ ...point, topElevation: point.elevation, bottomElevation: bottom[i].elevation, bottomEasting: bottom[i].easting, bottomNorthing: bottom[i].northing, thicknessMm: values[i], deviationMm: values[i] - 150, status: Math.abs(values[i] - 150) <= 10 ? "pass" : "fail" }))
assert.deepEqual(rows.map((row) => thicknessClass(row, 10)), ["TOO THIN", "TOO THIN", "WITHIN TOLERANCE", "TOO THICK", "TOO THICK", "WITHIN TOLERANCE"])
assert.deepEqual(filterThicknessPoints(rows, "below", 75, 10).map((row) => row.id), ["P1"])
assert.deepEqual(filterThicknessPoints(rows, "at-above", 75, 10).map((row) => row.id), ["P2", "P3", "P4", "P5", "P6"])
assert.deepEqual(filterThicknessPoints(rows, "below", 150, 10).map((row) => row.id), ["P1", "P2", "P6"])
assert.deepEqual(filterThicknessPoints(rows, "outside", 150, 10).map((row) => row.id), ["P1", "P2", "P4", "P5"])
assert.equal(filterThicknessPoints(rows, "below", 0, 10).length, 0)
const geometry = buildPavementMapGeometry(rows, 10)
assert.equal(geometry.points[0].label, "50")
assert.ok(geometry.points[0].radius > geometry.points[2].radius)
assert.equal(geometry.pointColours[geometry.points[2].code], "#38bdf8")

const pairs = [0,"SECTION",2,"ENTITIES",0,"LINE",8,"KERB",10,e,20,n-5,11,e+70,21,n-5,0,"LINE",8,"EDGE",10,e,20,n+5,11,e+70,21,n+5,0,"ENDSEC",0,"EOF"]
const dxfText = pairs.join("\n") + "\n"
const dxf = await parseSurveyGeometryFile(new File([dxfText], "strings.dxf"))
assert.equal(dxf.lines.length, 2)
const groups = pavementDxfGroups([dxf])
assert.equal(groups.length, 2)
assert.match(groups[0].label, /KERB/)
const original = structuredClone(dxf)
const combined = withPavementDxf(geometry, [dxf], [])
assert.equal(combined.lines.length, 2)
const hidden = withPavementDxf(geometry, [dxf], [groups[0].key])
assert.equal(hidden.lines.length, 1)
assert.match(hidden.lines[0].code, /EDGE/)
assert.deepEqual(dxf, original)
const catalogue = JSON.parse(fs.readFileSync("public/data/coordinate-systems.json", "utf8"))
const map = buildGisMapData(catalogue.find((crs) => crs.code === "EPSG:2193"), combined)
assert.ok(map.groups.some((g) => g.label.includes("KERB")))
assert.ok(map.groups.some((g) => g.label.includes("EDGE")))
assert.equal(map.features.find((f) => f.get("id")?.startsWith("P3")).get("colour"), "#38bdf8")
const crowded = { ...combined, lines: Array.from({ length: 6000 }, (_, i) => ({ ...combined.lines[0], id: String(i) })) }
assert.ok(buildGisMapData(catalogue.find((crs) => crs.code === "EPSG:2193"), crowded).features.some((f) => f.get("id")?.startsWith("P1")), "DXF features must not consume the whole measured point budget")

const surface = { name: "FSL", points: { a: p(0, -10), b: p(70, -10), c: p(70, 10), d: p(0, 10) }, faces: [["a", "b", "c"], ["a", "c", "d"]], minElevation: 99.98, maxElevation: 100.09 }
const alignment = { name: "MC30", startStation: 30300, length: 70, points: [p(0), p(70)] }
const doc = { fileName: "fsl.xml", version: "1.2", projectName: "Pavement QA", applicationName: "QA", units: "meter", surfaces: [surface], alignments: [alignment], cogoPoints: [], warnings: [] }
const measurements = rows.map((row, i) => ({ ...top[i], thicknessMm: row.thicknessMm, deviationMm: row.deviationMm, colour: pavementThicknessColours[thicknessClass(row, 10)], status: thicknessClass(row, 10), bottom: bottom[i] }))
const request = { line: { start: p(0), end: p(70) }, corridor: .3, points: measurements, document: doc, alignmentName: "MC30", mode: "thickness", scope: "All matched points", crs: "EPSG:2193", datum: "NZVD2016", criteria: { targetMm: 150, toleranceMm: 10 } }
const section = analysePavementSection(request)
assert.equal(section.points.length, 6)
assert.ok(Math.abs(section.points[0].chainage - 30310) < .0001)
assert.ok(Math.abs(section.points[0].bottomDistance - 10.005) < 1e-6)
assert.ok(Math.abs(section.points[0].fslLevel - top[0].elevation) < 1e-8, "FSL must use the point's original XY, not its projection onto the drawn line")
assert.ok(Math.abs(section.points[0].offLine - .15) < 1e-8)
assert.equal(section.startChainage, 30300)
assert.equal(section.endChainage, 30370)
assert.equal(analysePavementSection({ ...request, corridor: .1 }).points.length, 0)
assert.equal(analysePavementSection({ ...request, points: measurements.slice(0, 1), scope: "Below 75 mm" }).points.length, 1)
assert.equal(analysePavementSection({ ...request, line: { start: p(70), end: p(0) } }).points[0].id, "P6")
assert.throws(() => analysePavementSection({ ...request, corridor: 0 }), /positive/)
assert.throws(() => analysePavementSection({ ...request, document: { ...doc, units: "foot" } }), /metre/)
assert.equal(analysePavementSection({ ...request, document: undefined }).samples[0].level, null)
assert.equal(analysePavementSection({ ...request, document: undefined }).points[0].chainage, null)
const gap = { ...surface, faces: [["a", "b", "c"]] }
assert.ok(analysePavementSection({ ...request, document: { ...doc, surfaces: [gap] }, line: { start: p(0, 5), end: p(70, 5) } }).samples.some((s) => s.level === null))
assert.match(pavementSectionCsv(request, section), /30310\.000|30\+310\.000/)
const state = { ...defaultPavementWorkspace, overlays: [dxf], hiddenLayers: [groups[1].key], filter: "below", cutoffMm: 75, sectionLine: request.line }
assert.deepEqual(restorePavementWorkspace(JSON.parse(JSON.stringify(state))), state)
assert.deepEqual(restorePavementWorkspace(undefined), defaultPavementWorkspace)
assert.throws(() => restorePavementWorkspace({ ...state, cutoffMm: NaN }), /Invalid/)

const folder = "/workspace/scratch/pavement-workspace-qa-20261103"
fs.mkdirSync(folder, { recursive: true })
const project = { format: "surveytool-project", version: 1, id: "pavement-workspace-qa", tool: "pavement", title: "Pavement Workspace QA", savedAt: new Date().toISOString(), state: { bottomFile: { name: "bottom.csv", points: bottom, warnings: [] }, topFile: { name: "top.csv", points: top, warnings: [] }, targetThicknessMm: 150, toleranceMm: 10, coordinateTolerance: .05, matchMode: "auto", mapSettings: { defaultCrs: "EPSG:2193", sourceCrs: {}, basemap: "none", opacity: 90 }, designState: { ...defaultPavementDesign, alignmentDocument: { ...doc, fileName: "alignment.xml", surfaces: [] }, fslDocument: doc, alignmentName: "MC30", surfaceName: "FSL", datum: "NZVD2016", confirmed: true }, workspace: { ...defaultPavementWorkspace } } }
fs.writeFileSync(`${folder}/project.surveytool.json`, JSON.stringify(project))
fs.writeFileSync(`${folder}/strings.dxf`, dxfText)
const originalFetch = globalThis.fetch
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => { const bytes = fs.readFileSync("public/fonts/survey-report.ttf"); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } })
const pdf = await pavementSectionPdf(request, section)
assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), "%PDF-")
fs.writeFileSync(`${folder}/section.pdf`, new Uint8Array(pdf))
fs.writeFileSync(`${folder}/section.csv`, pavementSectionCsv(request, section))
const filtered = filterThicknessPoints(rows, "below", 150, 10)
const report = { title: "Filtered pavement thickness", project: "QA", createdAt: new Date().toISOString(), metadata: [["Point filter", "Below 150 mm"]], summary: [["Points", filtered.length]], columns: ["Point", "Thickness (mm)"], rows: filtered.map((row) => [row.id, row.thicknessMm]), notes: ["Blue: within tolerance; red: too thin; amber: too thick. DXF strings are source-grid reference lines."], plot: { points: filtered.map((row) => ({ ...row, colour: pavementThicknessColours[thicknessClass(row, 10)], label: `${row.thicknessMm} mm` })), lines: pavementReportLines(combined), legend: pavementThicknessColours } }
fs.writeFileSync(`${folder}/filtered-report.pdf`, new Uint8Array(await createReportPdf(report)))
globalThis.fetch = originalFetch
console.log("Pavement workspace passed: 75/150 cutoffs, inclusive thickness classes, DXF layers and hiding, measured point budget, original-XY sections, chainages, corridor limits, holes, restored settings, filtered plan and graphical section PDFs.")
