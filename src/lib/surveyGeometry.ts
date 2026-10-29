import type { CoordinateReferenceSystem } from "./nzCoordinates"
import { transformCoordinate } from "./nzCoordinates"
import { parseSurveyPointFile } from "./surveyPointFile"
import type { SurveyPoint } from "./surveyPointFile"

export type SurveyVertex = {
  easting: number
  northing: number
  elevation: number
}

export type SurveyLineFeature = {
  id: string
  code: string
  vertices: SurveyVertex[]
}

export type SurveyPolygonFeature = {
  id: string
  code: string
  rings: SurveyVertex[][]
}

export type SurveyGeometryLayer = {
  name: string
  format: "CSV" | "TXT" | "DXF"
  points: SurveyPoint[]
  lines: SurveyLineFeature[]
  polygons: SurveyPolygonFeature[]
  warnings: string[]
  pointColours?: Record<string, string>
}

type DxfPair = {
  code: number
  value: string
}

type DxfEntity = {
  type: string
  pairs: DxfPair[]
}

const maximumFeatures = 500_000
const maximumVertices = 2_000_000

function parseDxfPairs(text: string) {
  const lines = text.replace(/^\uFEFF/, "").trimEnd().split(/\r\n|\n|\r/)
  if (lines.length % 2 !== 0) {
    throw new Error("The DXF ends with a group code that has no value.")
  }
  const pairs: DxfPair[] = []

  for (let index = 0; index + 1 < lines.length; index += 2) {
    const rawCode = lines[index].trim()
    const code = Number(rawCode)
    if (!rawCode || !Number.isInteger(code) || code < 0 || code > 1071) {
      throw new Error(`Invalid DXF group code at line ${index + 1}.`)
    }
    pairs.push({ code, value: lines[index + 1].trim() })
  }

  return pairs
}

function createEntities(pairs: DxfPair[]) {
  const entities: DxfEntity[] = []
  let current: DxfEntity | null = null
  let section = ""

  pairs.forEach((pair, index) => {
    if (pair.code === 0 && pair.value.toUpperCase() === "SECTION") {
      if (current) entities.push(current)
      current = null
      section = pairs[index + 1]?.code === 2
        ? pairs[index + 1].value.toUpperCase()
        : ""
      return
    }
    if (pair.code === 0 && pair.value.toUpperCase() === "ENDSEC") {
      if (current) entities.push(current)
      current = null
      section = ""
      return
    }
    // Block definitions, tables and thumbnail data are not placed survey objects.
    if (section !== "ENTITIES") return
    if (pair.code === 0) {
      if (current) entities.push(current)
      current = { type: pair.value.toUpperCase(), pairs: [] }
    } else if (current) {
      current.pairs.push(pair)
    }
  })

  if (current) entities.push(current)
  return entities
}

function entityValue(entity: DxfEntity, code: number) {
  return entity.pairs.find((pair) => pair.code === code)?.value
}

function entityNumber(entity: DxfEntity, code: number, fallback = 0) {
  const value = entityValue(entity, code)
  if (value === undefined) return fallback
  return value ? Number(value) : Number.NaN
}

function finiteVertex(vertex: SurveyVertex) {
  return Number.isFinite(vertex.easting) &&
    Number.isFinite(vertex.northing) && Number.isFinite(vertex.elevation)
}

function entityVertex(entity: DxfEntity, xCode = 10): SurveyVertex {
  return {
    easting: entityNumber(entity, xCode, Number.NaN),
    northing: entityNumber(entity, xCode + 10, Number.NaN),
    elevation: entityNumber(entity, xCode + 20),
  }
}

function ocsToWorld(vertex: SurveyVertex, entity: DxfEntity): SurveyVertex {
  const x = entityNumber(entity, 210)
  const y = entityNumber(entity, 220)
  const z = entityNumber(entity, 230, 1)
  if (x === 0 && y === 0 && z === 1) return vertex

  // Autodesk's arbitrary-axis algorithm constructs the OCS basis in world space.
  const magnitude = Math.hypot(x, y, z)
  const nx = x / magnitude
  const ny = y / magnitude
  const nz = z / magnitude
  const nearPole = Math.abs(nx) < 1 / 64 && Math.abs(ny) < 1 / 64
  const axisX = nearPole ? [nz, 0, -nx] : [-ny, nx, 0]
  const axisLength = Math.hypot(...axisX)
  const ax = axisX.map((value) => value / axisLength)
  const ay = [
    ny * ax[2] - nz * ax[1],
    nz * ax[0] - nx * ax[2],
    nx * ax[1] - ny * ax[0],
  ]
  return {
    easting: vertex.easting * ax[0] + vertex.northing * ay[0] + vertex.elevation * nx,
    northing: vertex.easting * ax[1] + vertex.northing * ay[1] + vertex.elevation * ny,
    elevation: vertex.easting * ax[2] + vertex.northing * ay[2] + vertex.elevation * nz,
  }
}

function hasBulges(entity: DxfEntity) {
  return entity.pairs.some((pair) => pair.code === 42 && Number(pair.value) !== 0)
}

function samePosition(first: SurveyVertex, second: SurveyVertex) {
  return (
    Math.abs(first.easting - second.easting) < 1e-9 &&
    Math.abs(first.northing - second.northing) < 1e-9 &&
    Math.abs(first.elevation - second.elevation) < 1e-9
  )
}

function closeRing(vertices: SurveyVertex[]) {
  if (vertices.length < 3) return vertices
  return samePosition(vertices[0], vertices[vertices.length - 1])
    ? vertices
    : [...vertices, { ...vertices[0] }]
}

function featureId(entity: DxfEntity, prefix: string, fallback: number) {
  return entityValue(entity, 1) || `${prefix}-${entityValue(entity, 5) || fallback}`
}

function parseDxfGeometry(text: string, fileName: string): SurveyGeometryLayer {
  if (/AutoCAD Binary DXF/i.test(text.slice(0, 64))) {
    throw new Error(`${fileName} is a binary DXF. Export it as ASCII DXF first.`)
  }

  const entities = createEntities(parseDxfPairs(text))
  const points: SurveyPoint[] = []
  const lines: SurveyLineFeature[] = []
  const polygons: SurveyPolygonFeature[] = []
  const unsupported = new Map<string, number>()
  const invalid = new Map<string, number>()
  let vertexCount = 0
  let paperSpaceCount = 0
  let insertCount = 0

  function recordSkipped(collection: Map<string, number>, type: string) {
    collection.set(type, (collection.get(type) || 0) + 1)
  }

  function addPoint(entity: DxfEntity, prefix: string) {
    const sourceVertex = entityVertex(entity)
    const vertex = entity.type === "INSERT" ? ocsToWorld(sourceVertex, entity) : sourceVertex
    if (!finiteVertex(vertex)) {
      recordSkipped(invalid, entity.type)
      return
    }

    points.push({
      id: featureId(entity, prefix, points.length + 1),
      ...vertex,
      code: entityValue(entity, 8) || "",
    })
  }

  function addPath(
    vertices: SurveyVertex[],
    closed: boolean,
    id: string,
    code: string,
  ) {
    if (vertices.length < (closed ? 3 : 2) || !vertices.every(finiteVertex)) {
      recordSkipped(invalid, closed ? "closed polyline" : "line/polyline")
      return
    }
    const path = closed ? closeRing(vertices) : vertices
    if (closed && new Set(path.map((vertex) => `${vertex.easting},${vertex.northing}`)).size < 3) {
      recordSkipped(invalid, "closed polyline")
      return
    }
    vertexCount += path.length

    if (closed) {
      polygons.push({ id, code, rings: [path] })
    } else {
      lines.push({ id, code, vertices })
    }
  }

  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index]
    const layer = entityValue(entity, 8) || ""
    const layout = entityValue(entity, 410)
    if (entityNumber(entity, 67) === 1 || (layout && layout.toUpperCase() !== "MODEL")) {
      paperSpaceCount += 1
      continue
    }

    if (entity.type === "POINT" || entity.type === "INSERT") {
      if (entity.type === "INSERT") insertCount += 1
      addPoint(entity, entity.type)
      continue
    }

    if (entity.type === "LINE") {
      addPath(
        [entityVertex(entity), entityVertex(entity, 11)],
        false,
        featureId(entity, "LINE", lines.length + 1),
        layer,
      )
      continue
    }

    if (entity.type === "LWPOLYLINE") {
      if (hasBulges(entity)) {
        recordSkipped(unsupported, "curved LWPOLYLINE")
        continue
      }
      const elevation = entityNumber(entity, 38, entityNumber(entity, 30))
      const vertices: SurveyVertex[] = []
      let current: SurveyVertex | null = null
      entity.pairs.forEach((pair) => {
        if (pair.code === 10) {
          if (current) vertices.push(current)
          current = { easting: pair.value ? Number(pair.value) : Number.NaN, northing: Number.NaN, elevation }
        } else if (pair.code === 20 && current) {
          current.northing = pair.value ? Number(pair.value) : Number.NaN
        }
      })
      if (current) vertices.push(current)
      const flags = entityNumber(entity, 70)
      const declaredCount = entityNumber(entity, 90, vertices.length)
      if (!Number.isInteger(flags) || declaredCount !== vertices.length) {
        recordSkipped(invalid, entity.type)
        continue
      }
      const closed = (flags & 1) === 1
      addPath(
        vertices.map((vertex) => ocsToWorld(vertex, entity)),
        closed,
        featureId(entity, closed ? "POLYGON" : "POLYLINE", lines.length + polygons.length + 1),
        layer,
      )
      continue
    }

    if (entity.type === "POLYLINE") {
      const vertexEntities: DxfEntity[] = []
      let nextIndex = index + 1
      while (nextIndex < entities.length && entities[nextIndex].type === "VERTEX") {
        vertexEntities.push(entities[nextIndex])
        nextIndex += 1
      }
      const terminated = entities[nextIndex]?.type === "SEQEND"
      index = terminated ? nextIndex : nextIndex - 1
      const flags = entityNumber(entity, 70)
      if (!terminated || !Number.isInteger(flags)) {
        recordSkipped(invalid, entity.type)
        continue
      }
      if (flags & (16 | 64)) {
        recordSkipped(unsupported, "POLYLINE mesh")
        continue
      }
      if ((flags & (2 | 4)) || vertexEntities.some((vertex) =>
        hasBulges(vertex) || (entityNumber(vertex, 70) & (1 | 8 | 16)),
      )) {
        recordSkipped(unsupported, "curved POLYLINE")
        continue
      }
      const is3d = (flags & 8) === 8
      const vertices = vertexEntities.map((vertex) => {
        const position = entityVertex(vertex)
        return is3d ? position : ocsToWorld({ ...position, elevation: entityNumber(entity, 30) }, entity)
      })
      const closed = (flags & 1) === 1
      addPath(
        vertices,
        closed,
        featureId(entity, closed ? "POLYGON" : "POLYLINE", lines.length + polygons.length + 1),
        layer,
      )
      continue
    }

    if (
      entity.type !== "SECTION" &&
      entity.type !== "ENDSEC" &&
      entity.type !== "TABLE" &&
      entity.type !== "ENDTAB" &&
      entity.type !== "EOF" &&
      entity.type !== "VERTEX" &&
      entity.type !== "SEQEND"
    ) {
      recordSkipped(unsupported, entity.type)
    }
  }

  const featureCount = points.length + lines.length + polygons.length
  if (featureCount === 0) {
    throw new Error(
      `${fileName} has no supported model-space POINT, INSERT, LINE or straight polyline geometry. Curves, meshes and malformed entities cannot be exported.`,
    )
  }
  if (featureCount > maximumFeatures) {
    throw new Error(`${fileName} contains more than ${maximumFeatures.toLocaleString("en-NZ")} GIS features.`)
  }
  if (vertexCount > maximumVertices) {
    throw new Error(`${fileName} contains more than ${maximumVertices.toLocaleString("en-NZ")} line and polygon vertices.`)
  }

  const warnings: string[] = []
  if (insertCount > 0) {
    warnings.push(`${insertCount.toLocaleString("en-NZ")} block reference(s) read as insertion points. Block contents are not expanded.`)
  }
  if (paperSpaceCount > 0) {
    warnings.push(`${paperSpaceCount.toLocaleString("en-NZ")} paper-space entities were skipped. Only model-space survey geometry is exported.`)
  }
  if (invalid.size > 0) {
    const summary = Array.from(invalid, ([type, count]) => `${type} (${count.toLocaleString("en-NZ")})`).join(", ")
    warnings.push(`Malformed or incomplete DXF geometry was skipped: ${summary}.`)
  }
  if (unsupported.size > 0) {
    const summary = Array.from(unsupported.entries())
      .sort((first, second) => second[1] - first[1])
      .slice(0, 6)
      .map(([type, count]) => `${type} (${count.toLocaleString("en-NZ")})`)
      .join(", ")
    warnings.push(`Unsupported DXF entities were skipped: ${summary}.`)
  }

  return {
    name: fileName,
    format: "DXF",
    points,
    lines,
    polygons,
    warnings,
  }
}

export async function parseSurveyGeometryFile(file: File): Promise<SurveyGeometryLayer> {
  const extension = file.name.toLowerCase().split(".").pop()
  if (!extension || !["csv", "txt", "dxf"].includes(extension)) {
    throw new Error(`${file.name} is not a supported CSV, TXT or DXF survey file.`)
  }

  if (extension === "dxf") {
    return parseDxfGeometry(await file.text(), file.name)
  }

  const pointLayer = await parseSurveyPointFile(file)
  return {
    name: pointLayer.name,
    format: pointLayer.format,
    points: pointLayer.points,
    lines: [],
    polygons: [],
    warnings: pointLayer.warnings,
  }
}

function transformVertex(
  vertex: SurveyVertex,
  source: CoordinateReferenceSystem,
  target: CoordinateReferenceSystem,
): SurveyVertex {
  const transformed = transformCoordinate(
    { x: vertex.easting, y: vertex.northing },
    source,
    target,
  )
  return {
    easting: transformed.x,
    northing: transformed.y,
    elevation: vertex.elevation,
  }
}

export function transformSurveyGeometryLayer(
  layer: SurveyGeometryLayer,
  source: CoordinateReferenceSystem,
  target: CoordinateReferenceSystem,
): SurveyGeometryLayer {
  return {
    ...layer,
    points: layer.points.map((point) => {
      const transformed = transformCoordinate(
        { x: point.easting, y: point.northing },
        source,
        target,
      )
      return {
        ...point,
        easting: transformed.x,
        northing: transformed.y,
      }
    }),
    lines: layer.lines.map((line) => ({
      ...line,
      vertices: line.vertices.map((vertex) => transformVertex(vertex, source, target)),
    })),
    polygons: layer.polygons.map((polygon) => ({
      ...polygon,
      rings: polygon.rings.map((ring) =>
        ring.map((vertex) => transformVertex(vertex, source, target)),
      ),
    })),
  }
}

export function geometryFeatureCount(layer: SurveyGeometryLayer) {
  return layer.points.length + layer.lines.length + layer.polygons.length
}

export function geometryVertexCount(layer: SurveyGeometryLayer) {
  return (
    layer.points.length +
    layer.lines.reduce((sum, line) => sum + line.vertices.length, 0) +
    layer.polygons.reduce(
      (sum, polygon) =>
        sum + polygon.rings.reduce((ringSum, ring) => ringSum + ring.length, 0),
      0,
    )
  )
}
