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
  createGeoPackage,
  createShapefileZip,
} = await import("../src/lib/gisExports.ts")

const points = [
  { id: "ASB-001", easting: 1755000.125, northing: 5923000.25, elevation: 12.3456, code: "AC14" },
  { id: "ASB-002", easting: 1755010.5, northing: 5923012.75, elevation: 12.5678, code: "KERB" },
  { id: "ASB-003", easting: 1755025.875, northing: 5923021.125, elevation: 12.789, code: "CL" },
]

const shapefile = createShapefileZip(points, "EPSG:2193", "surveytool-validation")
fs.writeFileSync("/tmp/surveytool-validation.zip", new Uint8Array(shapefile))

const geopackage = await createGeoPackage(points, "EPSG:2193")
fs.writeFileSync("/tmp/surveytool-validation.gpkg", new Uint8Array(geopackage))

const SQL = await initSqlJs({ locateFile: () => wasmPath })
const db = new SQL.Database(new Uint8Array(geopackage))

function scalar(sql) {
  const result = db.exec(sql)
  assert.equal(result.length, 1, `Expected one result for ${sql}`)
  return result[0].values[0][0]
}

assert.equal(scalar("PRAGMA application_id"), 1196444487)
assert.equal(scalar("PRAGMA user_version"), 10400)
assert.equal(scalar("SELECT COUNT(*) FROM survey_points"), points.length)
assert.equal(scalar("SELECT srs_id FROM gpkg_contents WHERE table_name='survey_points'"), 2193)
assert.equal(scalar("SELECT geometry_type_name FROM gpkg_geometry_columns WHERE table_name='survey_points'"), "POINT")
assert.equal(scalar("SELECT z FROM gpkg_geometry_columns WHERE table_name='survey_points'"), 1)
assert.equal(scalar("PRAGMA integrity_check"), "ok")

const geometryResult = db.exec("SELECT geom FROM survey_points ORDER BY fid LIMIT 1")
const geometry = geometryResult[0].values[0][0]
assert.ok(geometry instanceof Uint8Array)
assert.equal(geometry[0], 0x47)
assert.equal(geometry[1], 0x50)
assert.equal(geometry[8], 1)
assert.equal(new DataView(geometry.buffer, geometry.byteOffset, geometry.byteLength).getUint32(9, true), 1001)

db.close()
console.log("GeoPackage schema, metadata, integrity and PointZ geometry validated.")
