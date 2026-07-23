import type { CoordinateReferenceSystem } from "./nzCoordinates"
import type { SurveyPoint } from "./surveyPointFile"

const textEncoder = new TextEncoder()
const sqlJsVersion = "1.14.1"
const sqlJsBaseUrl = `https://cdn.jsdelivr.net/npm/sql.js@${sqlJsVersion}/dist`

const projectionWkt: Record<CoordinateReferenceSystem, string> = {
  "EPSG:2105": 'PROJCS["NZGD2000 / Mount Eden 2000",GEOGCS["NZGD2000",DATUM["New_Zealand_Geodetic_Datum_2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",-36.8797222222222],PARAMETER["central_meridian",174.764166666667],PARAMETER["scale_factor",0.9999],PARAMETER["false_easting",400000],PARAMETER["false_northing",800000],UNIT["metre",1],AUTHORITY["EPSG","2105"]]',
  "EPSG:2193": 'PROJCS["NZGD2000 / New Zealand Transverse Mercator 2000",GEOGCS["NZGD2000",DATUM["New_Zealand_Geodetic_Datum_2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",173],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",1600000],PARAMETER["false_northing",10000000],UNIT["metre",1],AUTHORITY["EPSG","2193"]]',
  "EPSG:4167": 'GEOGCS["NZGD2000",DATUM["New_Zealand_Geodetic_Datum_2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4167"]]',
}

const wgs84Wkt = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]'

function cleanBaseName(value: string) {
  return value
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "survey_points"
}

function copyBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function bounds(points: SurveyPoint[]) {
  if (points.length === 0) throw new Error("At least one valid point is required.")

  return points.reduce(
    (result, point) => ({
      minX: Math.min(result.minX, point.easting),
      minY: Math.min(result.minY, point.northing),
      minZ: Math.min(result.minZ, point.elevation),
      maxX: Math.max(result.maxX, point.easting),
      maxY: Math.max(result.maxY, point.northing),
      maxZ: Math.max(result.maxZ, point.elevation),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    },
  )
}

function writeShapeHeader(
  view: DataView,
  fileLengthWords: number,
  pointBounds: ReturnType<typeof bounds>,
) {
  view.setInt32(0, 9994, false)
  view.setInt32(24, fileLengthWords, false)
  view.setInt32(28, 1000, true)
  view.setInt32(32, 11, true)
  view.setFloat64(36, pointBounds.minX, true)
  view.setFloat64(44, pointBounds.minY, true)
  view.setFloat64(52, pointBounds.maxX, true)
  view.setFloat64(60, pointBounds.maxY, true)
  view.setFloat64(68, pointBounds.minZ, true)
  view.setFloat64(76, pointBounds.maxZ, true)
  view.setFloat64(84, 0, true)
  view.setFloat64(92, 0, true)
}

function createShapeFiles(points: SurveyPoint[]) {
  const pointBounds = bounds(points)
  const recordContentBytes = 36
  const recordBytes = 8 + recordContentBytes
  const shpBytes = 100 + points.length * recordBytes
  const shxBytes = 100 + points.length * 8
  const shp = new Uint8Array(shpBytes)
  const shx = new Uint8Array(shxBytes)
  const shpView = new DataView(shp.buffer)
  const shxView = new DataView(shx.buffer)

  writeShapeHeader(shpView, shpBytes / 2, pointBounds)
  writeShapeHeader(shxView, shxBytes / 2, pointBounds)

  let shpOffset = 100
  let recordOffsetWords = 50

  points.forEach((point, index) => {
    shpView.setInt32(shpOffset, index + 1, false)
    shpView.setInt32(shpOffset + 4, recordContentBytes / 2, false)
    shpView.setInt32(shpOffset + 8, 11, true)
    shpView.setFloat64(shpOffset + 12, point.easting, true)
    shpView.setFloat64(shpOffset + 20, point.northing, true)
    shpView.setFloat64(shpOffset + 28, point.elevation, true)
    shpView.setFloat64(shpOffset + 36, 0, true)

    const shxOffset = 100 + index * 8
    shxView.setInt32(shxOffset, recordOffsetWords, false)
    shxView.setInt32(shxOffset + 4, recordContentBytes / 2, false)

    shpOffset += recordBytes
    recordOffsetWords += recordBytes / 2
  })

  return { shp, shx }
}

type DbfField = {
  name: string
  type: "C" | "N"
  length: number
  decimals: number
  value: (point: SurveyPoint) => string
}

function writeAsciiField(
  target: Uint8Array,
  offset: number,
  length: number,
  value: string,
  alignRight: boolean,
) {
  target.fill(0x20, offset, offset + length)
  const encoded = textEncoder.encode(value)
  const source = encoded.subarray(0, length)
  const start = alignRight ? offset + length - source.length : offset
  target.set(source, start)
}

function createDbf(points: SurveyPoint[], geographic: boolean) {
  const coordinateDecimals = geographic ? 9 : 4
  const fields: DbfField[] = [
    { name: "POINT_ID", type: "C", length: 64, decimals: 0, value: (point) => point.id },
    { name: "CODE", type: "C", length: 64, decimals: 0, value: (point) => point.code },
    { name: "ELEVATION", type: "N", length: 18, decimals: 4, value: (point) => point.elevation.toFixed(4) },
    { name: "EASTING", type: "N", length: 20, decimals: coordinateDecimals, value: (point) => point.easting.toFixed(coordinateDecimals) },
    { name: "NORTHING", type: "N", length: 20, decimals: coordinateDecimals, value: (point) => point.northing.toFixed(coordinateDecimals) },
  ]
  const headerLength = 32 + fields.length * 32 + 1
  const recordLength = 1 + fields.reduce((sum, field) => sum + field.length, 0)
  const dbf = new Uint8Array(headerLength + points.length * recordLength + 1)
  const view = new DataView(dbf.buffer)
  const now = new Date()

  dbf[0] = 0x03
  dbf[1] = now.getUTCFullYear() - 1900
  dbf[2] = now.getUTCMonth() + 1
  dbf[3] = now.getUTCDate()
  view.setUint32(4, points.length, true)
  view.setUint16(8, headerLength, true)
  view.setUint16(10, recordLength, true)

  fields.forEach((field, index) => {
    const offset = 32 + index * 32
    dbf.set(textEncoder.encode(field.name).subarray(0, 10), offset)
    dbf[offset + 11] = field.type.charCodeAt(0)
    dbf[offset + 16] = field.length
    dbf[offset + 17] = field.decimals
  })
  dbf[headerLength - 1] = 0x0d

  points.forEach((point, pointIndex) => {
    const recordOffset = headerLength + pointIndex * recordLength
    dbf[recordOffset] = 0x20
    let fieldOffset = recordOffset + 1
    fields.forEach((field) => {
      writeAsciiField(
        dbf,
        fieldOffset,
        field.length,
        field.value(point),
        field.type === "N",
      )
      fieldOffset += field.length
    })
  })

  dbf[dbf.length - 1] = 0x1a
  return dbf
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear())
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  }
}

function concatenate(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  chunks.forEach((chunk) => {
    result.set(chunk, offset)
    offset += chunk.length
  })
  return result
}

function createStoredZip(entries: Array<{ name: string; data: Uint8Array }>) {
  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  const now = dosDateTime(new Date())
  let localOffset = 0

  entries.forEach(({ name, data }) => {
    const nameBytes = textEncoder.encode(name)
    const checksum = crc32(data)
    const local = new Uint8Array(30 + nameBytes.length + data.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0x0800, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, now.time, true)
    localView.setUint16(12, now.date, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, data.length, true)
    localView.setUint32(22, data.length, true)
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    local.set(data, 30 + nameBytes.length)
    localChunks.push(local)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, now.time, true)
    centralView.setUint16(14, now.date, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, data.length, true)
    centralView.setUint32(24, data.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, localOffset, true)
    central.set(nameBytes, 46)
    centralChunks.push(central)
    localOffset += local.length
  })

  const localData = concatenate(localChunks)
  const centralData = concatenate(centralChunks)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralData.length, true)
  endView.setUint32(16, localData.length, true)
  endView.setUint16(20, 0, true)
  return concatenate([localData, centralData, end])
}

export function createShapefileZip(
  points: SurveyPoint[],
  coordinateSystem: CoordinateReferenceSystem,
  requestedBaseName: string,
) {
  if (points.length > 500_000) {
    throw new Error("Shapefile export is limited to 500,000 browser-generated points.")
  }
  const baseName = cleanBaseName(requestedBaseName)
  const { shp, shx } = createShapeFiles(points)
  const dbf = createDbf(points, coordinateSystem === "EPSG:4167")
  const zip = createStoredZip([
    { name: `${baseName}.shp`, data: shp },
    { name: `${baseName}.shx`, data: shx },
    { name: `${baseName}.dbf`, data: dbf },
    { name: `${baseName}.prj`, data: textEncoder.encode(projectionWkt[coordinateSystem]) },
    { name: `${baseName}.cpg`, data: textEncoder.encode("UTF-8") },
  ])
  return copyBuffer(zip)
}

type SqlStatement = {
  bind(values: unknown[]): void
  step(): boolean
  reset(): void
  free(): void
}

type SqlDatabase = {
  run(sql: string, values?: unknown[]): void
  prepare(sql: string): SqlStatement
  export(): Uint8Array
  close(): void
}

type SqlModule = {
  Database: new () => SqlDatabase
}

declare global {
  interface Window {
    initSqlJs?: (config: {
      locateFile: (file: string) => string
    }) => Promise<SqlModule>
  }
}

let sqlModulePromise: Promise<SqlModule> | null = null

function loadSqlModule() {
  if (sqlModulePromise) return sqlModulePromise

  sqlModulePromise = new Promise<SqlModule>((resolve, reject) => {
    const initialise = () => {
      if (!window.initSqlJs) {
        reject(new Error("The GeoPackage SQLite runtime could not be loaded."))
        return
      }
      window.initSqlJs({ locateFile: (file) => `${sqlJsBaseUrl}/${file}` })
        .then(resolve)
        .catch(() => reject(new Error("The GeoPackage SQLite runtime could not start.")))
    }

    if (window.initSqlJs) {
      initialise()
      return
    }

    const existing = document.querySelector<HTMLScriptElement>("script[data-surveytool-sqljs]")
    if (existing) {
      existing.addEventListener("load", initialise, { once: true })
      existing.addEventListener("error", () => reject(new Error("The GeoPackage SQLite runtime could not be downloaded.")), { once: true })
      return
    }

    const script = document.createElement("script")
    script.src = `${sqlJsBaseUrl}/sql-wasm.js`
    script.async = true
    script.crossOrigin = "anonymous"
    script.dataset.surveytoolSqljs = "true"
    script.addEventListener("load", initialise, { once: true })
    script.addEventListener("error", () => reject(new Error("The GeoPackage SQLite runtime could not be downloaded.")), { once: true })
    document.head.appendChild(script)
  })

  return sqlModulePromise
}

function geoPackagePoint(point: SurveyPoint, srsId: number) {
  const bytes = new Uint8Array(37)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x47
  bytes[1] = 0x50
  bytes[2] = 0
  bytes[3] = 1
  view.setInt32(4, srsId, true)
  bytes[8] = 1
  view.setUint32(9, 1001, true)
  view.setFloat64(13, point.easting, true)
  view.setFloat64(21, point.northing, true)
  view.setFloat64(29, point.elevation, true)
  return bytes
}

function insertSpatialReferenceSystems(db: SqlDatabase) {
  const rows: Array<[string, number, string, number, string, string]> = [
    ["Undefined Cartesian", -1, "NONE", -1, "undefined", "undefined Cartesian coordinate reference system"],
    ["Undefined geographic", 0, "NONE", 0, "undefined", "undefined geographic coordinate reference system"],
    ["WGS 84 geodetic", 4326, "EPSG", 4326, wgs84Wkt, "longitude and latitude on WGS 84"],
    ["NZGD2000 / Mount Eden 2000", 2105, "EPSG", 2105, projectionWkt["EPSG:2105"], "Mount Eden 2000 circuit projection"],
    ["NZGD2000 / NZTM2000", 2193, "EPSG", 2193, projectionWkt["EPSG:2193"], "New Zealand Transverse Mercator 2000"],
    ["NZGD2000 geographic", 4167, "EPSG", 4167, projectionWkt["EPSG:4167"], "longitude and latitude on NZGD2000"],
  ]
  rows.forEach((row) => db.run(
    "INSERT INTO gpkg_spatial_ref_sys (srs_name,srs_id,organization,organization_coordsys_id,definition,description) VALUES (?,?,?,?,?,?)",
    row,
  ))
}

export async function createGeoPackage(
  points: SurveyPoint[],
  coordinateSystem: CoordinateReferenceSystem,
) {
  if (points.length === 0) throw new Error("At least one valid point is required.")
  if (points.length > 250_000) {
    throw new Error("GeoPackage export is limited to 250,000 points in the browser.")
  }

  const SQL = await loadSqlModule()
  const db = new SQL.Database()
  const pointBounds = bounds(points)
  const srsId = Number(coordinateSystem.split(":")[1])
  const timestamp = new Date().toISOString()

  try {
    db.run("PRAGMA application_id=1196444487")
    db.run("PRAGMA user_version=10400")
    db.run("PRAGMA foreign_keys=ON")
    db.run(`CREATE TABLE gpkg_spatial_ref_sys (
      srs_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL PRIMARY KEY,
      organization TEXT NOT NULL,
      organization_coordsys_id INTEGER NOT NULL,
      definition TEXT NOT NULL,
      description TEXT
    )`)
    db.run(`CREATE TABLE gpkg_contents (
      table_name TEXT NOT NULL PRIMARY KEY,
      data_type TEXT NOT NULL,
      identifier TEXT UNIQUE,
      description TEXT DEFAULT '',
      last_change DATETIME NOT NULL,
      min_x DOUBLE,
      min_y DOUBLE,
      max_x DOUBLE,
      max_y DOUBLE,
      srs_id INTEGER,
      CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
    )`)
    db.run(`CREATE TABLE gpkg_geometry_columns (
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      geometry_type_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL,
      z TINYINT NOT NULL,
      m TINYINT NOT NULL,
      CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
      CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
      CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
    )`)
    insertSpatialReferenceSystems(db)
    db.run(`CREATE TABLE survey_points (
      fid INTEGER PRIMARY KEY AUTOINCREMENT,
      geom POINT NOT NULL,
      point_id TEXT,
      code TEXT,
      elevation DOUBLE,
      easting DOUBLE,
      northing DOUBLE
    )`)
    db.run(
      "INSERT INTO gpkg_contents (table_name,data_type,identifier,description,last_change,min_x,min_y,max_x,max_y,srs_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ["survey_points", "features", "SurveyTool points", "Converted survey point dataset", timestamp, pointBounds.minX, pointBounds.minY, pointBounds.maxX, pointBounds.maxY, srsId],
    )
    db.run(
      "INSERT INTO gpkg_geometry_columns (table_name,column_name,geometry_type_name,srs_id,z,m) VALUES (?,?,?,?,?,?)",
      ["survey_points", "geom", "POINT", srsId, 1, 0],
    )

    const statement = db.prepare(
      "INSERT INTO survey_points (geom,point_id,code,elevation,easting,northing) VALUES (?,?,?,?,?,?)",
    )
    db.run("BEGIN")
    points.forEach((point) => {
      statement.bind([
        geoPackagePoint(point, srsId),
        point.id,
        point.code,
        point.elevation,
        point.easting,
        point.northing,
      ])
      statement.step()
      statement.reset()
    })
    statement.free()
    db.run("COMMIT")
    return copyBuffer(db.export())
  } catch (error) {
    try {
      db.run("ROLLBACK")
    } catch {
      // No active transaction.
    }
    throw error
  } finally {
    db.close()
  }
}
