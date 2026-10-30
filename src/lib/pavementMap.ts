import { crsUnitScale, isGeographicCrs } from "./mapCoordinates"
import type { MapCrs } from "./mapCoordinates"
import type { SurveyGeometryLayer } from "./surveyGeometry"

type PavementMapPoint = {
  id: string
  easting: number
  northing: number
  topElevation: number
  thicknessMm: number
  deviationMm: number
  status: "pass" | "fail"
}

export function pavementMapKey(bottomName?: string, topName?: string) {
  return `pavement:${JSON.stringify([bottomName ?? "", topName ?? ""])}`
}

export function pavementMapCoordinateError(crs: MapCrs) {
  return isGeographicCrs(crs) || crsUnitScale(crs) !== 1
    ? "Pavement point matching expects a projected grid in metres, with heights in metres. Choose the actual metre-based survey CRS; this selector does not convert the input files. The source-grid plan and results remain available."
    : ""
}

export function buildPavementMapGeometry(results: readonly PavementMapPoint[]): SurveyGeometryLayer {
  const step = Math.max(1, Math.ceil(results.length / 5000))
  return {
    name: "Pavement thickness conformance",
    format: "CSV",
    warnings: [],
    lines: [],
    polygons: [],
    pointColours: { PASS: "#34d399", FAIL: "#fb7185" },
    points: results.filter((_, index) => index % step === 0).map((point) => ({
      id: `${point.id} · ${point.thicknessMm.toFixed(1)} mm · deviation ${point.deviationMm >= 0 ? "+" : ""}${point.deviationMm.toFixed(1)} mm`,
      easting: point.easting,
      northing: point.northing,
      elevation: point.topElevation,
      code: point.status === "pass" ? "PASS" : "FAIL",
    })),
  }
}
