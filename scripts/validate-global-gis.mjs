import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import initSqlJs from "sql.js"
import { transformGlobalSurveyGeometry, readGisPreferences, saveGisPreferences } from "../src/lib/globalGis.ts"
import { loadGisCrsDefinition, resolveGisOutputCrs } from "../src/lib/gisCrs.ts"
import { createGeometryGeoPackage, createGeometryShapefileZip } from "../src/lib/gisGeometryExports.ts"
import { buildGisMapData } from "../src/lib/gisMapGeometry.ts"
import { parseSurveyGeometryFile } from "../src/lib/surveyGeometry.ts"

const require = createRequire(import.meta.url)
const wasm = require.resolve("sql.js/dist/sql-wasm.wasm")
globalThis.window = { initSqlJs: () => initSqlJs({ locateFile: () => wasm }) }
const SQL = await initSqlJs({ locateFile: () => wasm })
const catalogue = JSON.parse(fs.readFileSync("public/data/coordinate-systems.json", "utf8"))
const system = (code) => { const crs = catalogue.find((entry) => entry.code === `EPSG:${code}`); assert.ok(crs, `Missing EPSG:${code}`); return crs }
const oldFetch = globalThis.fetch
let definitionsFetched = 0
globalThis.fetch = async (url) => {
  const match = String(url).match(/data\/crs-definitions\/(\d+)\.json/)
  assert.ok(match, `Unexpected network request: ${url}`)
  definitionsFetched++
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/data/crs-definitions/${match[1]}.json`, "utf8")) }
}
const definitions = new Map()
for (const code of [4326, 32633, 32756, 5254, 2263, 32118, 27700, 2193, 4167]) definitions.set(code, await loadGisCrsDefinition(system(code)))
assert.ok(definitionsFetched < definitions.size, "WKT definitions should be cached by bucket")
globalThis.fetch = oldFetch

function close(actual, expected, tolerance = 1e-7) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`) }
function layer(x, y, step = 1) {
  const v = (dx, dy, elevation = 12.3456) => ({ easting: x + dx * step, northing: y + dy * step, elevation })
  return { name: "global-test.dxf", format: "DXF", warnings: [],
    points: [{ id: "Ç-001", code: "SINIR_境界", ...v(0, 0) }, { id: "P-002", code: "BM", ...v(1, 1, 13.4567) }],
    lines: [{ id: "L-001", code: "中心線", vertices: [v(0, 0, 11), v(10, 0, 12), v(10, 10, 13)] }],
    polygons: [{ id: "B-001", code: "Parsel_Ç", rings: [[v(30, 0), v(50, 0), v(50, 20), v(30, 20), v(30, 0)], [v(35, 5), v(40, 5), v(40, 10), v(35, 10), v(35, 5)]] }],
  }
}
const geographic = layer(15, 42, 0.00001)
const original = structuredClone(geographic)
const utm = transformGlobalSurveyGeometry(geographic, system(4326), system(32633))
close(utm.points[0].easting, 500000)
close(utm.points[0].northing, 4649776.22482, 0.00001)
assert.deepEqual(geographic, original)
assert.equal(utm.points[0].code, "SINIR_境界")
assert.deepEqual(utm.lines[0].vertices.map((v) => v.elevation), [11, 12, 13])
assert.equal(utm.polygons[0].rings.length, 2)
assert.deepEqual(utm.polygons[0].rings[0][0], utm.polygons[0].rings[0].at(-1))
const back = transformGlobalSurveyGeometry(utm, system(32633), system(4326))
back.points.forEach((point, i) => { close(point.easting, geographic.points[i].easting); close(point.northing, geographic.points[i].northing); assert.equal(point.elevation, geographic.points[i].elevation) })
const turkey = transformGlobalSurveyGeometry(layer(30, 40, 0.00001), system(4326), system(5254))
close(turkey.points[0].easting, 500000)
const footSource = layer(1000000, 200000)
const metres = transformGlobalSurveyGeometry(footSource, system(2263), system(32118))
const usFoot = 1200 / 3937
close(metres.points[0].easting, 1000000 * usFoot, 1e-5)
close(metres.points[0].northing, 200000 * usFoot, 1e-5)
assert.equal(metres.points[0].elevation, footSource.points[0].elevation)
assert.match(system(27700).canonicalProj4, /nadgrids/)
assert.notEqual(system(27700).proj4, definitions.get(27700).proj4)
assert.match(definitions.get(27700).proj4, /nadgrids/)
assert.throws(() => transformGlobalSurveyGeometry(layer(530000, 180000), system(27700), system(4326)), /grid file/)
assert.deepEqual(transformGlobalSurveyGeometry(footSource, system(2263), system(2263)), footSource)
assert.throws(() => transformGlobalSurveyGeometry(layer(500000, 4649776), system(4326), system(32633)), /longitude\/latitude range/)
assert.throws(() => transformGlobalSurveyGeometry(layer(NaN, 0), system(32633), system(32633)), /non-finite/)
assert.throws(() => resolveGisOutputCrs({ ...definitions.get(32633), wkt: definitions.get(4326).wkt }), /do not match/)
assert.throws(() => resolveGisOutputCrs({ ...definitions.get(32633), wkt: "" }), /WKT/)
const grad = transformGlobalSurveyGeometry(layer(20, 50, 0.00001), { ...system(4326), code: "TEST:GRAD", unit: "grad" }, system(4326))
close(grad.points[0].easting, 18); close(grad.points[0].northing, 45)
assert.throws(() => transformGlobalSurveyGeometry({ ...geographic, lines: [{ id: "date", code: "", vertices: [{ easting: 179, northing: 0, elevation: 0 }, { easting: -179, northing: 0, elevation: 0 }] }] }, system(4326), system(4326)), /antimeridian/)
const csv = await parseSurveyGeometryFile(new File(["ID,Latitude,Longitude,Elevation,Code\nP1,42,15,12.3456,TEST\n"], "geographic.csv"))
assert.equal(csv.points[0].easting, 15); assert.equal(csv.points[0].northing, 42)
const map = buildGisMapData(system(32633), utm)
assert.equal(map.features.length, 4)
assert.equal(map.features.find((feature) => feature.getGeometry().getType() === "Polygon").getGeometry().getCoordinates().length, 2)
assert.deepEqual(geographic, original)

const directory = "/tmp/global-gis-validation"
fs.mkdirSync(directory, { recursive: true })
const cases = [
  ["italy-utm", utm, 32633],
  ["sydney-utm", transformGlobalSurveyGeometry(layer(151.2, -33.86, 0.00001), system(4326), system(32756)), 32756],
  ["turkey-tm30", turkey, 5254],
  ["new-york-feet", footSource, 2263],
  ["new-york-metres", metres, 32118],
  ["global-geographic", geographic, 4326],
  ["nz-nztm", layer(1755000, 5923000), 2193],
  ["uk-unchanged", transformGlobalSurveyGeometry(layer(530000, 180000), system(27700), system(27700)), 27700],
]
for (const [name, data, code] of cases) {
  const definition = definitions.get(code)
  const zip = createGeometryShapefileZip(data, definition, name)
  const gpkg = await createGeometryGeoPackage(data, definition)
  fs.writeFileSync(path.join(directory, `${name}.zip`), new Uint8Array(zip))
  fs.writeFileSync(path.join(directory, `${name}.gpkg`), new Uint8Array(gpkg))
  fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify({ code, geographic: code === 4326, layer: data }))
  const db = new SQL.Database(new Uint8Array(gpkg))
  const scalar = (sql) => db.exec(sql)[0].values[0][0]
  assert.equal(scalar("PRAGMA integrity_check"), "ok")
  assert.equal(scalar(`SELECT organization_coordsys_id FROM gpkg_spatial_ref_sys WHERE srs_id=${code}`), code)
  assert.equal(scalar(`SELECT definition FROM gpkg_spatial_ref_sys WHERE srs_id=${code}`), definition.wkt)
  assert.equal(scalar("SELECT count(*) FROM gpkg_contents WHERE srs_id=" + code), 3)
  assert.equal(scalar("SELECT ring_count FROM survey_polygons"), 2)
  if (code === 2263) {
    close(scalar("SELECT length_m FROM survey_lines"), 20 * usFoot)
    close(scalar("SELECT area_m2 FROM survey_polygons"), 375 * usFoot ** 2)
  }
  if (code === 4326) { assert.equal(scalar("SELECT length_m FROM survey_lines"), null); assert.equal(scalar("SELECT area_m2 FROM survey_polygons"), null) }
  db.close()
}
const stored = new Map()
const storage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) }
const preferences = { source: "EPSG:32633", target: "EPSG:4326", format: "GEOPACKAGE", basemap: "aerial", opacity: 61 }
assert.equal(readGisPreferences(storage).source, "")
assert.equal(saveGisPreferences(preferences, storage), true)
assert.deepEqual(readGisPreferences(storage), preferences)
assert.equal(readGisPreferences({ getItem() { throw new Error("Blocked") } }).target, "EPSG:4326")
console.log("Global GIS passed: international CRS conversions, exact metadata, feet/metres, 3D geometry with holes, Unicode attributes, angular units, invalid input, datum-grid guards, map preview and saved settings.")
