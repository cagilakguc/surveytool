import assert from "node:assert/strict"
import { parseSurveyGeometryFile, transformSurveyGeometryLayer } from "../src/lib/surveyGeometry.ts"

const entity = (type, tags = []) => [0, type, ...tags]
const wrap = (entities, blocks = []) => [
  0, "SECTION", 2, "BLOCKS", ...blocks, 0, "ENDSEC",
  0, "SECTION", 2, "ENTITIES", ...entities, 0, "ENDSEC", 0, "EOF",
].join("\r\n") + "\r\n"
const read = (text) => parseSurveyGeometryFile(new File([text], "geometry-regression.dxf"))
const polyline = (flags, vertices, extra = []) => [
  ...entity("POLYLINE", [5, "CLASSIC", 8, "ROAD", 70, flags, ...extra]),
  ...vertices.flatMap((v) => entity("VERTEX", v)), ...entity("SEQEND"),
]

const layer = await read(wrap([
  ...entity("POINT", [5, "P1", 8, "CONTROL", 10, 1000.125, 20, 2000.25, 30, 12.3456]),
  ...entity("INSERT", [5, "B1", 8, "MARK", 2, "CONTROL_BLOCK", 10, 1010, 20, 2020, 30, 13.5]),
  ...entity("LINE", [5, "L1", 8, "CL", 10, 1000, 20, 2000, 30, 12, 11, 1020, 21, 2010, 31, 14]),
  ...entity("LWPOLYLINE", [5, "LW1", 8, "EDGE", 90, 3, 38, 11.25, 10, 1000, 20, 2000, 10, 1010, 20, 2005, 10, 1020, 20, 2010]),
  ...entity("LWPOLYLINE", [5, "RING", 8, "SITE", 90, 4, 70, 1, 38, 15, 10, 1000, 20, 2000, 10, 1020, 20, 2000, 10, 1020, 20, 2020, 10, 1000, 20, 2020]),
  ...polyline(8, [[10, 1000, 20, 2000, 30, 20], [10, 1010, 20, 2010, 30, 21.25], [10, 1020, 20, 2020, 30, 22]]),
  ...polyline(0, [[10, 1000, 20, 2000, 30, 0], [10, 1020, 20, 2010, 30, 0]], [30, 18.75]),
  ...entity("POINT", [67, 1, 10, 0, 20, 0, 30, 0]),
], [
  ...entity("BLOCK", [2, "CONTROL_BLOCK", 10, 0, 20, 0, 30, 0]),
  ...entity("POINT", [10, 500, 20, 600, 30, 700]),
  ...entity("LINE", [10, 0, 20, 0, 11, 100, 21, 100]),
  ...entity("ENDBLK"),
]))
assert.equal(layer.points.length, 2, "Block definitions and paper-space points must not become survey points")
assert.equal(layer.lines.length, 4)
assert.equal(layer.polygons.length, 1)
assert.deepEqual(layer.points[0], { id: "POINT-P1", code: "CONTROL", easting: 1000.125, northing: 2000.25, elevation: 12.3456 })
assert.deepEqual(layer.lines[2].vertices.map((v) => v.elevation), [20, 21.25, 22])
assert.deepEqual(layer.lines[3].vertices.map((v) => v.elevation), [18.75, 18.75], "2D polyline elevation lives on the header")
assert.equal(layer.polygons[0].rings[0].length, 5)
assert.deepEqual(layer.polygons[0].rings[0][0], layer.polygons[0].rings[0].at(-1))
assert(layer.warnings.some((w) => /insertion points/.test(w)))
assert(layer.warnings.some((w) => /paper-space/.test(w)))

const ocs = await read(wrap([
  ...entity("LWPOLYLINE", [5, "OCS", 90, 2, 38, 7, 210, 0, 220, 1, 230, 0, 10, 2, 20, 3, 10, 4, 20, 5]),
  ...entity("INSERT", [10, 2, 20, 3, 30, 7, 210, 0, 220, 2, 230, 0]),
  ...entity("POINT", [10, 2, 20, 3, 30, 7, 210, 0, 220, 1, 230, 0]),
]))
assert.deepEqual(ocs.lines[0].vertices, [
  { easting: -2, northing: 7, elevation: 3 },
  { easting: -4, northing: 7, elevation: 5 },
])
assert.deepEqual(ocs.points.map(({easting, northing, elevation}) => [easting, northing, elevation]), [[-2, 7, 3], [2, 3, 7]])

const rejected = await read(wrap([
  ...entity("POINT", [5, "KEEP", 10, 100, 20, 200, 30, 15]),
  ...entity("LWPOLYLINE", [90, 2, 10, 0, 20, 0, 42, 0.5, 10, 10, 20, 10]),
  ...polyline(2, [[10, 0, 20, 0], [10, 10, 20, 10]]),
  ...polyline(64, [[10, 0, 20, 0], [10, 10, 20, 10]]),
  ...entity("LINE", [10, 0, 20, 0, 21, 10]),
  ...entity("LWPOLYLINE", [90, 2, 10, 10, 10, 20, 20, 30]),
  ...entity("POLYLINE", [70, 8]),
  ...entity("VERTEX", [10, 0, 20, 0, 30, 1]),
  ...entity("POINT", [5, "AFTER-BROKEN-POLYLINE", 10, 300, 20, 400, 30, 18]),
  ...entity("ARC", [10, 0, 20, 0, 40, 5]),
]))
assert.equal(rejected.points.length, 2, "An unterminated polyline must not consume subsequent geometry")
assert.equal(rejected.lines.length, 0, "Curves, meshes and missing coordinates must not become fabricated straight lines")
assert.equal(rejected.polygons.length, 0)
assert(rejected.warnings.some((w) => /curved LWPOLYLINE/.test(w)))
assert(rejected.warnings.some((w) => /POLYLINE mesh/.test(w)))
assert(rejected.warnings.some((w) => /Malformed/.test(w)))
await assert.rejects(() => read(wrap(entity("LWPOLYLINE", [90, 2, 10, 0, 20, 0, 42, 1, 10, 10, 20, 0]))), /no supported model-space/)
await assert.rejects(() => read("0\nSECTION\n2"), /no value/)
await assert.rejects(() => read("oops\nSECTION\n"), /Invalid DXF group code/)
assert.equal((await read(wrap(entity("POINT", [10, 1, 20, 2])).replaceAll("\r\n", "\r") + "\r\r")).points.length, 1)

const projected = { ...layer, points: [{ id: "NZTM-TEST", code: "BM", easting: 1755000.125, northing: 5923000.25, elevation: 12.3456 }], lines: [], polygons: [] }
const geographic = transformSurveyGeometryLayer(projected, "EPSG:2193", "EPSG:4167")
const roundTrip = transformSurveyGeometryLayer(geographic, "EPSG:4167", "EPSG:2193")
assert(Math.abs(roundTrip.points[0].easting - projected.points[0].easting) < 0.001)
assert(Math.abs(roundTrip.points[0].northing - projected.points[0].northing) < 0.001)
assert.equal(roundTrip.points[0].elevation, projected.points[0].elevation)
assert.equal(roundTrip.points[0].id, projected.points[0].id)
assert.equal(roundTrip.points[0].code, projected.points[0].code)
console.log("DXF geometry, model-space filtering, 2D/3D elevations, OCS transforms, unsupported geometry and CRS round-trip checks passed.")
