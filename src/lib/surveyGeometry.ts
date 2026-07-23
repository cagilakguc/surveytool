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
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/)
  const pairs: DxfPair[] = []

  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index].trim())
    if (Number.isFinite(code)) {
      pairs.push({ code, value: lines[index + 1].trim() })
    }
  }

  return pairs
}

function createEntities(pairs: DxfPair[]) {
  const entities: DxfEntity[] = []
  let current: DxfEntity | null = null

  pairs.forEach((pair) => {
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
  const parsed = Number(entityValue(entity, code))
  return Number.isFinite(parsed) ? parsed : fallback
}

function entityNumbers(entity: DxfEntity, code: number) {
  return entity.pairs
    .filter((pair) => pair.code === code)
    .map((pair) => Number(pair.value))
    .filter(Number.isFinite)
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
  let vertexCount = 0

  function addPoint(entity: DxfEntity, prefix: string) {
    const easting = Number(entityValue(entity, 10))
    const northing = Number(entityValue(entity, 20))
    const elevation = entityNumber(entity, 30)
    if (!Number.isFinite(easting) || !Number.isFinite(northing)) return

    points.push({
      id: featureId(entity, prefix, points.length + 1),
      easting,
      northing,
      elevation,
      code: entityValue(entity, 8) || "",
    })
  }

  function addPath(
    vertices: SurveyVertex[],
    closed: boolean,
    id: string,
    code: string,
  ) {
    if (vertices.length < 2) return
    vertexCount += vertices.length

    if (closed && vertices.length >= 3) {
      polygons.push({ id, code, rings: [closeRing(vertices)] })
    } else {
      lines.push({ id, code, vertices })
    }
  }

  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index]
    const layer = entityValue(entity, 8) || ""

    if (entity.type === "POINT" || entity.type === "INSERT") {
      addPoint(entity, entity.type)
      continue
    }

    if (entity.type === "LINE") {
      addPath(
        [
          {
            easting: entityNumber(entity, 10),
            northing: entityNumber(entity, 20),
            elevation: entityNumber(entity, 30),
          },
          {
            easting: entityNumber(entity, 11),
            northing: entityNumber(entity, 21),
            elevation: entityNumber(entity, 31),
          },
        ],
        false,
        featureId(entity, "LINE", lines.length + 1),
        layer,
      )
      continue
    }

    if (entity.type === "LWPOLYLINE") {
      const eastings = entityNumbers(entity, 10)
      const northings = entityNumbers(entity, 20)
      const elevation = entityNumber(entity, 38, entityNumber(entity, 30))
      const count = Math.min(eastings.length, northings.length)
      const vertices = Array.from({ length: count }, (_, vertexIndex) => ({
        easting: eastings[vertexIndex],
        northing: northings[vertexIndex],
        elevation,
      }))
      const closed = (entityNumber(entity, 70) & 1) === 1
      addPath(
        vertices,
        closed,
        featureId(entity, closed ? "POLYGON" : "POLYLINE", lines.length + polygons.length + 1),
        layer,
      )
      continue
    }

    if (entity.type === "POLYLINE") {
      const vertices: SurveyVertex[] = []
      let nextIndex = index + 1

      while (nextIndex < entities.length && entities[nextIndex].type !== "SEQEND") {
        const vertex = entities[nextIndex]
        if (vertex.type === "VERTEX") {
          const easting = Number(entityValue(vertex, 10))
          const northing = Number(entityValue(vertex, 20))
          if (Number.isFinite(easting) && Number.isFinite(northing)) {
            vertices.push({
              easting,
              northing,
              elevation: entityNumber(vertex, 30),
            })
          }
        }
        nextIndex += 1
      }

      const closed = (entityNumber(entity, 70) & 1) === 1
      addPath(
        vertices,
        closed,
        featureId(entity, closed ? "POLYGON" : "POLYLINE", lines.length + polygons.length + 1),
        layer,
      )
      index = nextIndex
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
      unsupported.set(entity.type, (unsupported.get(entity.type) || 0) + 1)
    }
  }

  const featureCount = points.length + lines.length + polygons.length
  if (featureCount === 0) {
    throw new Error(
      `${fileName} has no readable POINT, INSERT, LINE, LWPOLYLINE or POLYLINE geometry.`,
    )
  }
  if (featureCount > maximumFeatures) {
    throw new Error(`${fileName} contains more than ${maximumFeatures.toLocaleString("en-NZ")} GIS features.`)
  }
  if (vertexCount > maximumVertices) {
    throw new Error(`${fileName} contains more than ${maximumVertices.toLocaleString("en-NZ")} line and polygon vertices.`)
  }

  const warnings: string[] = []
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
