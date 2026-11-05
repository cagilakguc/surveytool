import { displayObservation, displayResidual, residualUnits } from "./networkAdjustment"
import type { NetworkInput, NetworkResult } from "./networkAdjustment"
import { networkCsv } from "./networkInput"
import type { NetworkSettings } from "./networkInput"
import { reportFont } from "./surveyReports"

export function networkPointRows(input: NetworkInput, result: NetworkResult) {
  const header = input.mode === "level" ? ["Point", "Easting (not adjusted)", "Northing (not adjusted)", "Adjusted RL (m)", "Fixed", "RL correction (mm)", "A priori sigma RL (mm)", "Height datum"] : ["Point", "Adjusted Easting (m)", "Adjusted Northing (m)", "Source RL (not adjusted)", "Fixed", "E correction (mm)", "N correction (mm)", "A priori sigma E (mm)", "A priori sigma N (mm)", "95% ellipse major (mm)", "95% ellipse minor (mm)", "Ellipse bearing (deg from N)", "Grid"]
  return [header, ...result.points.map(p => input.mode === "level" ? [p.id, p.easting, p.northing, p.height, p.fixed ? "fixed" : "free", p.deltaH === null ? null : p.deltaH * 1000, p.sigmaH! * 1000, input.datum] : [p.id, p.easting, p.northing, p.height, p.fixed ? "fixed" : "free", p.deltaE! * 1000, p.deltaN! * 1000, p.sigmaE! * 1000, p.sigmaN! * 1000, p.ellipseMajor95! * 1000, p.ellipseMinor95! * 1000, p.ellipseBearing, input.grid])]
}
export function networkResidualRows(result: NetworkResult) {
  return [["ID", "Type", "From", "To", "Back", "Set", "Included", "Observed (m or deg)", "Adjusted (m or deg)", "Prefit observed-computed", "Residual adjusted-observed", "1-sigma", "Residual/sigma units", "Redundancy", "Standardized residual", "Check", "Weight source"], ...result.residuals.map(r => [r.id, r.type, r.from, r.to, r.back, r.set, r.enabled, displayObservation(r.value, r.type), r.computed === null ? null : displayObservation(r.computed, r.type), r.prefit === null ? null : displayResidual(r.prefit, r.type), r.residual === null ? null : displayResidual(r.residual, r.type), displayResidual(r.sigma, r.type), residualUnits(r), r.redundancy, r.standardized, r.flag, r.weightSource])]
}
export function networkCovarianceCsv(result: NetworkResult) {
  const labels = result.parameters.map(s => s + (s.includes(":orientation:") ? " (rad)" : " (m)"))
  return networkCsv([["A priori covariance; entry units are row-unit × column-unit", ...labels], ...labels.map((label, i) => [label, ...result.covariance[i]])])
}
export const networkReportNotes = [
  "Weighted least squares with independent observations and exact fixed control. No observations are automatically removed or reweighted.",
  "Distances and angles must already be reduced to the stated plane/grid. Levelling uses reduced height differences. Datum names are labels, not height transformations.",
  "Supplied 1-sigma values must represent total observation uncertainty, including centering where relevant. Correlated GNSS vectors and stochastic control constraints are not modelled in this release.",
  "Coordinate standard deviations, 95% horizontal ellipses and standardized residuals use a priori observation sigmas. They are NOT rescaled by the estimated variance factor. Ellipse multiplier: sqrt(chi-square 2 DOF, 0.95) = 2.447747.",
  "Residual = adjusted minus observed. Standardized residual = residual / (observation sigma × sqrt(redundancy)). Values above 3 in absolute magnitude are review flags, not automatic rejection or a multiple-testing decision.",
  "Global test: two-sided 95% chi-square bounds for v'Pv and observation count minus unknown count. A passing global test does not establish the absence of blunders.",
  "No-redundancy observations cannot independently reveal errors. Free-network datum definitions, slope/zenith reduction, 3D adjustment, and direct STAR*NET DAT/raw DBX/JXL observation import are not included.",
  "Level closure checks use a spanning-tree basis in input order, including exact benchmark ties. Reported misclosure is observed DH minus the tree-path DH; loop checks can share observations and are correlated.",
]
export async function createNetworkPdf(input: NetworkInput, result: NetworkResult, settings: NetworkSettings) {
  const [{ jsPDF }, { autoTable }, font] = await Promise.all([import("jspdf"), import("jspdf-autotable"), reportFont()])
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", putOnlyUsedFonts: true })
  doc.addFileToVFS("survey-report.ttf", font); doc.addFont("survey-report.ttf", "SurveyReport", "normal"); doc.setFont("SurveyReport")
  doc.setProperties({ title: "Network adjustment report", author: "SurveyTool.io", subject: input.name })
  const margin = 14, s = result.statistics, f = (n: number | null, digits = 3) => n === null ? "—" : n.toFixed(digits)
  const heading = (title: string, y = 20) => { doc.setFontSize(17); doc.setTextColor(15, 23, 42); doc.text(title, margin, y) }
  const table = (head: string[], body: Array<Array<string | number | boolean | null>>, y = 30) => autoTable(doc, { startY: y, head: [head], body: body.map(r => r.map(c => c === null ? "—" : String(c))), styles: { font: "SurveyReport", fontStyle: "normal", fontSize: 8, cellPadding: 2, overflow: "linebreak" }, headStyles: { fontStyle: "normal", fillColor: [22, 78, 99] }, margin: { left: margin, right: margin, top: 16, bottom: 17 }, rowPageBreak: "avoid" })
  heading("Network adjustment report")
  table(["Project and solution", "Value"], [
    ["Project", input.name], ["Generated (UTC)", new Date().toISOString()], ["Mode", input.mode === "level" ? "1D levelling network" : "2D horizontal network"], ["Horizontal grid", input.grid], ["Height datum", input.datum], ["Included / excluded observations", `${s.observations} / ${result.residuals.length - s.observations}`], ["Unknowns / degrees of freedom / iterations", `${s.unknowns} / ${s.dof} / ${s.iterations}`], ["Weighted sum v'Pv", f(s.weightedSum, 8)], ["Estimated standard deviation factor sqrt(v'Pv/DOF)", f(s.varianceFactor, 6)], ["95% global chi-square test", `${s.globalTest.toUpperCase()} · lower ${f(s.chiLower, 6)} · upper ${f(s.chiUpper, 6)}`], ["Observations flagged for review (|standardized residual| > 3)", s.reviewCount], ["Default HD sigma (blank Sigma only)", `${settings.distanceMm} mm ${settings.edmModel === "additive" ? "+" : "quadrature with"} ${settings.distancePpm} ppm`], ["Default angular sigma / levelling sigma", `${settings.angularSeconds} arcsec / ${settings.levelMmPerSqrtKm} mm per sqrt(km)`],
  ])
  doc.addPage(); heading("Interpretation and checks")
  table(["Solution notes"], [...result.warnings.map(w => ["CHECK: " + w]), ...networkReportNotes.map(n => [n])])
  doc.addPage(); heading(input.mode === "level" ? "Adjusted reduced levels" : "Adjusted horizontal coordinates")
  if (input.mode === "level") table(["Point", "Status", "Initial RL (m)", "Adjusted RL (m)", "Correction (mm)", "A priori sigma H (mm)"], result.points.map((p, i) => [p.id, p.fixed ? "FIXED" : "FREE", f(input.points[i].height, 6), f(p.height, 6), f(p.deltaH === null ? null : p.deltaH * 1000), f(p.sigmaH! * 1000)]))
  else table(["Point", "Status", "Easting (m)", "Northing (m)", "dE (mm)", "dN (mm)", "Sigma E (mm)", "Sigma N (mm)", "95% major (mm)", "95% minor (mm)", "Bearing (deg N)"], result.points.map(p => [p.id, p.fixed ? "FIXED" : "FREE", f(p.easting, 6), f(p.northing, 6), f(p.deltaE! * 1000), f(p.deltaN! * 1000), f(p.sigmaE! * 1000), f(p.sigmaN! * 1000), f(p.ellipseMajor95! * 1000), f(p.ellipseMinor95! * 1000), f(p.ellipseBearing, 4)]))
  doc.addPage(); heading("Observation residuals · adjusted minus observed")
  table(["ID / set", "Type", "From / Back", "To", "Observed (m/deg)", "Adjusted (m/deg)", "Residual", "Sigma", "Units", "Redundancy %", "Std. residual", "Check"], result.residuals.map(r => [r.id + (r.set ? ` / ${r.set}` : ""), r.type, r.from + (r.back ? ` / ${r.back}` : ""), r.to, f(displayObservation(r.value, r.type), 8), f(r.computed === null ? null : displayObservation(r.computed, r.type), 8), f(r.residual === null ? null : displayResidual(r.residual, r.type)), f(displayResidual(r.sigma, r.type)), residualUnits(r), f(r.redundancy === null ? null : r.redundancy * 100, 1), f(r.standardized), r.flag.toUpperCase()]))
  if (result.orientations.length) { doc.addPage(); heading("Direction-set orientations · azimuth minus circle reading"); table(["Station", "Set", "Orientation (degrees)", "A priori sigma (arcsec)"], result.orientations.map(o => [o.station, o.set, f(o.degrees, 9), f(o.sigmaSeconds)])) }
  if (result.closures.length) { doc.addPage(); heading("Independent level-loop and benchmark-tie checks"); table(["Closing observation", "Tree path (input order)", "Misclosure (mm)", "Loop sigma (mm)", "Total length (km)", "Misclosure / sigma"], result.closures.map(c => [c.observation, c.path, f(c.misclosure * 1000), f(c.sigma * 1000), f(c.lengthKm), f(c.misclosure / c.sigma)])) }
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) { doc.setPage(page); doc.setFontSize(8); doc.setTextColor(100, 116, 139); doc.text(`SurveyTool.io · Network adjustment v1 · ${input.mode === "level" ? input.datum : input.grid}`, margin, 203); doc.text(`${page} / ${pages}`, 283, 203, { align: "right" }) }
  return doc.output("arraybuffer")
}
