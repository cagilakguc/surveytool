import type { LandXmlDocument, LandXmlSurface } from "./landxml"
import type { SurveyPoint } from "./surveyPoints"
import { createTinSampler, maximumCheckPoints } from "./asBuiltConformance"
import type { CheckStatus } from "./asBuiltConformance"
import { assertDocument, record } from "./projectWorkspace"
import { metresPerLinearUnit } from "./mapCoordinates"
import { restoreThicknessRule, thicknessPasses } from "./pavementThickness"
import type { ThicknessRule } from "./pavementThickness"

export type PavementBottomState = { mode: "points" | "surface"; document: LandXmlDocument | null; surfaceName: string }
export const defaultPavementBottom: PavementBottomState = { mode: "points", document: null, surfaceName: "" }
export function restorePavementBottom(value: unknown): PavementBottomState {
  if (value === undefined) return { ...defaultPavementBottom }
  const state = record(value)
  if (!["points", "surface"].includes(String(state.mode)) || typeof state.surfaceName !== "string") throw new Error("Invalid saved bottom layer selection.")
  if (state.document !== null) {
    assertDocument(state.document)
    if (!Array.isArray(state.document.warnings) || state.document.warnings.some((item) => typeof item !== "string")) throw new Error("Invalid saved bottom surface notes.")
    if (state.surfaceName && !state.document.surfaces.some((surface) => surface.name === state.surfaceName)) throw new Error("The saved bottom surface could not be found.")
  }
  return state as PavementBottomState
}

export type SurfaceThicknessRow = {
  id: string; easting: number; northing: number; topElevation: number; bottomElevation: number; bottomEasting: number; bottomNorthing: number;
  thicknessMm: number; deviationMm: number; status: "pass" | "fail"; matchMethod: "point-id" | "coordinate" | "bottom-tin"; horizontalDifference: number; code: string
}
export type UnassessedThicknessPoint = { id: string; easting: number; northing: number; topElevation: number; code: string; reason: CheckStatus }
export type SurfaceThicknessResult = { results: SurfaceThicknessRow[]; unassessed: UnassessedThicknessPoint[]; unmatchedBottom: number; unmatchedTop: number; rejectedFaces: number }
export type SurfaceThicknessRequest = { surface: LandXmlSurface; units: string; points: SurveyPoint[]; targetMm: number; toleranceMm: number; rule?: ThicknessRule }

export function checkBottomSurfaceThickness(request: SurfaceThicknessRequest, progress?: (percent: number) => void): SurfaceThicknessResult {
  if (metresPerLinearUnit(request.units) !== 1) throw new Error("The bottom LandXML must declare metre units and use the same grid and vertical datum as the top survey. Re-export the surface in metres before checking thickness.")
  if (!request.points.length || request.points.length > maximumCheckPoints) throw new Error(`Load between 1 and ${maximumCheckPoints.toLocaleString()} top/asbuilt points.`)
  if (![request.targetMm, request.toleranceMm].every(Number.isFinite) || request.targetMm < 0 || request.toleranceMm < 0) throw new Error("Choose non-negative target thickness and tolerance values.")
  const rule = restoreThicknessRule(request.rule)
  const sampler = createTinSampler(request.surface)
  const results: SurfaceThicknessRow[] = [], unassessed: UnassessedThicknessPoint[] = []
  request.points.forEach((point, index) => {
    if (index % 500 === 0) progress?.(Math.round(index / request.points.length * 100))
    const valid = [point.easting, point.northing, point.elevation].every(Number.isFinite)
    const found = valid ? sampler.find(point.easting, point.northing) : { level: null, status: "INVALID" as const }
    if (found.level === null) {
      unassessed.push({ id: point.id, easting: point.easting, northing: point.northing, topElevation: point.elevation, code: point.code, reason: found.status })
      return
    }
    const thicknessMm = (point.elevation - found.level) * 1000, deviationMm = thicknessMm - request.targetMm
    results.push({ id: point.id, easting: point.easting, northing: point.northing, topElevation: point.elevation, bottomElevation: found.level, bottomEasting: point.easting, bottomNorthing: point.northing, thicknessMm, deviationMm, status: thicknessPasses(deviationMm, request.toleranceMm, rule) ? "pass" : "fail", matchMethod: "bottom-tin", horizontalDifference: 0, code: point.code })
  })
  progress?.(100)
  return { results, unassessed, unmatchedTop: unassessed.length, unmatchedBottom: 0, rejectedFaces: sampler.rejectedFaces }
}
