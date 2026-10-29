import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { countriesForArea } from "./crs-countries.mjs"
import { searchCrsCatalogue } from "../src/lib/mapCoordinates.ts"
import { commonCrsCodes, countryMatchesCrs, crsCountries, readCrsPickerPreferences, requiredDatumGrids, resolveCrsCountry, saveCrsPickerPreferences } from "../src/lib/crsSelection.ts"
import { createGlobalCoordinateTransform } from "../src/lib/globalGis.ts"
import { createSurveyOutput, transformSurveyPoints } from "../src/lib/surveyFileConversion.ts"

const catalogue = JSON.parse(await readFile(new URL("../public/data/coordinate-systems.json", import.meta.url), "utf8"))
const crs = (code) => { const entry = catalogue.find((item) => item.code === `EPSG:${code}`); assert.ok(entry, `Missing EPSG:${code}`); return entry }
const codes = (country, query = "") => searchCrsCatalogue(catalogue, query, country).map((item) => item.code)
assert.equal(crsCountries.length, 250)
for (const [query, expected] of [["NZ", "NZ"], ["Türkiye", "TR"], ["Turkey", "TR"], ["Turkiye", "TR"], ["UK", "GB"], ["USA", "US"], ["Côte d’Ivoire", "CI"]]) assert.equal(resolveCrsCountry(query), expected)
assert.deepEqual(countriesForArea("American Samoa."), ["AS"])
assert.deepEqual(countriesForArea("Guinea-Bissau. Equatorial Guinea. Papua New Guinea."), ["GQ", "GW", "PG"])
assert.deepEqual(countriesForArea("Democratic Republic of the Congo (Zaire)."), ["CD"])
assert.deepEqual(countriesForArea("United States (USA) - Georgia; New Jersey."), ["US"])
assert.deepEqual(countriesForArea("United States (USA) - New England."), ["US"])
for (const [country, code] of [["NZ", 2193], ["NZ", 2105], ["TR", 5254], ["GB", 27700], ["AU", 7856], ["US", 2263], ["CA", 3978], ["IT", 32633], ["DE", 4258], ["FJ", 32701], ["FJ", 32760], ["CK", 32704], ["GG", 32630], ["SJ", 32633]]) assert.ok(codes(country).includes(`EPSG:${code}`), `${country} must include ${code}`)
assert.ok(!codes("NZ").includes("EPSG:32633"))
assert.ok(!codes("FJ").includes("EPSG:32633"))
assert.ok(!codes("AQ").includes("EPSG:32631"))
assert.equal(codes("AU", "2193").length, 0)
assert.ok(codes("", "EPSG32633").includes("EPSG:32633"))
assert.ok(codes("TR", "TM30").includes("EPSG:5254"))
assert.ok(codes("NZ", "Mount Eden").includes("EPSG:2105"))
for (const country of crsCountries) assert.ok(countryMatchesCrs(crs(4326), country.code), `WGS 84 missing for ${country.code}`)
assert.ok(commonCrsCodes(catalogue, "NZ").includes("EPSG:2193"))
assert.ok(commonCrsCodes(catalogue, "FJ").includes("EPSG:32701"))
assert.equal(requiredDatumGrids(crs(27700))[0], "OSTN15_NTv2_OSGBtoETRS.gsb")

const values = new Map()
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
assert.equal(saveCrsPickerPreferences({ country: "NZ", recent: ["EPSG:2193", "EPSG:32633"] }, storage), true)
assert.deepEqual(readCrsPickerPreferences(storage), { country: "NZ", recent: ["EPSG:2193", "EPSG:32633"] })
assert.deepEqual(readCrsPickerPreferences({ getItem: () => '{"country":"not-a-country","recent":["LOCAL",null,{},"EPSG:2193","EPSG:2193"]}' }), { country: "", recent: ["EPSG:2193"] })
assert.deepEqual(readCrsPickerPreferences({ getItem() { throw new Error("Blocked") } }), { country: "", recent: [] })
assert.equal(saveCrsPickerPreferences({ country: "", recent: [] }, { setItem() { throw new Error("Blocked") } }), false)

const point = { id: "Rome-1", easting: 500000, northing: 4649776.22482, elevation: 12.3456, code: "SURVEY" }
const result = transformSurveyPoints([point], crs(32633), crs(4326))
assert.ok(Math.abs(result[0].easting - 15) < 1e-8)
assert.ok(Math.abs(result[0].northing - 42) < 1e-8)
assert.equal(result[0].id, point.id)
assert.equal(result[0].elevation, point.elevation)
const roundtrip = transformSurveyPoints(result, crs(4326), crs(32633))[0]
assert.ok(Math.abs(roundtrip.easting - point.easting) < 1e-5)
assert.ok(Math.abs(roundtrip.northing - point.northing) < 1e-5)
assert.match(createSurveyOutput(result, crs(4326), "CSV").content, /Longitude,Latitude/)
assert.match(createSurveyOutput([point], crs(32633), "TXT").content, /Easting\tNorthing/)
const geojson = JSON.parse(createSurveyOutput([point], crs(32633), "GEOJSON").content)
assert.deepEqual(geojson.features[0].geometry.coordinates, [15, 42, 12.3456])
assert.match(createSurveyOutput([point], crs(32633), "KML").content, /15\.000000000,42\.000000000,12\.3456/)
assert.match(createSurveyOutput([point], crs(32633), "DXF").content, /AC1009/)
assert.throws(() => createSurveyOutput(result, crs(4326), "DXF"), /projected coordinate system in metres/)
assert.throws(() => createSurveyOutput([point], crs(2263), "DXF"), /projected coordinate system in metres/)
assert.throws(() => createGlobalCoordinateTransform(crs(4326), crs(32633))({ ...point, easting: 999, northing: 999 }), /longitude\/latitude range/)
const bng = { ...point, easting: 530000, northing: 180000 }
assert.throws(() => transformSurveyPoints([bng], crs(27700), crs(4326)), /grid file/)
assert.equal(transformSurveyPoints([bng], crs(27700), crs(27700))[0].easting, bng.easting)
console.log(`Country CRS selection passed: ${crsCountries.length} countries/territories, ${catalogue.length} CRSs, aliases, regional/UTM discovery, date line and polar cases, storage, global point conversion and CSV/TXT/DXF/KML/GeoJSON exports.`)
