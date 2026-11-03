export type ThicknessRule = "minimum" | "target-tolerance"

// Preserve the acceptance rule used by projects saved before minimum-only checks were added.
export function restoreThicknessRule(value: unknown): ThicknessRule {
  if (value === undefined) return "target-tolerance"
  if (value !== "minimum" && value !== "target-tolerance") throw new Error("Invalid saved thickness acceptance rule.")
  return value
}

export function thicknessPasses(deviationMm: number, toleranceMm: number, rule: ThicknessRule = "target-tolerance") {
  return Number.isFinite(deviationMm) && (rule === "minimum" ? deviationMm >= -1e-7 : Math.abs(deviationMm) <= toleranceMm + 1e-7)
}

export function thicknessAcceptanceLabel(targetMm: number, toleranceMm: number, rule: ThicknessRule) {
  return rule === "minimum" ? `Minimum ${targetMm} mm · no upper limit` : `Target ${targetMm} mm ± ${toleranceMm} mm`
}

export function thicknessCriteriaMetadata(targetMm: number, toleranceMm: number, rule: ThicknessRule): Array<[string, string | number]> {
  return rule === "minimum"
    ? [["Thickness acceptance", "Minimum only"], ["Minimum thickness (mm)", targetMm], ["Upper thickness limit", "None"], ["Thickness pass rule", `Thickness ≥ ${targetMm} mm`]]
    : [["Thickness acceptance", "Target ± tolerance"], ["Target thickness (mm)", targetMm], ["Thickness tolerance ± (mm)", toleranceMm]]
}

export const thicknessColourNote = (rule: ThicknessRule) => rule === "minimum"
  ? "Blue: at or above the minimum thickness. Red: below minimum. Grey: unassessed. No upper thickness limit is applied."
  : "Blue: within target ± tolerance. Red: too thin. Amber: too thick. Grey: unassessed."
