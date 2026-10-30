import type { LandXmlAlignment, LandXmlDocument, LandXmlSurface, PlanPoint } from "./landxml"
import type { SurveyPoint, SurveyPointLayer } from "./surveyPoints"
import { metresPerLinearUnit } from "./mapCoordinates"
import { projectPointToSection } from "./sectionOptions"
import type { SectionLine, SectionSample } from "./sectionOptions"

type SurfaceTriangle = {
  a: PlanPoint
  b: PlanPoint
  c: PlanPoint
  minEasting: number
  maxEasting: number
  minNorthing: number
  maxNorthing: number
}
export type StationResult = {
  chainage: number
  offset: number
  distance: number
  sectionDistance: number | null
}

export type SectionSurveyPoint = SurveyPoint & {
  layerName: string
  layerIndex: number
  distance: number
  offset: number
  referenceLevel: number | null
  differenceMm: number | null
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function interpolateTriangle(triangle: SurfaceTriangle, easting: number, northing: number): number | null | undefined {
  const { a, b, c } = triangle
  const denominator =
    (b.northing - c.northing) * (a.easting - c.easting) +
    (c.easting - b.easting) * (a.northing - c.northing)
  if (Math.abs(denominator) < 1e-12) return undefined

  const weightA =
    ((b.northing - c.northing) * (easting - c.easting) +
      (c.easting - b.easting) * (northing - c.northing)) /
    denominator
  const weightB =
    ((c.northing - a.northing) * (easting - c.easting) +
      (a.easting - c.easting) * (northing - c.northing)) /
    denominator
  const weightC = 1 - weightA - weightB
  if (weightA < -0.000001 || weightB < -0.000001 || weightC < -0.000001) return undefined
  if (a.elevation === null || b.elevation === null || c.elevation === null) return null
  return weightA * a.elevation + weightB * b.elevation + weightC * c.elevation
}

function createSurfaceIndex(surface: LandXmlSurface) {
  const triangles: SurfaceTriangle[] = []
  let minEasting = Number.POSITIVE_INFINITY
  let maxEasting = Number.NEGATIVE_INFINITY
  let minNorthing = Number.POSITIVE_INFINITY
  let maxNorthing = Number.NEGATIVE_INFINITY

  surface.faces.forEach((face) => {
    const a = surface.points[face[0]]
    const b = surface.points[face[1]]
    const c = surface.points[face[2]]
    if (!a || !b || !c) return

    const triangle = {
      a,
      b,
      c,
      minEasting: Math.min(a.easting, b.easting, c.easting),
      maxEasting: Math.max(a.easting, b.easting, c.easting),
      minNorthing: Math.min(a.northing, b.northing, c.northing),
      maxNorthing: Math.max(a.northing, b.northing, c.northing),
    }
    minEasting = Math.min(minEasting, triangle.minEasting)
    maxEasting = Math.max(maxEasting, triangle.maxEasting)
    minNorthing = Math.min(minNorthing, triangle.minNorthing)
    maxNorthing = Math.max(maxNorthing, triangle.maxNorthing)
    triangles.push(triangle)
  })

  if (!triangles.length) return { find: () => null as number | null }

  const dimension = clamp(Math.ceil(Math.sqrt(triangles.length / 6)), 8, 120)
  const cellWidth = Math.max((maxEasting - minEasting) / dimension, 0.000001)
  const cellHeight = Math.max((maxNorthing - minNorthing) / dimension, 0.000001)
  const cells = new Map<string, SurfaceTriangle[]>()

  function cellIndex(value: number, minimum: number, size: number) {
    return clamp(Math.floor((value - minimum) / size), 0, dimension - 1)
  }

  triangles.forEach((triangle) => {
    const startX = cellIndex(triangle.minEasting, minEasting, cellWidth)
    const endX = cellIndex(triangle.maxEasting, minEasting, cellWidth)
    const startY = cellIndex(triangle.minNorthing, minNorthing, cellHeight)
    const endY = cellIndex(triangle.maxNorthing, minNorthing, cellHeight)

    for (let x = startX; x <= endX; x += 1) {
      for (let y = startY; y <= endY; y += 1) {
        const key = `${x}:${y}`
        const existing = cells.get(key)
        if (existing) existing.push(triangle)
        else cells.set(key, [triangle])
      }
    }
  })

  return {
    find(easting: number, northing: number) {
      if (easting < minEasting || easting > maxEasting || northing < minNorthing || northing > maxNorthing) return null
      const candidates = cells.get(`${cellIndex(easting, minEasting, cellWidth)}:${cellIndex(northing, minNorthing, cellHeight)}`) ?? []
      for (const triangle of candidates) {
        const value = interpolateTriangle(triangle, easting, northing)
        if (value !== undefined) return value
      }
      return null
    },
  }
}

function stationAt(alignment: LandXmlAlignment | undefined, point: PlanPoint): StationResult | null {
  if (!alignment || alignment.points.length < 2) return null
  let travelled = 0
  let best: StationResult | null = null

  for (let index = 1; index < alignment.points.length; index += 1) {
    const a = alignment.points[index - 1]
    const b = alignment.points[index]
    const dx = b.easting - a.easting
    const dy = b.northing - a.northing
    const lengthSquared = dx * dx + dy * dy
    if (!lengthSquared) continue
    const t = clamp(((point.easting - a.easting) * dx + (point.northing - a.northing) * dy) / lengthSquared, 0, 1)
    const easting = a.easting + dx * t
    const northing = a.northing + dy * t
    const distance = Math.hypot(point.easting - easting, point.northing - northing)
    const cross = dx * (point.northing - northing) - dy * (point.easting - easting)
    const segmentLength = Math.sqrt(lengthSquared)
    if (!best || distance < best.distance) {
      best = {
        distance,
        chainage: alignment.pointChainages ? alignment.pointChainages[index - 1] + (alignment.pointChainages[index] - alignment.pointChainages[index - 1]) * t : (alignment.startStation ?? 0) + travelled + segmentLength * t,
        offset: Math.sign(cross || 1) * distance,
        sectionDistance: null,
      }
    }
    travelled += segmentLength
  }
  return best
}

function cross2d(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx
}

function stationForSection(alignment: LandXmlAlignment | undefined, line: SectionLine): StationResult | null {
  if (!alignment || alignment.points.length < 2) return null
  const sectionX = line.end.easting - line.start.easting
  const sectionY = line.end.northing - line.start.northing
  const sectionLength = Math.hypot(sectionX, sectionY)
  let travelled = 0

  for (let index = 1; index < alignment.points.length; index += 1) {
    const a = alignment.points[index - 1]
    const b = alignment.points[index]
    const alignmentX = b.easting - a.easting
    const alignmentY = b.northing - a.northing
    const denominator = cross2d(alignmentX, alignmentY, sectionX, sectionY)
    const segmentLength = Math.hypot(alignmentX, alignmentY)

    if (Math.abs(denominator) > 1e-9) {
      const deltaX = line.start.easting - a.easting
      const deltaY = line.start.northing - a.northing
      const alignmentRatio = cross2d(deltaX, deltaY, sectionX, sectionY) / denominator
      const sectionRatio = cross2d(deltaX, deltaY, alignmentX, alignmentY) / denominator
      if (alignmentRatio >= -0.000001 && alignmentRatio <= 1.000001 && sectionRatio >= -0.000001 && sectionRatio <= 1.000001) {
        return {
          chainage: alignment.pointChainages ? alignment.pointChainages[index - 1] + (alignment.pointChainages[index] - alignment.pointChainages[index - 1]) * alignmentRatio : (alignment.startStation ?? 0) + travelled + segmentLength * alignmentRatio,
          offset: 0,
          distance: 0,
          sectionDistance: sectionLength * sectionRatio,
        }
      }
    }
    travelled += segmentLength
  }

  const midpoint = {
    easting: (line.start.easting + line.end.easting) / 2,
    northing: (line.start.northing + line.end.northing) / 2,
    elevation: null,
  }
  const fallback = stationAt(alignment, midpoint)
  return fallback ? { ...fallback, sectionDistance: null } : null
}

export type SectionAnalysis = {
  line: SectionLine
  length: number
  samples: SectionSample[]
  station: StationResult | null
  sectionPoints: SectionSurveyPoint[]
}

export function createSectionAnalysis(document: LandXmlDocument, layers: SurveyPointLayer[], referenceSurfaceName: string) {
  const indexes = document.surfaces.map(createSurfaceIndex)
  const referenceIndex = document.surfaces.findIndex((surface) => surface.name === referenceSurfaceName)
  const scale = metresPerLinearUnit(document.units)
  return (line: SectionLine, corridor: number, alignment?: LandXmlAlignment): SectionAnalysis => {
    const length = Math.hypot(line.end.easting - line.start.easting, line.end.northing - line.start.northing)
    const samples: SectionSample[] = Array.from({ length: 161 }, (_, index) => {
      const ratio = index / 160
      const e = line.start.easting + (line.end.easting - line.start.easting) * ratio
      const n = line.start.northing + (line.end.northing - line.start.northing) * ratio
      return { distance: length * ratio, values: indexes.map((surface) => surface.find(e, n)) }
    })
    const sectionPoints: SectionSurveyPoint[] = []
    layers.forEach((layer, layerIndex) => layer.points.forEach((point) => {
      const projected = projectPointToSection(point, line, corridor)
      if (!projected) return
      const referenceLevel = referenceIndex >= 0 ? indexes[referenceIndex].find(point.easting, point.northing) : null
      sectionPoints.push({ ...point, layerName: layer.name, layerIndex, ...projected, referenceLevel,
        differenceMm: referenceLevel === null || scale === null ? null : (point.elevation - referenceLevel) * scale * 1000 })
    }))
    sectionPoints.sort((a, b) => a.distance - b.distance)
    return { line, length, samples, station: stationForSection(alignment, line), sectionPoints }
  }
}
