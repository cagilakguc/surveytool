import type { SurveyPoint } from "./surveyPoints"
import type { LandXmlDocument, PlanPoint } from "./landxml"
import type { SectionLine } from "./sectionOptions"
import { projectPointToSection } from "./sectionOptions"
import { createAlignmentProjector } from "./alignmentStationing"
import { createTinSampler } from "./asBuiltConformance"
import { pavementDesignUnitError } from "./pavementDesign"
import { tinBoundarySectionFractions } from "./tinBoundaries"
import type { ThicknessRule } from "./pavementThickness"

export type PavementMeasurement = SurveyPoint & { colour: string; status: string; thicknessMm?: number; deviationMm?: number; bottom?: PlanPoint; designLevel?: number | null; differenceMm?: number | null }
export type PavementSectionCriteria = { targetMm?: number; toleranceMm?: number; thicknessRule?: ThicknessRule; lowerMm?: number; upperMm?: number }
export type PavementSectionRequest = { line: SectionLine; corridor: number; points: PavementMeasurement[]; document?: LandXmlDocument; bottomDocument?: LandXmlDocument; alignmentName?: string; mode: "thickness" | "level"; scope: string; crs: string; datum: string; criteria?: PavementSectionCriteria }
export type PavementSectionPoint = PavementMeasurement & { distance: number; offLine: number; chainage: number | null; bottomDistance: number | null; fslLevel: number | null; fslDifferenceMm: number | null }
export type PavementSectionResult = { length: number; points: PavementSectionPoint[]; samples: Array<{ distance: number; level: number | null; bottomLevel?: number | null; chainage: number | null }>; startChainage: number | null; endChainage: number | null }

export function analysePavementSection(request: PavementSectionRequest): PavementSectionResult {
  const { line, corridor, document } = request
  if (![line.start.easting, line.start.northing, line.end.easting, line.end.northing, corridor].every(Number.isFinite) || corridor <= 0) throw new Error("Choose finite section coordinates and a positive point search distance.")
  const length = Math.hypot(line.end.easting - line.start.easting, line.end.northing - line.start.northing)
  if (length < .05) throw new Error("Draw a section at least 0.05 m long.")
  const unitError = pavementDesignUnitError(document ?? null) || pavementDesignUnitError(request.bottomDocument ?? null)
  if (unitError) throw new Error(unitError)
  const alignment = document?.alignments.find((item) => item.name === request.alignmentName)
  const station = alignment ? createAlignmentProjector(alignment) : null
  const surface = document?.surfaces[0]
  const sampler = surface ? createTinSampler(surface) : null
  const bottomSurface = request.bottomDocument?.surfaces[0]
  const bottomSampler = bottomSurface ? createTinSampler(bottomSurface) : null
  const points: PavementSectionPoint[] = []
  for (const point of request.points) {
    const projected = projectPointToSection(point, line, corridor)
    if (!projected) continue
    const fslLevel = sampler?.find(point.easting, point.northing).level ?? null
    const bottom = point.bottom ? projectPointToSection({ ...point, ...point.bottom, elevation: point.bottom.elevation ?? point.elevation }, line, corridor) : null
    points.push({ ...point, distance: projected.distance, offLine: projected.offset, chainage: station?.(point).chainage ?? null, bottomDistance: bottom?.distance ?? null, fslLevel, fslDifferenceMm: fslLevel === null ? null : (point.elevation - fslLevel) * 1000 })
  }
  points.sort((a, b) => a.distance - b.distance)
  const fractions = [...new Set([...Array.from({ length: 161 }, (_, index) => index / 160), ...tinBoundarySectionFractions(surface, line.start, line.end), ...tinBoundarySectionFractions(bottomSurface, line.start, line.end)])].sort((a, b) => a - b)
  const samples = fractions.map((t) => {
    const p = { easting: line.start.easting + (line.end.easting - line.start.easting) * t, northing: line.start.northing + (line.end.northing - line.start.northing) * t }
    return { distance: length * t, level: sampler?.find(p.easting, p.northing).level ?? null, bottomLevel: bottomSampler?.find(p.easting, p.northing).level ?? null, chainage: station?.(p).chainage ?? null }
  })
  return { length, points, samples, startChainage: station?.(line.start).chainage ?? null, endChainage: station?.(line.end).chainage ?? null }
}

export function pavementSectionPlot(result: PavementSectionResult) {
  let minimum = Infinity, maximum = -Infinity
  const include = (value: number | null | undefined) => { if (value != null && Number.isFinite(value)) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value) } }
  result.samples.forEach((sample) => { include(sample.level); include(sample.bottomLevel) })
  result.points.forEach((point) => { include(point.elevation); if (point.bottomDistance !== null) include(point.bottom?.elevation) })
  if (!Number.isFinite(minimum)) { minimum = 0; maximum = 1 }
  const padding = Math.max(.05, (maximum - minimum) * .15)
  return { minimum: minimum - padding, maximum: maximum + padding, x: (distance: number) => 85 + distance / result.length * 840, y: (level: number) => 390 - (level - minimum + padding) / (maximum - minimum + padding * 2) * 330 }
}

export function pavementSectionTicks(result: PavementSectionResult) {
  return Array.from({ length: 6 }, (_, index) => {
    const distance = result.length * index / 5
    const sample = result.samples.find((item) => Math.abs(item.distance - distance) <= Math.max(1e-8, result.length * 1e-12))
    return { distance, chainage: sample?.chainage ?? null }
  })
}
