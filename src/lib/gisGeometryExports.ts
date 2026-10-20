import type { CoordinateReferenceSystem } from "./nzCoordinates"
import type {
  SurveyGeometryLayer,
  SurveyLineFeature,
  SurveyPolygonFeature,
  SurveyVertex,
} from "./surveyGeometry"
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

type GeometryBounds = {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

type AttributeRow = Record<string, string | number>

type DbfField = {
  name: string
  type: "C" | "N"
  length: number
  decimals: number
}

function cleanBaseName(value: string) {
  return value
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "survey_geometry"
}

function copyBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function emptyBounds(): GeometryBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  }
}

function includeVertex(result: GeometryBounds, vertex: SurveyVertex) {
  result.minX = Math.min(result.minX, vertex.easting)
  result.minY = Math.min(result.minY, vertex.northing)
  result.minZ = Math.min(result.minZ, vertex.elevation)
  result.maxX = Math.max(result.maxX, vertex.easting)
  result.maxY = Math.max(result.maxY, vertex.northing)
  result.maxZ = Math.max(result.maxZ, vertex.elevation)
}

function pointBounds(points: SurveyPoint[]) {
  if (points.length === 0) throw new Error("At least one point is required.")
  const result = emptyBounds()
  points.forEach((point) => includeVertex(result, point))
  return result
}

function lineBounds(lines: SurveyLineFeature[]) {
  if (lines.length === 0) throw new Error("At least one line is required.")
  const result = emptyBounds()
  lines.forEach((line) => line.vertices.forEach((vertex) => includeVertex(result, vertex)))
  return result
}

function polygonBounds(polygons: SurveyPolygonFeature[]) {
  if (polygons.length === 0) throw new Error("At least one polygon is required.")
  const result = emptyBounds()
  polygons.forEach((polygon) =>
    polygon.rings.forEach((ring) => ring.forEach((vertex) => includeVertex(result, vertex))),
  )
  return result
}

function writeShapeHeader(
  view: DataView,
  fileLengthWords: number,
  geometryBounds: GeometryBounds,
  shapeType: number,
) {
  view.setInt32(0, 9994, false)
  view.setInt32(24, fileLengthWords, false)
  view.setInt32(28, 1000, true)
  view.setInt32(32, shapeType, true)
  view.setFloat64(36, geometryBounds.minX, true)
  view.setFloat64(44, geometryBounds.minY, true)
  view.setFloat64(52, geometryBounds.maxX, true)
  view.setFloat64(60, geometryBounds.maxY, true)
  view.setFloat64(68, geometryBounds.minZ, true)
  view.setFloat64(76, geometryBounds.maxZ, true)
  view.setFloat64(84, 0, true)
  view.setFloat64(92, 0, true)
}

function createPointShapeFiles(points: SurveyPoint[]) {
  const geometryBounds = pointBounds(points)
  const recordContentBytes = 36
  const recordBytes = 8 + recordContentBytes
  const shpBytes = 100 + points.length * recordBytes
  const shxBytes = 100 + points.length * 8
  const shp = new Uint8Array(shpBytes)
  const shx = new Uint8Array(shxBytes)
  const shpView = new DataView(shp.buffer)
  const shxView = new DataView(shx.buffer)

  writeShapeHeader(shpView, shpBytes / 2, geometryBounds, 11)
  writeShapeHeader(shxView, shxBytes / 2, geometryBounds, 11)

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

function samePosition(first: SurveyVertex, second: SurveyVertex) {
  return (
    Math.abs(first.easting - second.easting) < 1e-9 &&
    Math.abs(first.northing - second.northing) < 1e-9 &&
    Math.abs(first.elevation - second.elevation) < 1e-9
  )
}

function closeRing(ring: SurveyVertex[]) {
  if (ring.length === 0 || samePosition(ring[0], ring[ring.length - 1])) return [...ring]
  return [...ring, { ...ring[0] }]
}

function signedArea(ring: SurveyVertex[]) {
  let area = 0
  for (let index = 0; index + 1 < ring.length; index += 1) {
    area +=
      ring[index].easting * ring[index + 1].northing -
      ring[index + 1].easting * ring[index].northing
  }
  return area / 2
}

function shapefileRings(polygon: SurveyPolygonFeature) {
  return polygon.rings.map((sourceRing, ringIndex) => {
    const ring = closeRing(sourceRing)
    const area = signedArea(ring)
    const shouldBeClockwise = ringIndex === 0
    const isClockwise = area < 0
    return shouldBeClockwise === isClockwise ? ring : [...ring].reverse()
  })
}

function geoPackageRings(polygon: SurveyPolygonFeature) {
  return polygon.rings.map((sourceRing, ringIndex) => {
    const ring = closeRing(sourceRing)
    const area = signedArea(ring)
    const shouldBeCounterClockwise = ringIndex === 0
    const isCounterClockwise = area > 0
    return shouldBeCounterClockwise === isCounterClockwise ? ring : [...ring].reverse()
  })
}

function createPathShapeFiles(
  features: Array<{ parts: SurveyVertex[][] }>,
  shapeType: 13 | 15,
  geometryBounds: GeometryBounds,
) {
  const contentSizes = features.map((feature) => {
    const pointCount = feature.parts.reduce((sum, part) => sum + part.length, 0)
    return 60 + feature.parts.length * 4 + pointCount * 24
  })
  const shpBytes = 100 + contentSizes.reduce((sum, size) => sum + 8 + size, 0)
  const shxBytes = 100 + features.length * 8
  const shp = new Uint8Array(shpBytes)
  const shx = new Uint8Array(shxBytes)
  const shpView = new DataView(shp.buffer)
  const shxView = new DataView(shx.buffer)

  writeShapeHeader(shpView, shpBytes / 2, geometryBounds, shapeType)
  writeShapeHeader(shxView, shxBytes / 2, geometryBounds, shapeType)

  let shpOffset = 100
  let recordOffsetWords = 50

  features.forEach((feature, featureIndex) => {
    const points = feature.parts.flat()
    const contentBytes = contentSizes[featureIndex]
    const localBounds = emptyBounds()
    points.forEach((point) => includeVertex(localBounds, point))

    shpView.setInt32(shpOffset, featureIndex + 1, false)
    shpView.setInt32(shpOffset + 4, contentBytes / 2, false)
    const contentOffset = shpOffset + 8
    shpView.setInt32(contentOffset, shapeType, true)
    shpView.setFloat64(contentOffset + 4, localBounds.minX, true)
    shpView.setFloat64(contentOffset + 12, localBounds.minY, true)
    shpView.setFloat64(contentOffset + 20, localBounds.maxX, true)
    shpView.setFloat64(contentOffset + 28, localBounds.maxY, true)
    shpView.setInt32(contentOffset + 36, feature.parts.length, true)
    shpView.setInt32(contentOffset + 40, points.length, true)

    let runningPointIndex = 0
    feature.parts.forEach((part, partIndex) => {
      shpView.setInt32(contentOffset + 44 + partIndex * 4, runningPointIndex, true)
      runningPointIndex += part.length
    })

    const pointArrayOffset = contentOffset + 44 + feature.parts.length * 4
    points.forEach((point, pointIndex) => {
      shpView.setFloat64(pointArrayOffset + pointIndex * 16, point.easting, true)
      shpView.setFloat64(pointArrayOffset + pointIndex * 16 + 8, point.northing, true)
    })

    const zRangeOffset = pointArrayOffset + points.length * 16
    shpView.setFloat64(zRangeOffset, localBounds.minZ, true)
    shpView.setFloat64(zRangeOffset + 8, localBounds.maxZ, true)
    points.forEach((point, pointIndex) => {
      shpView.setFloat64(zRangeOffset + 16 + pointIndex * 8, point.elevation, true)
    })

    const shxOffset = 100 + featureIndex * 8
    shxView.setInt32(shxOffset, recordOffsetWords, false)
    shxView.setInt32(shxOffset + 4, contentBytes / 2, false)

    shpOffset += 8 + contentBytes
    recordOffsetWords += (8 + contentBytes) / 2
  })

  return { shp, shx }
}

function lineLength(line: SurveyLineFeature) {
  let length = 0
  for (let index = 0; index + 1 < line.vertices.length; index += 1) {
    length += Math.hypot(
      line.vertices[index + 1].easting - line.vertices[index].easting,
      line.vertices[index + 1].northing - line.vertices[index].northing,
    )
  }
  return length
}

function polygonArea(polygon: SurveyPolygonFeature) {
  return polygon.rings.reduce((total, ring, index) => {
    const area = Math.abs(signedArea(closeRing(ring)))
    return index === 0 ? total + area : total - area
  }, 0)
}

function polygonVertexCount(polygon: SurveyPolygonFeature) {
  return polygon.rings.reduce((sum, ring) => sum + ring.length, 0)
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

function createDbf(rows: AttributeRow[], fields: DbfField[]) {
  const headerLength = 32 + fields.length * 32 + 1
  const recordLength = 1 + fields.reduce((sum, field) => sum + field.length, 0)
  const dbf = new Uint8Array(headerLength + rows.length * recordLength + 1)
  const view = new DataView(dbf.buffer)
  const now = new Date()

  dbf[0] = 0x03
  dbf[1] = now.getUTCFullYear() - 1900
  dbf[2] = now.getUTCMonth() + 1
  dbf[3] = now.getUTCDate()
  view.setUint32(4, rows.length, true)
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

  rows.forEach((row, rowIndex) => {
    const recordOffset = headerLength + rowIndex * recordLength
    dbf[recordOffset] = 0x20
    let fieldOffset = recordOffset + 1
    fields.forEach((field) => {
      const rawValue = row[field.name]
      const value =
        field.type === "N" && typeof rawValue === "number"
          ? rawValue.toFixed(field.decimals)
          : String(rawValue ?? "")
      writeAsciiField(dbf, fieldOffset, field.length, value, field.type === "N")
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

function addShapeComponents(
  entries: Array<{ name: string; data: Uint8Array }>,
  baseName: string,
  shapeFiles: { shp: Uint8Array; shx: Uint8Array },
  dbf: Uint8Array,
  coordinateSystem: CoordinateReferenceSystem,
) {
  entries.push(
    { name: `${baseName}.shp`, data: shapeFiles.shp },
    { name: `${baseName}.shx`, data: shapeFiles.shx },
    { name: `${baseName}.dbf`, data: dbf },
    { name: `${baseName}.prj`, data: textEncoder.encode(projectionWkt[coordinateSystem]) },
    { name: `${baseName}.cpg`, data: textEncoder.encode("UTF-8") },
  )
}

export function createGeometryShapefileZip(
  layer: SurveyGeometryLayer,
  coordinateSystem: CoordinateReferenceSystem,
  requestedBaseName: string,
) {
  const featureCount = layer.points.length + layer.lines.length + layer.polygons.length
  if (featureCount === 0) throw new Error("At least one GIS feature is required.")
  if (featureCount > 500_000) {
    throw new Error("Shapefile export is limited to 500,000 browser-generated features.")
  }

  const baseName = cleanBaseName(requestedBaseName)
  const entries: Array<{ name: string; data: Uint8Array }> = []
  const projected = coordinateSystem !== "EPSG:4167"

  if (layer.points.length > 0) {
    const fields: DbfField[] = [
      { name: "POINT_ID", type: "C", length: 64, decimals: 0 },
      { name: "CODE", type: "C", length: 64, decimals: 0 },
      { name: "ELEVATION", type: "N", length: 18, decimals: 4 },
      { name: "EASTING", type: "N", length: 20, decimals: projected ? 4 : 9 },
      { name: "NORTHING", type: "N", length: 20, decimals: projected ? 4 : 9 },
    ]
    const rows = layer.points.map((point) => ({
      POINT_ID: point.id,
      CODE: point.code,
      ELEVATION: point.elevation,
      EASTING: point.easting,
      NORTHING: point.northing,
    }))
    addShapeComponents(
      entries,
      `${baseName}_points`,
      createPointShapeFiles(layer.points),
      createDbf(rows, fields),
      coordinateSystem,
    )
  }

  if (layer.lines.length > 0) {
    const fields: DbfField[] = [
      { name: "FEATURE_ID", type: "C", length: 64, decimals: 0 },
      { name: "CODE", type: "C", length: 64, decimals: 0 },
      { name: "VERTICES", type: "N", length: 10, decimals: 0 },
      ...(projected
        ? [{ name: "LENGTH_M", type: "N" as const, length: 20, decimals: 4 }]
        : []),
    ]
    const rows = layer.lines.map((line) => ({
      FEATURE_ID: line.id,
      CODE: line.code,
      VERTICES: line.vertices.length,
      LENGTH_M: lineLength(line),
    }))
    addShapeComponents(
      entries,
      `${baseName}_lines`,
      createPathShapeFiles(
        layer.lines.map((line) => ({ parts: [line.vertices] })),
        13,
        lineBounds(layer.lines),
      ),
      createDbf(rows, fields),
      coordinateSystem,
    )
  }

  if (layer.polygons.length > 0) {
    const fields: DbfField[] = [
      { name: "FEATURE_ID", type: "C", length: 64, decimals: 0 },
      { name: "CODE", type: "C", length: 64, decimals: 0 },
      { name: "RINGS", type: "N", length: 8, decimals: 0 },
      { name: "VERTICES", type: "N", length: 10, decimals: 0 },
      ...(projected
        ? [{ name: "AREA_M2", type: "N" as const, length: 22, decimals: 4 }]
        : []),
    ]
    const rows = layer.polygons.map((polygon) => ({
      FEATURE_ID: polygon.id,
      CODE: polygon.code,
      RINGS: polygon.rings.length,
      VERTICES: polygonVertexCount(polygon),
      AREA_M2: polygonArea(polygon),
    }))
    const shapePolygons = layer.polygons.map((polygon) => ({
      parts: shapefileRings(polygon),
    }))
    addShapeComponents(
      entries,
      `${baseName}_polygons`,
      createPathShapeFiles(shapePolygons, 15, polygonBounds(layer.polygons)),
      createDbf(rows, fields),
      coordinateSystem,
    )
  }

  return copyBuffer(createStoredZip(entries))
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
      existing.addEventListener(
        "error",
        () => reject(new Error("The GeoPackage SQLite runtime could not be downloaded.")),
        { once: true },
      )
      return
    }

    const script = document.createElement("script")
    script.src = `${sqlJsBaseUrl}/sql-wasm.js`
    script.async = true
    script.crossOrigin = "anonymous"
    script.dataset.surveytoolSqljs = "true"
    script.addEventListener("load", initialise, { once: true })
    script.addEventListener(
      "error",
      () => reject(new Error("The GeoPackage SQLite runtime could not be downloaded.")),
      { once: true },
    )
    document.head.appendChild(script)
  })

  return sqlModulePromise
}

function geometryHeader(srsId: number, wkb: Uint8Array) {
  const bytes = new Uint8Array(8 + wkb.length)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x47
  bytes[1] = 0x50
  bytes[2] = 0
  bytes[3] = 1
  view.setInt32(4, srsId, true)
  bytes.set(wkb, 8)
  return bytes
}

function pointWkb(point: SurveyPoint) {
  const bytes = new Uint8Array(29)
  const view = new DataView(bytes.buffer)
  bytes[0] = 1
  view.setUint32(1, 1001, true)
  view.setFloat64(5, point.easting, true)
  view.setFloat64(13, point.northing, true)
  view.setFloat64(21, point.elevation, true)
  return bytes
}

function lineWkb(line: SurveyLineFeature) {
  const bytes = new Uint8Array(9 + line.vertices.length * 24)
  const view = new DataView(bytes.buffer)
  bytes[0] = 1
  view.setUint32(1, 1002, true)
  view.setUint32(5, line.vertices.length, true)
  line.vertices.forEach((vertex, index) => {
    const offset = 9 + index * 24
    view.setFloat64(offset, vertex.easting, true)
    view.setFloat64(offset + 8, vertex.northing, true)
    view.setFloat64(offset + 16, vertex.elevation, true)
  })
  return bytes
}

function polygonWkb(polygon: SurveyPolygonFeature) {
  const rings = geoPackageRings(polygon)
  const bytes = new Uint8Array(
    9 + rings.reduce((sum, ring) => sum + 4 + ring.length * 24, 0),
  )
  const view = new DataView(bytes.buffer)
  bytes[0] = 1
  view.setUint32(1, 1003, true)
  view.setUint32(5, rings.length, true)
  let offset = 9
  rings.forEach((ring) => {
    view.setUint32(offset, ring.length, true)
    offset += 4
    ring.forEach((vertex) => {
      view.setFloat64(offset, vertex.easting, true)
      view.setFloat64(offset + 8, vertex.northing, true)
      view.setFloat64(offset + 16, vertex.elevation, true)
      offset += 24
    })
  })
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
  rows.forEach((row) =>
    db.run(
      "INSERT INTO gpkg_spatial_ref_sys (srs_name,srs_id,organization,organization_coordsys_id,definition,description) VALUES (?,?,?,?,?,?)",
      row,
    ),
  )
}

function insertContent(
  db: SqlDatabase,
  tableName: string,
  identifier: string,
  description: string,
  geometryType: "POINT" | "LINESTRING" | "POLYGON",
  geometryBounds: GeometryBounds,
  srsId: number,
  timestamp: string,
) {
  db.run(
    "INSERT INTO gpkg_contents (table_name,data_type,identifier,description,last_change,min_x,min_y,max_x,max_y,srs_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      tableName,
      "features",
      identifier,
      description,
      timestamp,
      geometryBounds.minX,
      geometryBounds.minY,
      geometryBounds.maxX,
      geometryBounds.maxY,
      srsId,
    ],
  )
  db.run(
    "INSERT INTO gpkg_geometry_columns (table_name,column_name,geometry_type_name,srs_id,z,m) VALUES (?,?,?,?,?,?)",
    [tableName, "geom", geometryType, srsId, 1, 0],
  )
}

export async function createGeometryGeoPackage(
  layer: SurveyGeometryLayer,
  coordinateSystem: CoordinateReferenceSystem,
) {
  const featureCount = layer.points.length + layer.lines.length + layer.polygons.length
  const vertexCount =
    layer.points.length +
    layer.lines.reduce((sum, line) => sum + line.vertices.length, 0) +
    layer.polygons.reduce(
      (sum, polygon) =>
        sum + polygon.rings.reduce((ringSum, ring) => ringSum + ring.length, 0),
      0,
    )

  if (featureCount === 0) throw new Error("At least one GIS feature is required.")
  if (featureCount > 250_000 || vertexCount > 1_000_000) {
    throw new Error(
      "GeoPackage browser export is limited to 250,000 features and 1,000,000 vertices.",
    )
  }

  const SQL = await loadSqlModule()
  const db = new SQL.Database()
  const srsId = Number(coordinateSystem.split(":")[1])
  const timestamp = new Date().toISOString()
  const projected = coordinateSystem !== "EPSG:4167"

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

    if (layer.points.length > 0) {
      db.run(`CREATE TABLE survey_points (
        fid INTEGER PRIMARY KEY AUTOINCREMENT,
        geom POINT NOT NULL,
        point_id TEXT,
        code TEXT,
        elevation DOUBLE,
        easting DOUBLE,
        northing DOUBLE
      )`)
      insertContent(
        db,
        "survey_points",
        "SurveyTool points",
        "Survey point dataset",
        "POINT",
        pointBounds(layer.points),
        srsId,
        timestamp,
      )
      const statement = db.prepare(
        "INSERT INTO survey_points (geom,point_id,code,elevation,easting,northing) VALUES (?,?,?,?,?,?)",
      )
      db.run("BEGIN")
      layer.points.forEach((point) => {
        statement.bind([
          geometryHeader(srsId, pointWkb(point)),
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
    }

    if (layer.lines.length > 0) {
      db.run(`CREATE TABLE survey_lines (
        fid INTEGER PRIMARY KEY AUTOINCREMENT,
        geom LINESTRING NOT NULL,
        feature_id TEXT,
        code TEXT,
        vertex_count INTEGER,
        length_m DOUBLE
      )`)
      insertContent(
        db,
        "survey_lines",
        "SurveyTool lines",
        "Open DXF line and polyline features",
        "LINESTRING",
        lineBounds(layer.lines),
        srsId,
        timestamp,
      )
      const statement = db.prepare(
        "INSERT INTO survey_lines (geom,feature_id,code,vertex_count,length_m) VALUES (?,?,?,?,?)",
      )
      db.run("BEGIN")
      layer.lines.forEach((line) => {
        statement.bind([
          geometryHeader(srsId, lineWkb(line)),
          line.id,
          line.code,
          line.vertices.length,
          projected ? lineLength(line) : null,
        ])
        statement.step()
        statement.reset()
      })
      statement.free()
      db.run("COMMIT")
    }

    if (layer.polygons.length > 0) {
      db.run(`CREATE TABLE survey_polygons (
        fid INTEGER PRIMARY KEY AUTOINCREMENT,
        geom POLYGON NOT NULL,
        feature_id TEXT,
        code TEXT,
        ring_count INTEGER,
        vertex_count INTEGER,
        area_m2 DOUBLE
      )`)
      insertContent(
        db,
        "survey_polygons",
        "SurveyTool polygons",
        "Closed DXF polyline and boundary features",
        "POLYGON",
        polygonBounds(layer.polygons),
        srsId,
        timestamp,
      )
      const statement = db.prepare(
        "INSERT INTO survey_polygons (geom,feature_id,code,ring_count,vertex_count,area_m2) VALUES (?,?,?,?,?,?)",
      )
      db.run("BEGIN")
      layer.polygons.forEach((polygon) => {
        statement.bind([
          geometryHeader(srsId, polygonWkb(polygon)),
          polygon.id,
          polygon.code,
          polygon.rings.length,
          polygonVertexCount(polygon),
          projected ? polygonArea(polygon) : null,
        ])
        statement.step()
        statement.reset()
      })
      statement.free()
      db.run("COMMIT")
    }

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
