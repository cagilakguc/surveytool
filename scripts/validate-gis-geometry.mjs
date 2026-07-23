import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"

import initSqlJs from "sql.js"

const require = createRequire(import.meta.url)
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm")

globalThis.window = {
  initSqlJs: () => initSqlJs({ locateFile: () => wasmPath }),
}

const {
  createGeometryGeoPackage,
  createGeometryShapefileZip,
} = await import("../src/lib/gisGeometryExports.ts")

const layer = {
  name: "mixed-validation.dxf",
  format: "DXF",
  warnings: [],
  points: [
    { id: "P-001", easting: 1755000.125, northing: 5923000.25, elevation: 12.3456, code: "ASB" },
    { id: "P-002", easting: 1755010.5, northing: 5923012.75, elevation: 12.5678, code: "KERB" },
  ],
  lines: [
    {
      id: "L-001",
      code: "CL",
      vertices: [
        { easting: 1755000, northing: 5923000, elevation: 12.1 },
        { easting: 1755010, northing: 5923005, elevation: 12.2 },
        { easting: 1755020, northing: 5923015, elevation: 12.3 },
      ],
    },
  ],
  polygons: [
    {
      id: "B-001",
      code: "SITE",
      rings: [[
        { easting: 1755030, northing: 5923000, elevation: 11.9 },
        { easting: 1755050, northing: 5923000, elevation: 11.9 },
        { easting: 1755050, northing: 5923020, elevation: 12.0 },
        { easting: 1755030, northing: 5923020, elevation: 12.0 },
        { easting: 1755030, northing: 5923000, elevation: 11.9 },
      ]],
    },
  ],
}

const shapefile = createGeometryShapefileZip(
  layer,
  "EPSG:2193",
  "mixed-validation",
)
fs.writeFileSync("/tmp/mixed-validation.zip", new Uint8Array(shapefile))

const geopackage = await createGeometryGeoPackage(layer, "EPSG:2193")
fs.writeFileSync("/tmp/mixed-validation.gpkg", new Uint8Array(geopackage))

const SQL = await initSqlJs({ locateFile: () => wasmPath })
const db = new SQL.Database(new Uint8Array(geopackage))

function scalar(sql) {
  const result = db.exec(sql)
  assert.equal(result.length, 1, `Expected one result for ${sql}`)
  return result[0].values[0][0]
}

assert.equal(scalar("PRAGMA application_id"), 1196444487)
assert.equal(scalar("PRAGMA user_version"), 10400)
assert.equal(scalar("PRAGMA integrity_check"), "ok")
assert.equal(scalar("SELECT COUNT(*) FROM survey_points"), 2)
assert.equal(scalar("SELECT COUNT(*) FROM survey_lines"), 1)
assert.equal(scalar("SELECT COUNT(*) FROM survey_polygons"), 1)
assert.equal(scalar("SELECT geometry_type_name FROM gpkg_geometry_columns WHERE table_name='survey_points'"), "POINT")
assert.equal(scalar("SELECT geometry_type_name FROM gpkg_geometry_columns WHERE table_name='survey_lines'"), "LINESTRING")
assert.equal(scalar("SELECT geometry_type_name FROM gpkg_geometry_columns WHERE table_name='survey_polygons'"), "POLYGON")
assert.equal(scalar("SELECT srs_id FROM gpkg_contents WHERE table_name='survey_lines'"), 2193)
assert.equal(scalar("SELECT vertex_count FROM survey_lines"), 3)
assert.equal(scalar("SELECT ring_count FROM survey_polygons"), 1)
assert.equal(scalar("SELECT ROUND(area_m2) FROM survey_polygons"), 400)

for (const [tableName, expectedType] of [
  ["survey_points", 1001],
  ["survey_lines", 1002],
  ["survey_polygons", 1003],
]) {
  const result = db.exec(`SELECT geom FROM ${tableName} ORDER BY fid LIMIT 1`)
  const geometry = result[0].values[0][0]
  assert.ok(geometry instanceof Uint8Array)
  assert.equal(geometry[0], 0x47)
  assert.equal(geometry[1], 0x50)
  assert.equal(geometry[8], 1)
  assert.equal(
    new DataView(geometry.buffer, geometry.byteOffset, geometry.byteLength)
      .getUint32(9, true),
    expectedType,
  )
}

db.close()
console.log("Mixed GeoPackage point, line and polygon schema and geometry validated.")
