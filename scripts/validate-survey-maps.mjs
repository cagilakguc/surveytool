import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import vm from "node:vm"
import proj4 from "proj4"
import { declaredEpsgCode, detectFileCrs, searchCrsCatalogue, metresPerLinearUnit, crsUnitScale, readMapSettings, saveMapSettings } from "../src/lib/mapCoordinates.ts"
import { buildSurveyMapData, createMapTransform, validateMapLocation, maximumMapFaces } from "../src/lib/surveyMapGeometry.ts"
import { comparisonCoordinateError, metricSurfaceComparison, mapInputUnitError } from "../src/lib/surfaceMapAnalysis.ts"
import { compareSurfaces } from "../src/lib/surfaceCompare.ts"

const catalogue = JSON.parse(await readFile(new URL("../public/data/coordinate-systems.json", import.meta.url), "utf8"))
const crs = (code) => { const value = catalogue.find((entry) => entry.code === `EPSG:${code}`); assert.ok(value, `Missing EPSG:${code}`); return value }
assert.ok(catalogue.length > 6000)
for (const metadata of [{ epsgCode: "2193" }, { name: "EPSG:2193" }, { name: "urn:ogc:def:crs:EPSG::2193" }, { ogcWktCode: "http://www.opengis.net/def/crs/EPSG/0/2193" }]) assert.equal(declaredEpsgCode(metadata), "EPSG:2193")
assert.equal(declaredEpsgCode({ ogcWktCode: 'PROJCS["NZTM",GEOGCS["NZGD",AUTHORITY["EPSG","4167"]],AUTHORITY["EPSG","2193"]]' }), "EPSG:2193")
assert.equal(declaredEpsgCode({ desc: "Height datum EPSG:7839", epsgCode: "2193" }), "EPSG:2193")
assert.equal(detectFileCrs({ name: "NZTM2000" }, catalogue), "EPSG:2193")
assert.equal(detectFileCrs({ name: "Mount Eden 2000" }, catalogue), "EPSG:2105")
assert.equal(detectFileCrs({ name: "Local Project Grid" }, catalogue), null)
assert.equal(detectFileCrs(undefined, catalogue), null)
assert.ok(searchCrsCatalogue(catalogue, "NZTM", "NZ").some((entry) => entry.code === "EPSG:2193"))
assert.ok(searchCrsCatalogue(catalogue, "27700", "UK").some((entry) => entry.code === "EPSG:27700"))
assert.ok(searchCrsCatalogue(catalogue, "TUREF", "Turkey").some((entry) => entry.code === "EPSG:5254"))
assert.ok(searchCrsCatalogue(catalogue, "UTM 33N", "").some((entry) => entry.code === "EPSG:32633"))
assert.equal(searchCrsCatalogue(catalogue, "2193", "Australia").length, 0)

function close(actual, expected, tolerance = 1e-7) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`) }
// Published projection origins and a known UTM central-meridian latitude check placement independently of a map.
for (const [code, input, longitude, latitude] of [
  [2105, [400000, 800000], 174.764166666667, -36.8797222222222],
  [32633, [500000, 4649776.22482], 15, 42],
  [32756, [500000, 10000000], 153, 0],
  [5254, [500000, 0], 30, 0],
  [4326, [-0.1278, 51.5074], -0.1278, 51.5074],
]) {
  const result = createMapTransform(crs(code))(...input)
  const [lon, lat] = proj4("EPSG:3857", "EPSG:4326", result)
  close(lon, longitude); close(lat, latitude)
}
const london = proj4("EPSG:3857", "EPSG:4326", createMapTransform(crs(27700))(530000, 180000))
close(london[0], -0.12835, 0.0001); close(london[1], 51.50399, 0.0001)
validateMapLocation(crs(2193), 1755000, 5923000)
assert.throws(() => validateMapLocation(crs(27700), 1755000, 5923000), /outside the area/)
assert.throws(() => createMapTransform(crs(4326))(999999, 999999), /cannot be placed/)
assert.throws(() => createMapTransform({ ...crs(2193), proj4: "+proj=longlat +ellps=GRS80 +nadgrids=missing.gsb" }), /datum grid/)
close(metresPerLinearUnit("USSurveyFoot"), 1200 / 3937)
close(crsUnitScale(crs(2263)), 1200 / 3937)
assert.equal(metresPerLinearUnit("degree"), null)

function surface(name, elevation, easting = 1755000, northing = 5923000) {
  return { name, points: {
    a: { easting, northing, elevation }, b: { easting: easting + 10, northing, elevation },
    c: { easting: easting + 10, northing: northing + 10, elevation }, d: { easting, northing: northing + 10, elevation },
  }, faces: [["a", "b", "c"], ["a", "c", "d"]], minElevation: elevation, maxElevation: elevation }
}
const document = { fileName: "test.xml", projectName: "Synthetic mapping test", version: "1.2", applicationName: "Validation", units: "meter", coordinateSystem: { epsgCode: "2193" }, surfaces: [surface("Existing", 0)], alignments: [], cogoPoints: [], warnings: [] }
const original = structuredClone(document)
const comparison = compareSurfaces(document.surfaces[0], surface("Design", 1), 30)
const originalComparison = structuredClone(comparison)
close(comparison.fillVolume, 100, 1e-7)
assert.equal(comparisonCoordinateError(document, document, "EPSG:2193", "EPSG:2105", crs(2193), crs(2105)).includes("different coordinate systems"), true)
assert.match(comparisonCoordinateError(document, document, "EPSG:4326", "EPSG:4326", crs(4326), crs(4326)), /projected survey grid/)
assert.match(comparisonCoordinateError(document, { ...document, units: "foot" }, "", "", null, null), /different linear units/)
assert.match(mapInputUnitError(document, crs(2263)), /declares meter/)
assert.equal(comparisonCoordinateError(document, document, "", "", null, null), "")
const mapData = buildSurveyMapData(crs(2193), undefined, comparison)
assert.equal(mapData.features.length, comparison.cells.length)
const cell = comparison.cells[0]
const ring = mapData.features[0].getGeometry().getCoordinates()[0]
assert.equal(ring.length, 5)
const firstCorner = proj4("EPSG:3857", crs(2193).proj4, ring[0])
close(firstCorner[0], cell.easting - comparison.cellSize / 2, 1e-5)
close(firstCorner[1], cell.northing - comparison.cellSize / 2, 1e-5)
assert.equal(mapData.features[0].get("difference"), cell.difference)
assert.deepEqual(document, original)
assert.deepEqual(comparison, originalComparison)
const metres = metricSurfaceComparison(comparison, 0.3048)
close(metres.fillVolume, 100 * 0.3048 ** 3)
close(metres.comparedArea, 100 * 0.3048 ** 2)
close(metres.averageDifference, 0.3048)
assert.equal(metres.cells[0].easting, cell.easting)
assert.equal(metres.cellSize, comparison.cellSize)
assert.deepEqual(comparison, originalComparison)
const viewerData = buildSurveyMapData(crs(2193), document)
assert.equal(viewerData.features.length, 2)
assert.equal(viewerData.groups[0].label, "Existing")
const large = structuredClone(document)
large.surfaces[0].faces = Array.from({ length: maximumMapFaces * 3 }, () => ["a", "b", "c"])
const sampled = buildSurveyMapData(crs(2193), large)
assert.equal(sampled.features.length, maximumMapFaces)
assert.match(sampled.note, /5,000 of 15,000/)

const values = new Map()
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
const saved = { sourceCrs: { file: "EPSG:2193" }, defaultCrs: "EPSG:2193", basemap: "aerial", opacity: 63 }
assert.equal(saveMapSettings("Project A", saved, storage), true)
assert.deepEqual({ ...readMapSettings("Project A", storage), sourceCrs: { ...readMapSettings("Project A", storage).sourceCrs } }, saved)
assert.equal(readMapSettings("Project B", storage).defaultCrs, "")
assert.equal(saveMapSettings("test", saved, { setItem() { throw new Error("Blocked") } }), false)
assert.equal(readMapSettings("test", { getItem() { throw new Error("Blocked") } }).basemap, "street")
storage.setItem("surveytool:map:v1:bad", "not JSON")
assert.equal(readMapSettings("bad", storage).opacity, 75)

// Test the worker path used by real uploads, including XML namespace prefixes.
const workerSource = await readFile(new URL("../src/workers/landxmlParser.worker.js", import.meta.url), "utf8")
const messages = []
const context = { self: { postMessage: (message) => messages.push(message) }, TextDecoder }
vm.runInNewContext(workerSource, context)
const xml = '<lx:LandXML xmlns:lx="http://www.landxml.org/schema/LandXML-1.2" version="1.2"><lx:Project name="Worker test"/><lx:CoordinateSystem name="NZTM2000" epsgCode="2193"/><lx:Units><lx:Metric linearUnit="meter"/></lx:Units><lx:CgPoints><lx:CgPoint name="1">5923000 1755000 12</lx:CgPoint></lx:CgPoints></lx:LandXML>'
context.self.onmessage({ data: { buffer: new TextEncoder().encode(xml).buffer, fileName: "worker-test.xml" } })
const result = messages.find((message) => message.type === "result")?.document
assert.ok(result)
assert.equal(result.coordinateSystem.epsgCode, "2193")
assert.equal(result.cogoPoints[0].easting, 1755000)
assert.equal(result.cogoPoints[0].northing, 5923000)
console.log(`Survey maps passed: ${catalogue.length.toLocaleString()} CRSs; metadata, search, five international projections, UK datum approximation, input guards, unit conversion, map geometry, sampling, storage and upload worker.`)
