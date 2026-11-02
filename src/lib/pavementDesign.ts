import type { LandXmlAlignment, LandXmlDocument, LandXmlSurface } from "./landxml"
import type { SurveyPoint } from "./surveyPoints"
import type { CheckStatus } from "./asBuiltConformance"
import { createTinSampler, maximumCheckPoints, statusColours } from "./asBuiltConformance"
import { createAlignmentProjector, formatChainage } from "./alignmentStationing"
import type { AlignmentStation } from "./alignmentStationing"
import type { SurveyGeometryLayer } from "./surveyGeometry"
import type { SurveyReport } from "./surveyReports"
import { metresPerLinearUnit } from "./mapCoordinates"
import { assertDocument, record } from "./projectWorkspace"

export type PavementDesignState = {
  alignmentDocument: LandXmlDocument | null
  fslDocument: LandXmlDocument | null
  alignmentName: string
  surfaceName: string
  lowerMm: number
  upperMm: number
  labelInterval: number
  datum: string
  confirmed: boolean
}
export const defaultPavementDesign: PavementDesignState = { alignmentDocument: null, fslDocument: null, alignmentName: "", surfaceName: "", lowerMm: -10, upperMm: 10, labelInterval: 10, datum: "", confirmed: false }

export function restorePavementDesign(value: unknown): PavementDesignState {
  if (value === undefined) return { ...defaultPavementDesign }
  const state = record(value)
  for (const key of ["alignmentDocument", "fslDocument"]) if (state[key] !== null) assertDocument(state[key])
  for (const key of ["alignmentName", "surfaceName", "datum"]) if (typeof state[key] !== "string") throw new Error("Invalid saved pavement design selections.")
  if (![state.lowerMm, state.upperMm, state.labelInterval].every(Number.isFinite) || Number(state.lowerMm) > Number(state.upperMm) || Number(state.labelInterval) <= 0 || typeof state.confirmed !== "boolean") throw new Error("Invalid saved pavement design tolerances.")
  return state as PavementDesignState
}

export function pavementDesignUnitError(doc: LandXmlDocument | null) {
  return doc && metresPerLinearUnit(doc.units) !== 1 ? `${doc.fileName} must declare metre units. Re-export it in the common metre survey grid before checking pavement levels.` : ""
}

export type PavementDesignRow = SurveyPoint & { designLevel: number | null; differenceMm: number | null; status: CheckStatus; chainage: number | null; offset: number | null; stationStatus: AlignmentStation["status"] | "NO_ALIGNMENT" }
export type PavementDesignResult = { rows: PavementDesignRow[]; rejectedFaces: number }
export type PavementDesignRequest = { points: SurveyPoint[]; surface: LandXmlSurface; alignment?: LandXmlAlignment; lowerMm: number; upperMm: number }

export function checkPavementDesign(request: PavementDesignRequest, progress?: (value: number) => void): PavementDesignResult {
  const { points, surface, alignment, lowerMm, upperMm } = request
  if (!points.length || points.length > maximumCheckPoints) throw new Error(`Load between 1 and ${maximumCheckPoints.toLocaleString()} asbuilt points.`)
  if (![lowerMm, upperMm].every(Number.isFinite) || lowerMm > upperMm) throw new Error("Enter finite tolerances with lower ≤ upper.")
  const sampler = createTinSampler(surface)
  const stationAt = alignment ? createAlignmentProjector(alignment) : null
  const rows = points.map((point, index): PavementDesignRow => {
    if (index % 500 === 0) progress?.(Math.round(index / points.length * 100))
    if (![point.easting, point.northing, point.elevation].every(Number.isFinite)) return { ...point, designLevel: null, differenceMm: null, status: "INVALID", chainage: null, offset: null, stationStatus: "NO_ALIGNMENT" }
    const sampled = sampler.find(point.easting, point.northing)
    const differenceMm = sampled.level === null ? null : (point.elevation - sampled.level) * 1000
    const status = differenceMm === null ? sampled.status : differenceMm < lowerMm - 1e-7 ? "LOW" : differenceMm > upperMm + 1e-7 ? "HIGH" : "PASS"
    const station = stationAt?.(point)
    return { ...point, designLevel: sampled.level, differenceMm, status, chainage: station?.chainage ?? null, offset: station?.offset ?? null, stationStatus: station?.status ?? "NO_ALIGNMENT" }
  })
  progress?.(100)
  return { rows, rejectedFaces: sampler.rejectedFaces }
}

export function pavementDesignMapGeometry(points: SurveyPoint[], result: PavementDesignResult | null): SurveyGeometryLayer {
  const rows = result?.rows ?? points
  const step = Math.max(1, Math.ceil(rows.length / 5000))
  const usedStatuses = new Set(result ? result.rows.map((row) => row.status) : ["ASBUILT"])
  const colours: Record<string, string> = { ...statusColours, ASBUILT: "#22d3ee" }
  return { name: "Asbuilt vs FSL", format: "CSV", warnings: [], lines: [], polygons: [], pointColours: Object.fromEntries([...usedStatuses].map((status) => [status, colours[status]])),
    points: rows.filter((_, index) => index % step === 0).map((point) => {
      const row = "status" in point ? point as PavementDesignRow : null
      const station = row?.chainage != null ? ` · CH ${formatChainage(row.chainage)} · ${Math.abs(row.offset!).toFixed(3)} m ${row.offset! < 0 ? "R" : "L"}` : ""
      const levels = row ? ` · FSL ${row.designLevel?.toFixed(3) ?? "unavailable"} · Δ ${row.differenceMm?.toFixed(1) ?? "—"} mm · ${row.status}` : ""
      return { ...point, id: `${point.id}${station}${levels}`, code: row?.status ?? "ASBUILT" }
    }) }
}

export function pavementDesignReport(result: PavementDesignResult, state: PavementDesignState, measuredName: string, crs: string, warnings: string[]): SurveyReport {
  const assessed = result.rows.filter((row) => row.differenceMm !== null)
  return { title: "Pavement FSL Conformance Report", project: measuredName, createdAt: new Date().toISOString(),
    metadata: [["Asbuilt file", measuredName], ["FSL file", state.fslDocument?.fileName ?? ""], ["FSL surface", state.surfaceName], ["Alignment file", state.alignmentDocument?.fileName ?? "None"], ["Alignment", state.alignmentName || "None"], ["Lower tolerance (mm)", state.lowerMm], ["Upper tolerance (mm)", state.upperMm], ["Common survey CRS", crs || "Common metre grid confirmed by user; CRS not specified"], ["Common vertical datum", state.datum.trim() || "Common vertical datum confirmed by user; name not specified"]],
    summary: [["Asbuilt points", result.rows.length], ["Assessed", assessed.length], ["PASS", assessed.filter((row) => row.status === "PASS").length], ["HIGH", assessed.filter((row) => row.status === "HIGH").length], ["LOW", assessed.filter((row) => row.status === "LOW").length], ["Unassessed", result.rows.length - assessed.length], ["Without chainage", result.rows.filter((row) => row.chainage === null).length]],
    columns: ["Point ID", "Easting", "Northing", "Chainage (m)", "Chainage label", "Offset (m, +L / -R)", "Asbuilt RL", "FSL RL", "Difference (mm)", "FSL status", "Chainage status", "Code"],
    rows: result.rows.map((row) => [row.id, row.easting, row.northing, row.chainage, row.chainage === null ? null : formatChainage(row.chainage), row.offset, row.elevation, row.designLevel, row.differenceMm, row.status, row.stationStatus, row.code]),
    notes: ["FSL RL is interpolated from the selected TIN at each asbuilt point's original Easting/Northing. Difference = asbuilt RL − FSL RL; positive is high. No datum or coordinate conversion is applied.", "Offsets are positive left and negative right in the direction of increasing chainage. No chainage is extrapolated beyond the alignment endpoints. FSL assessment remains independent of alignment coverage.", "Outside, missing, ambiguous and invalid design levels are unassessed. Background imagery is for location context and is not included in this report.", ...(result.rejectedFaces ? [`Ignored ${result.rejectedFaces} invalid or degenerate TIN faces.`] : []), ...warnings],
    plot: { points: result.rows.filter((row) => Number.isFinite(row.easting) && Number.isFinite(row.northing)).map((row) => ({ easting: row.easting, northing: row.northing, colour: statusColours[row.status] })), legend: Object.fromEntries([...new Set(result.rows.map((row) => row.status))].map((status) => [status, statusColours[status]])) } }
}
