import { crsUnitScale, isGeographicCrs } from "./mapCoordinates"
import type { MapCrs } from "./mapCoordinates"
import type { SurveyGeometryLayer } from "./surveyGeometry"
import { assertGeometryLayer, record } from "./projectWorkspace"
import type { SectionLine } from "./sectionOptions"
import type { UnassessedThicknessPoint } from "./pavementBottomSurface"
import { thicknessPasses } from "./pavementThickness"
import type { ThicknessRule } from "./pavementThickness"

export type PavementMapPoint = {
  id: string
  easting: number
  northing: number
  topElevation: number
  thicknessMm: number
  deviationMm: number
  status: "pass" | "fail"
  bottomElevation?: number
  bottomEasting?: number
  bottomNorthing?: number
  code?: string
}

export const pavementThicknessColours = { "TOO THIN": "#ef4444", "WITHIN TOLERANCE": "#38bdf8", "TOO THICK": "#f59e0b", "MEETS MINIMUM": "#38bdf8" }
export function thicknessLegend(rule: ThicknessRule = "target-tolerance"): Record<string, string> {
  return rule === "minimum" ? { "TOO THIN": pavementThicknessColours["TOO THIN"], "MEETS MINIMUM": pavementThicknessColours["MEETS MINIMUM"] } : { "TOO THIN": pavementThicknessColours["TOO THIN"], "WITHIN TOLERANCE": pavementThicknessColours["WITHIN TOLERANCE"], "TOO THICK": pavementThicknessColours["TOO THICK"] }
}
export type ThicknessFilter = "all" | "below" | "at-above" | "outside" | "unassessed"
export type PavementWorkspaceState = { overlays: SurveyGeometryLayer[]; hiddenLayers: string[]; filter: ThicknessFilter; cutoffMm: number | null; showLabels: boolean; corridor: number; sectionLine: SectionLine | null }
export const defaultPavementWorkspace: PavementWorkspaceState = { overlays: [], hiddenLayers: [], filter: "all", cutoffMm: null, showLabels: true, corridor: 0.3, sectionLine: null }

export function restorePavementWorkspace(value: unknown): PavementWorkspaceState {
  if (value === undefined) return { ...defaultPavementWorkspace, overlays: [], hiddenLayers: [] }
  const data = record(value)
  if (!Array.isArray(data.overlays) || data.overlays.length > 20) throw new Error("Invalid saved DXF layers.")
  data.overlays.forEach(assertGeometryLayer)
  if (!Array.isArray(data.hiddenLayers) || data.hiddenLayers.some((name) => typeof name !== "string") || !["all", "below", "at-above", "outside", "unassessed"].includes(String(data.filter)) || typeof data.showLabels !== "boolean" || !(Number(data.corridor) > 0) || !Number.isFinite(data.corridor) || (data.cutoffMm !== null && (!Number.isFinite(data.cutoffMm) || Number(data.cutoffMm) < 0))) throw new Error("Invalid saved pavement map settings.")
  if (data.sectionLine !== null) {
    const line = data.sectionLine as SectionLine
    if (![line?.start?.easting, line?.start?.northing, line?.end?.easting, line?.end?.northing].every(Number.isFinite)) throw new Error("Invalid saved pavement section line.")
  }
  return data as PavementWorkspaceState
}

export function thicknessClass(point: Pick<PavementMapPoint, "deviationMm">, toleranceMm: number, rule: ThicknessRule = "target-tolerance"): keyof typeof pavementThicknessColours {
  if (rule === "minimum") return thicknessPasses(point.deviationMm, toleranceMm, rule) ? "MEETS MINIMUM" : "TOO THIN"
  return point.deviationMm < -toleranceMm - 1e-7 ? "TOO THIN" : point.deviationMm > toleranceMm + 1e-7 ? "TOO THICK" : "WITHIN TOLERANCE"
}
export function filterThicknessPoints<T extends PavementMapPoint>(points: readonly T[], filter: ThicknessFilter, cutoffMm: number, toleranceMm: number, rule: ThicknessRule = "target-tolerance"): T[] {
  return points.filter((point) => filter !== "unassessed" && (filter === "all" || (filter === "below" ? point.thicknessMm < cutoffMm - 1e-7 : filter === "at-above" ? point.thicknessMm >= cutoffMm - 1e-7 : !thicknessPasses(point.deviationMm, toleranceMm, rule))))
}
export function thicknessFilterLabel(filter: ThicknessFilter, cutoffMm: number, rule: ThicknessRule = "target-tolerance") {
  return filter === "all" ? "All matched points" : filter === "below" ? `Thickness below ${cutoffMm} mm` : filter === "at-above" ? `Thickness at / above ${cutoffMm} mm` : filter === "unassessed" ? "Unassessed points" : rule === "minimum" ? "Below required minimum thickness" : "Outside thickness tolerance"
}

const overlayColours = ["#a78bfa", "#facc15", "#2dd4bf", "#fb923c", "#f472b6", "#60a5fa"]
export function pavementDxfGroups(overlays: SurveyGeometryLayer[]) {
  const groups = new Map<string, { key: string; label: string; colour: string }>()
  for (const layer of overlays) for (const feature of [...layer.points, ...layer.lines, ...layer.polygons]) {
    const label = `${layer.name} · ${feature.code || "0"}`
    if (!groups.has(label)) groups.set(label, { key: `DXF ${label}`, label, colour: overlayColours[groups.size % overlayColours.length] })
  }
  return [...groups.values()]
}
export function withPavementDxf(geometry: SurveyGeometryLayer, overlays: SurveyGeometryLayer[], hiddenLayers: string[]): SurveyGeometryLayer {
  const groups = pavementDxfGroups(overlays), hidden = new Set(hiddenLayers)
  const colours = Object.fromEntries(groups.filter((g) => !hidden.has(g.key)).map((g) => [g.key, g.colour]))
  const key = (name: string, code: string) => `DXF ${name} · ${code || "0"}`
  return { ...geometry, groupGeometryByCode: true, pointColours: { ...geometry.pointColours, ...colours },
    points: [...geometry.points, ...overlays.flatMap((layer) => layer.points.filter((p) => !hidden.has(key(layer.name, p.code))).map((p) => ({ ...p, code: key(layer.name, p.code) })))],
    lines: [...geometry.lines, ...overlays.flatMap((layer) => layer.lines.filter((p) => !hidden.has(key(layer.name, p.code))).map((p) => ({ ...p, code: key(layer.name, p.code) })))],
    polygons: [...geometry.polygons, ...overlays.flatMap((layer) => layer.polygons.filter((p) => !hidden.has(key(layer.name, p.code))).map((p) => ({ ...p, code: key(layer.name, p.code) })))],
  }
}

export function pavementReportLines(geometry: SurveyGeometryLayer) {
  return [...geometry.lines.map((line) => ({ points: line.vertices, colour: geometry.pointColours?.[line.code] ?? "#a78bfa" })), ...geometry.polygons.flatMap((polygon) => polygon.rings.map((ring) => ({ points: ring, colour: geometry.pointColours?.[polygon.code] ?? "#a78bfa" }))) ]
}

export function pavementMapKey(bottomName?: string, topName?: string) {
  return `pavement:${JSON.stringify([bottomName ?? "", topName ?? ""])}`
}

export function pavementMapCoordinateError(crs: MapCrs) {
  return isGeographicCrs(crs) || crsUnitScale(crs) !== 1
    ? "Pavement point matching expects a projected grid in metres, with heights in metres. Choose the actual metre-based survey CRS; this selector does not convert the input files. The source-grid plan and results remain available."
    : ""
}

export function buildPavementMapGeometry(results: readonly PavementMapPoint[], toleranceMm = 20, unassessed: readonly UnassessedThicknessPoint[] = [], rule: ThicknessRule = "target-tolerance"): SurveyGeometryLayer {
  const assessedBudget = unassessed.length ? 4000 : 5000
  const step = Math.max(1, Math.ceil(results.length / assessedBudget))
  return {
    name: "Pavement thickness conformance",
    format: "CSV",
    warnings: [],
    lines: [],
    polygons: [],
    pointColours: { ...thicknessLegend(rule), ...(unassessed.length ? { UNASSESSED: "#94a3b8" } : {}) },
    points: [...results.filter((_, index) => index % step === 0).map((point) => ({
      id: `${point.id} · ${point.thicknessMm.toFixed(1)} mm · deviation ${point.deviationMm >= 0 ? "+" : ""}${point.deviationMm.toFixed(1)} mm`,
      easting: point.easting,
      northing: point.northing,
      elevation: point.topElevation,
      code: thicknessClass(point, toleranceMm, rule),
      label: point.thicknessMm.toFixed(0),
      radius: !thicknessPasses(point.deviationMm, toleranceMm, rule) && point.deviationMm < 0 ? 6 + Math.min(4, Math.floor((-point.deviationMm - (rule === "minimum" ? 0 : toleranceMm)) / 25)) : 5,
    })), ...unassessed.filter((point, index) => index % Math.max(1, Math.ceil(unassessed.length / 1000)) === 0 && Number.isFinite(point.easting) && Number.isFinite(point.northing)).map((point) => ({ id: `${point.id} · bottom TIN ${point.reason} · thickness unassessed`, easting: point.easting, northing: point.northing, elevation: point.topElevation, code: "UNASSESSED", label: "—", radius: 5 }))],
  }
}
