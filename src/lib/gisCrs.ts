import type { CoordinateReferenceSystem } from "./nzCoordinates"
import { getCoordinateSystem } from "./nzCoordinates"
import { isGeographicCrs } from "./mapCoordinates"
import type { MapCrs } from "./mapCoordinates"

const legacyProjectionWkt: Record<CoordinateReferenceSystem, string> = {
  "EPSG:2105": 'PROJCS["NZGD2000 / Mount Eden 2000",GEOGCS["NZGD2000",DATUM["New_Zealand_Geodetic_Datum_2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",-36.8797222222222],PARAMETER["central_meridian",174.764166666667],PARAMETER["scale_factor",0.9999],PARAMETER["false_easting",400000],PARAMETER["false_northing",800000],UNIT["metre",1],AUTHORITY["EPSG","2105"]]',
  "EPSG:2193": 'PROJCS["NZGD2000 / New Zealand Transverse Mercator 2000",GEOGCS["NZGD2000",DATUM["New_Zealand_Geodetic_Datum_2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",173],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",1600000],PARAMETER["false_northing",10000000],UNIT["metre",1],AUTHORITY["EPSG","2193"]]',
  "EPSG:4167": 'GEOGCS["NZGD2000",DATUM["New_Zealand_Geodetic_Datum_2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4167"]]',
}

export const wgs84Wkt = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]'


export type GisCrsDefinition = MapCrs & { wkt: string }
export type GisOutputCrs = GisCrsDefinition | CoordinateReferenceSystem

export function resolveGisOutputCrs(value: GisOutputCrs): GisCrsDefinition {
  let result: GisCrsDefinition
  if (typeof value === "string") {
    const wkt = legacyProjectionWkt[value]
    if (!wkt) throw new Error("Load the selected CRS definition before exporting.")
    result = { code: value, name: getCoordinateSystem(value).name, wkt, proj4: wkt, unit: value === "EPSG:4167" ? "degree" : "metre", area: "New Zealand", bbox: null }
  } else result = value
  if (!/^EPSG:\d{4,6}$/.test(result.code) || !/^(PROJCS|GEOGCS|PROJCRS|GEOGCRS)\s*\[/.test(result.wkt ?? "")) throw new Error("The output CRS is missing a valid EPSG identifier or WKT definition.")
  const authorities = [...result.wkt.matchAll(/(?:AUTHORITY|ID)\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi)]
  if (authorities.length && `EPSG:${authorities[authorities.length - 1][1]}` !== result.code) throw new Error("The output CRS identifier and definition do not match.")
  return result
}

const definitionBuckets = new Map<number, Promise<Record<string, string>>>()
export async function loadGisCrsDefinition(crs: MapCrs): Promise<GisCrsDefinition> {
  const bucket = Math.floor(Number(crs.code.slice(5)) / 1000)
  if (!Number.isInteger(bucket) || !/^EPSG:\d{4,6}$/.test(crs.code)) throw new Error("Select a valid output CRS first.")
  if (!definitionBuckets.has(bucket)) {
    definitionBuckets.set(bucket, fetch(`${import.meta.env?.BASE_URL ?? "/"}data/crs-definitions/${bucket}.json?v=1`).then(async (response) => {
      if (!response.ok) throw new Error("The selected CRS definition could not be loaded. Please retry the export.")
      return response.json() as Promise<Record<string, string>>
    }).catch((error) => { definitionBuckets.delete(bucket); throw error }))
  }
  const records = await definitionBuckets.get(bucket)!
  const result = resolveGisOutputCrs({ ...crs, proj4: crs.canonicalProj4 ?? crs.proj4, wkt: records[crs.code] })
  if (isGeographicCrs(result) && !result.unit) throw new Error("The geographic CRS units are not available.")
  return result
}
