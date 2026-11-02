import assert from "node:assert/strict"
import fs from "node:fs"
import { checkPavementDesign, defaultPavementDesign, pavementDesignMapGeometry, pavementDesignReport, pavementDesignUnitError, restorePavementDesign } from "../src/lib/pavementDesign.ts"
import { alignmentChainageMarkers, createAlignmentProjector, formatChainage } from "../src/lib/alignmentStationing.ts"
import { createReportCsv } from "../src/lib/surveyReports.ts"

const e = 1755000, n = 5923000
const p = (x, y, elevation = 100 + x * .001 + y * .002) => ({ easting: e + x, northing: n + y, elevation })
const surface = { name: "FSL plane", points: { a: p(0, -20), b: p(100, -20), c: p(100, 20), d: p(0, 20) }, faces: [["a", "b", "c"], ["a", "c", "d"]], minElevation: 99.96, maxElevation: 100.14 }
const alignment = { name: "MC30", length: 100, startStation: 30300, points: [p(0, 0), p(100, 0)], horizontalGeometry: [{ type: "line", start: p(0, 0), end: p(100, 0), attributes: { length: "100" } }] }
const input = [[20, 5, .005], [40, -5, .025], [60, 5, -.025], [80, 0, .010], [110, 0, 0], [-1, 0, 0]].map(([x, y, dz], i) => ({ ...p(x, y, 100 + x * .001 + y * .002 + dz), id: `P${i + 1}`, code: "AC20" }))
const request = { points: input, surface, alignment, lowerMm: -10, upperMm: 10 }
const original = structuredClone(request)
const result = checkPavementDesign(request)
assert.deepEqual(result.rows.map((row) => row.status), ["PASS", "HIGH", "LOW", "PASS", "OUTSIDE", "OUTSIDE"])
assert.ok(Math.abs(result.rows[0].designLevel - 100.03) < 1e-9)
assert.ok(Math.abs(result.rows[0].differenceMm - 5) < 1e-7)
assert.ok(Math.abs(result.rows[0].chainage - 30320) < 1e-4)
assert.ok(Math.abs(result.rows[0].offset - 5) < 1e-6)
assert.ok(Math.abs(result.rows[1].offset + 5) < 1e-6)
assert.equal(result.rows[4].stationStatus, "AFTER_END")
assert.equal(result.rows[5].stationStatus, "BEFORE_START")
assert.equal(result.rows[4].chainage, null)
assert.deepEqual(request, original)
const noAlignment = checkPavementDesign({ ...request, alignment: undefined })
assert.equal(noAlignment.rows[0].status, "PASS")
assert.equal(noAlignment.rows[0].stationStatus, "NO_ALIGNMENT")
const extended = { ...surface, points: { a: p(-20, -20), b: p(120, -20), c: p(120, 20), d: p(-20, 20) } }
assert.equal(checkPavementDesign({ ...request, surface: extended }).rows[4].status, "PASS", "FSL coverage is independent of alignment endpoints")
assert.throws(() => checkPavementDesign({ ...request, lowerMm: 20, upperMm: -20 }), /lower/)
assert.throws(() => checkPavementDesign({ ...request, alignment: { ...alignment, hasStationEquations: true } }), /station equations/)
const missing = structuredClone(surface); missing.points.a.elevation = null
assert.equal(checkPavementDesign({ ...request, surface: missing }).rows[0].status, "NO_DESIGN_LEVEL")
const overlapping = structuredClone(surface)
for (const [id, point] of Object.entries(surface.points)) overlapping.points[`${id}2`] = { ...point, elevation: point.elevation + 1 }
overlapping.faces.push(["a2", "b2", "c2"], ["a2", "c2", "d2"])
assert.equal(checkPavementDesign({ ...request, surface: overlapping }).rows[0].status, "AMBIGUOUS")
const reversed = { ...alignment, horizontalGeometry: undefined, points: [p(100, 0), p(0, 0)] }
const reverseStation = createAlignmentProjector(reversed)(p(20, 5))
assert.ok(Math.abs(reverseStation.chainage - 30380) < 1e-4)
assert.ok(Math.abs(reverseStation.offset + 5) < 1e-6)
const arc = { name: "Curve", length: Math.PI * 50, startStation: 1000, points: [p(100, 0), p(0, 100)], horizontalGeometry: [{ type: "curve", start: p(100, 0), center: p(0, 0), end: p(0, 100), attributes: { rot: "ccw", length: String(Math.PI * 50) } }] }
const curved = createAlignmentProjector(arc)(p(105 / Math.sqrt(2), 105 / Math.sqrt(2)))
assert.ok(Math.abs(curved.chainage - (1000 + Math.PI * 25)) < .0001, "Chainage follows the exact arc")
assert.ok(Math.abs(curved.offset + 5) < .000001)
assert.equal(formatChainage(30330.065), "30+330.065")
assert.equal(formatChainage(999.9999), "1+000.000")
assert.equal(formatChainage(-10), "-0+010.000")
assert.equal(alignmentChainageMarkers(alignment, 10).markers.length, 11)
assert.equal(alignmentChainageMarkers(alignment, 20).markers[1].chainage, 30320)
assert.throws(() => alignmentChainageMarkers(alignment, 0), /positive/)
const long = { name: "Long", startStation: 0, length: 1_000_000, points: [p(0, 0), p(1_000_000, 0)] }
assert.ok(alignmentChainageMarkers(long).markers.length <= 2001)

const doc = { fileName: "design.xml", version: "1.2", projectName: "QA", applicationName: "QA", units: "meter", surfaces: [surface], alignments: [alignment], cogoPoints: [], warnings: [] }
const state = { ...defaultPavementDesign, fslDocument: doc, alignmentDocument: { ...doc, fileName: "alignment.xml", surfaces: [] }, alignmentName: alignment.name, surfaceName: surface.name, confirmed: true, datum: "NZVD2016" }
assert.equal(pavementDesignUnitError(doc), "")
assert.match(pavementDesignUnitError({ ...doc, units: "foot" }), /metre/)
assert.deepEqual(restorePavementDesign(undefined), defaultPavementDesign)
assert.deepEqual(restorePavementDesign(JSON.parse(JSON.stringify(state))), state)
assert.throws(() => restorePavementDesign({ ...state, labelInterval: -1 }), /Invalid/)
const report = pavementDesignReport(result, state, "asbuilt.csv", "EPSG:2193", [])
assert.equal(report.rows.length, input.length)
assert.equal(report.rows[0][3].toFixed(3), "30320.000")
assert.equal(report.rows[4][7], null)
const csv = createReportCsv(report)
assert.match(csv, /FSL RL/)
assert.match(csv, /NZVD2016/)
assert.match(csv, /AFTER_END/)
assert.equal(pavementDesignMapGeometry(input, result).points[0].code, "PASS")
assert.match(pavementDesignMapGeometry(input, result).points[0].id, /CH 30\+320/)
assert.equal(pavementDesignMapGeometry(input, null).points[0].code, "ASBUILT")

// Synthetic browser fixtures stay in /tmp; no customer data is used.
const folder = "/tmp/surveytool-pavement-qa"
fs.mkdirSync(folder, { recursive: true })
const xml = `<?xml version="1.0"?><LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2"><Units><Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="milliBars"/></Units><Alignments><Alignment name="MC30" length="100" staStart="30300"><CoordGeom><Line length="100"><Start>${n} ${e}</Start><End>${n} ${e + 100}</End></Line></CoordGeom></Alignment><Alignment name="Other alignment" length="100" staStart="1000"><CoordGeom><Line length="100"><Start>${n + 10} ${e}</Start><End>${n + 10} ${e + 100}</End></Line></CoordGeom></Alignment></Alignments><Surfaces><Surface name="FSL plane"><Definition surfType="TIN"><Pnts>${Object.entries(surface.points).map(([id, p]) => `<P id="${id}">${p.northing} ${p.easting} ${p.elevation}</P>`).join("")}</Pnts><Faces><F>a b c</F><F>a c d</F></Faces></Definition></Surface><Surface name="Different surface"><Definition surfType="TIN"><Pnts>${Object.entries(surface.points).map(([id, p]) => `<P id="${id}">${p.northing} ${p.easting} ${p.elevation + 1}</P>`).join("")}</Pnts><Faces><F>a b c</F><F>a c d</F></Faces></Definition></Surface></Surfaces></LandXML>`
fs.writeFileSync(`${folder}/design.xml`, xml)
fs.writeFileSync(`${folder}/asbuilt.csv`, ["Point ID,Easting,Northing,Elevation,Code", ...input.map((p) => [p.id, p.easting, p.northing, p.elevation, p.code].join(","))].join("\n"))
fs.writeFileSync(`${folder}/project.surveytool.json`, JSON.stringify({ format: "surveytool-project", version: 1, id: "pavement-qa", tool: "pavement", title: "Pavement QA", savedAt: new Date().toISOString(), state: { bottomFile: null, topFile: { name: "asbuilt.csv", points: input, warnings: [] }, targetThicknessMm: 250, toleranceMm: 20, coordinateTolerance: .05, matchMode: "auto", mapSettings: { sourceCrs: {}, defaultCrs: "EPSG:2193", basemap: "none", opacity: 90 }, designState: state } }))
fs.writeFileSync(`${folder}/report.json`, JSON.stringify(report))
console.log("Pavement design checks passed: exact chainage/offsets, original-XY FSL, tolerances, unassessed coverage, selectable sources, report rows and project restore.")
