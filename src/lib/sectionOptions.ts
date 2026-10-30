import type { LandXmlDocument, PlanPoint } from "./landxml"
import { metresPerLinearUnit } from "./mapCoordinates"
import type { Basemap } from "./mapCoordinates"
import type { SurveyPoint, SurveyPointLayer } from "./surveyPoints"

export const allSectionPointFiles = "__ALL_POINT_FILES__"
export type SectionLine = { start: PlanPoint; end: PlanPoint }
export type SectionSample = { distance: number; values: Array<number | null> }
export type SectionThickness = { minimum: number; maximum: number; average: number; sampleCount: number }
export type SectionSettings = {
  alignmentName: string
  topSurfaceName: string
  bottomSurfaceName: string
  referenceSurfaceName: string
  asbuiltLayerName?: string
  corridor: number
  line: SectionLine | null
  mapCrs?: string
  mapBasemap?: Basemap | "google"
  mapOpacity?: number
  sectionInterval?: number
  sectionHalfWidth?: number
  sectionStart?: number
  sectionEnd?: number
}

export function assertSectionSettings(value: Record<string, unknown>) {
  for (const key of ["alignmentName", "topSurfaceName", "bottomSurfaceName", "referenceSurfaceName"]) if (typeof value[key] !== "string") throw new Error("Invalid saved section selections.")
  for (const key of ["asbuiltLayerName", "mapCrs"]) if (value[key] !== undefined && typeof value[key] !== "string") throw new Error("Invalid saved section file or grid selection.")
  if (!Number.isFinite(value.corridor) || Number(value.corridor) <= 0) throw new Error("Invalid saved point search distance.")
  if (value.mapBasemap !== undefined && !["street", "aerial", "google", "none"].includes(String(value.mapBasemap))) throw new Error("Invalid saved section background.")
  if (value.mapOpacity !== undefined && (!Number.isFinite(value.mapOpacity) || Number(value.mapOpacity) < 0 || Number(value.mapOpacity) > 100)) throw new Error("Invalid saved map opacity.")
  for (const key of ["sectionInterval", "sectionHalfWidth", "sectionStart", "sectionEnd"]) if (value[key] !== undefined && (!Number.isFinite(value[key]) || (["sectionInterval", "sectionHalfWidth"].includes(key) && Number(value[key]) <= 0))) throw new Error("Invalid saved alignment section settings.")
  if (value.line !== null) {
    const line = value.line as SectionLine | undefined
    if (!line || ![line.start?.easting, line.start?.northing, line.end?.easting, line.end?.northing].every(Number.isFinite)) throw new Error("Invalid saved section endpoints.")
  }
}

export function initialSectionSettings(document: LandXmlDocument): SectionSettings {
  return {
    alignmentName: document.alignments[0]?.name ?? "",
    topSurfaceName: document.surfaces[0]?.name ?? "",
    bottomSurfaceName: "",
    referenceSurfaceName: document.surfaces[0]?.name ?? "",
    asbuiltLayerName: allSectionPointFiles,
    corridor: 1,
    line: null,
  }
}

export function reconcileSectionSettings(settings: SectionSettings, document: LandXmlDocument, layers: SurveyPointLayer[]): SectionSettings {
  const surfaces = document.surfaces.map((surface) => surface.name)
  const alignments = document.alignments.map((alignment) => alignment.name)
  const top = surfaces.includes(settings.topSurfaceName) ? settings.topSurfaceName : surfaces[0] ?? ""
  const selected = settings.asbuiltLayerName ?? allSectionPointFiles
  return {
    ...settings,
    alignmentName: settings.alignmentName && !alignments.includes(settings.alignmentName) ? alignments[0] ?? "" : settings.alignmentName,
    topSurfaceName: top,
    bottomSurfaceName: settings.bottomSurfaceName !== top && surfaces.includes(settings.bottomSurfaceName) ? settings.bottomSurfaceName : "",
    referenceSurfaceName: settings.referenceSurfaceName && !surfaces.includes(settings.referenceSurfaceName) ? top : settings.referenceSurfaceName,
    asbuiltLayerName: selected === allSectionPointFiles || layers.some((layer) => layer.name === selected) ? selected : "",
  }
}

export function sectionPointLayers(layers: SurveyPointLayer[], selected = allSectionPointFiles) {
  return selected === allSectionPointFiles ? layers : layers.filter((layer) => layer.name === selected)
}

export function sectionUnitLabel(unit: string) {
  const scale = metresPerLinearUnit(unit)
  return scale === 1 ? "m" : scale === 0.3048 ? "ft" : scale === 1200 / 3937 ? "US survey ft" : scale === 0.001 ? "mm" : scale === 0.01 ? "cm" : scale === 1000 ? "km" : scale === 0.0254 ? "in" : "file units"
}

export function calculateSectionThickness(samples: SectionSample[], topIndex: number, bottomIndex: number, scale: number | null): SectionThickness | null {
  if (topIndex < 0 || bottomIndex < 0 || topIndex === bottomIndex || scale === null || !Number.isFinite(scale) || scale <= 0) return null
  let minimum = Infinity, maximum = -Infinity, total = 0, sampleCount = 0
  for (const sample of samples) {
    const top = sample.values[topIndex], bottom = sample.values[bottomIndex]
    if (typeof top !== "number" || typeof bottom !== "number" || !Number.isFinite(top) || !Number.isFinite(bottom)) continue
    const value = (top - bottom) * scale * 1000
    minimum = Math.min(minimum, value); maximum = Math.max(maximum, value)
    total += value; sampleCount++
  }
  return sampleCount ? { minimum, maximum, average: total / sampleCount, sampleCount } : null
}

export function projectPointToSection(point: SurveyPoint, line: SectionLine, corridor: number) {
  const dx = line.end.easting - line.start.easting
  const dy = line.end.northing - line.start.northing
  const lengthSquared = dx * dx + dy * dy
  if (!lengthSquared || !Number.isFinite(corridor) || corridor < 0) return null
  const length = Math.sqrt(lengthSquared)
  const ratio = ((point.easting - line.start.easting) * dx + (point.northing - line.start.northing) * dy) / lengthSquared
  if (ratio < 0 || ratio > 1) return null
  const nearestEasting = line.start.easting + dx * ratio
  const nearestNorthing = line.start.northing + dy * ratio
  const offset = (dx * (point.northing - nearestNorthing) - dy * (point.easting - nearestEasting)) / length
  return Math.abs(offset) > corridor ? null : { distance: ratio * length, offset }
}
