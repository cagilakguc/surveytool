import assert from "node:assert/strict"
import fs from "node:fs"
import { analysePavementSection, formatPavementSlope, pavementSlopeLabelSegments } from "../src/lib/pavementSection.ts"
import { pavementSectionCsv, pavementSectionPdf, pavementSectionReport } from "../src/lib/pavementSectionReports.ts"
import { defaultPavementDesign } from "../src/lib/pavementDesign.ts"
import { defaultPavementWorkspace } from "../src/lib/pavementMap.ts"

const e = 1755000, n = 5923000
const p = (x, y = 0, elevation = 100 + .02 * x + .5 * y) => ({ easting: e + x, northing: n + y, elevation })
const surface = { name: "FSL", points: { a: p(0, -2), b: p(20, -2), c: p(20, 2), d: p(0, 2) }, faces: [["a", "b", "c"], ["a", "c", "d"]], minElevation: 99, maxElevation: 101.4 }
const alignment = { name: "MC30", startStation: 1000, length: 20, points: [p(0), p(20)] }
const document = { fileName: "fsl.xml", version: "1.2", projectName: "Slope QA", applicationName: "QA", units: "meter", surfaces: [surface], alignments: [alignment], cogoPoints: [], warnings: [] }
const points = [0, 10, 20].map((x, i) => ({ ...p(x, i === 1 ? -.2 : .2, 100.01 + .03 * x), id: `P${i + 1}`, code: "AC20", colour: "#38bdf8", status: "ASBUILT" }))
const request = { line: { start: p(0), end: p(20) }, corridor: .3, points: [points[2], points[0], points[1]], document, alignmentName: "MC30", mode: "level", scope: "All asbuilt points", crs: "EPSG:2193", datum: "NZVD2016", criteria: { lowerMm: -10, upperMm: 10 } }
const original = structuredClone(request)
const result = analysePavementSection(request)
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)
assert.deepEqual(result.points.map((point) => point.id), ["P1", "P2", "P3"], "Connections follow section distance, independently of import order")
assert.deepEqual(result.segments.map(({ startIndex, endIndex, run }) => [startIndex, endIndex, run]), [[0, 1, 10], [1, 2, 10]])
for (const segment of result.segments) { close(segment.asbuiltSlopePercent, 3); close(segment.designSlopePercent, 2) }
close(result.points[0].fslLevel, 100.1)
close(result.segments[0].designStartLevel, 100)
close(result.points[0].fslDifferenceMm, -90)
assert.deepEqual(request, original, "Measured RLs and input ordering are retained")
const reverse = analysePavementSection({ ...request, line: { start: p(20), end: p(0) } })
assert.deepEqual(reverse.points.map((point) => point.id), ["P3", "P2", "P1"])
for (const segment of reverse.segments) { close(segment.asbuiltSlopePercent, -3); close(segment.designSlopePercent, -2) }

const noDesign = analysePavementSection({ ...request, document: undefined })
assert.equal(noDesign.segments.length, 2)
assert.ok(noDesign.segments.every((segment) => segment.designSlopePercent === null))
const flat = analysePavementSection({ ...request, points: points.map((point) => ({ ...point, elevation: 100 })) })
assert.ok(flat.segments.every((segment) => segment.asbuiltSlopePercent === 0))
for (const selection of [[], points.slice(0, 1)]) assert.equal(analysePavementSection({ ...request, points: selection }).segments.length, 0)
const duplicate = analysePavementSection({ ...request, points: [...points, { ...points[1], id: "DUPLICATE", elevation: 103 }] })
assert.equal(duplicate.segments.length, 0, "Coincident section distances cannot choose an arbitrary RL or create a near-vertical slope")
const invalid = analysePavementSection({ ...request, points: [...points, { ...points[1], elevation: NaN }] })
assert.equal(invalid.points.length, 3)

// A 1 mm design void between regular samples must invalidate the interval slope.
const hole = { name: "void", type: "void", edgeTrim: true, points: [p(7.001, -1), p(7.002, -1), p(7.002, 1), p(7.001, 1)] }
const gap = analysePavementSection({ ...request, document: { ...document, surfaces: [{ ...surface, boundaries: [hole] }] } })
assert.equal(gap.segments[0].designSlopePercent, null)
close(gap.segments[1].designSlopePercent, 2)
assert.equal(gap.segments.length, 2, "Asbuilt connections remain available where design is missing")

// Opposing crossfalls across a crown are reported explicitly as an interval average.
const crown = { ...surface, points: { a: p(0, -1, 100), b: p(10, -1, 100.2), c: p(20, -1, 100), d: p(0, 1, 100), f: p(10, 1, 100.2), g: p(20, 1, 100) }, faces: [["a", "b", "f"], ["a", "f", "d"], ["b", "c", "g"], ["b", "g", "f"]] }
const crownResult = analysePavementSection({ ...request, points: [points[0], points[2]], document: { ...document, surfaces: [crown] } })
close(crownResult.segments[0].designSlopePercent, 0)
assert.ok(Math.max(...crownResult.samples.map((sample) => sample.level ?? -Infinity)) > 100.19)
assert.equal(formatPavementSlope(2), "+2.00%")
assert.equal(formatPavementSlope(-2), "-2.00%")
assert.equal(formatPavementSlope(-.00001), "0.00%")
assert.equal(formatPavementSlope(null), "—")
assert.equal(pavementSlopeLabelSegments(result).length, 2)
const dense = analysePavementSection({ ...request, points: Array.from({ length: 2001 }, (_, i) => ({ ...points[0], ...p(i / 100, 0, 100 + .03 * i / 100), id: `D${i}` })) })
assert.equal(dense.segments.length, 2000)
assert.equal(dense.samples.length, 161, "Dense measured surveys must not create an SVG design element for every point")
close(dense.segments[1777].designSlopePercent, 2)

const report = pavementSectionReport(request, result)
assert.deepEqual(report.columns.slice(-4), ["Slope from point", "Horizontal run (m)", "Asbuilt slope (%)", "Design avg slope (%)"])
assert.deepEqual(report.rows[0].slice(-4), [null, null, null, null])
assert.equal(report.rows[1][13], "P1")
close(report.rows[1][15], 3); close(report.rows[1][16], 2)
assert.match(pavementSectionCsv(request, result), /Asbuilt slope \(%\),Design avg slope \(%\)/)
assert.ok(report.notes.some((note) => /original survey XY/.test(note)))

const folder = "/workspace/scratch/7fc8f165d315/pavement-slope-qa"
fs.mkdirSync(folder, { recursive: true })
const project = { format: "surveytool-project", version: 1, id: "slope-qa", tool: "pavement", title: "Pavement slope QA", savedAt: new Date().toISOString(), state: { bottomFile: null, topFile: { name: "asbuilt.csv", points, warnings: [] }, targetThicknessMm: 75, toleranceMm: 10, coordinateTolerance: .05, matchMode: "auto", mapSettings: { defaultCrs: "EPSG:2193", sourceCrs: {}, basemap: "none", opacity: 90 }, designState: { ...defaultPavementDesign, fslDocument: document, alignmentDocument: { ...document, surfaces: [] }, alignmentName: "MC30", surfaceName: "FSL", datum: "NZVD2016", confirmed: true }, workspace: { ...defaultPavementWorkspace, sectionLine: request.line } } }
fs.writeFileSync(`${folder}/project.surveytool.json`, JSON.stringify(project))
fs.writeFileSync(`${folder}/section.csv`, pavementSectionCsv(request, result))
const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => { const bytes = fs.readFileSync("public/fonts/survey-report.ttf"); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } })
  for (const [name, data, input] of [["slopes", result, request], ["empty", analysePavementSection({ ...request, points: [] }), { ...request, points: [] }], ["gap", gap, request]]) {
    const pdf = await pavementSectionPdf(input, data)
    assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), "%PDF-")
    fs.writeFileSync(`${folder}/${name}.pdf`, new Uint8Array(pdf))
  }
} finally { globalThis.fetch = originalFetch }
console.log("Pavement slopes passed: section-order auto lines, real rise/run, signed/reversed/flat slopes, original-XY conformance, on-line design averages, crowns, narrow gaps, duplicate positions, absent data, CSV and PDF.")
