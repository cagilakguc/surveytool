import type { PavementSectionRequest, PavementSectionResult } from "./pavementSection"
import { pavementSectionPlot, pavementSectionTicks } from "./pavementSection"
import { formatChainage } from "./alignmentStationing"
import { createReportCsv, reportFont } from "./surveyReports"
import type { SurveyReport } from "./surveyReports"

export function pavementSectionReport(request: PavementSectionRequest, result: PavementSectionResult): SurveyReport {
  const ch = (value: number | null) => value === null ? "Unavailable" : `CH ${formatChainage(value)}`
  return { title: "Pavement Drawn Section Report", project: request.mode === "thickness" ? "Pavement thickness" : "Asbuilt vs FSL", createdAt: new Date().toISOString(),
    metadata: [["Check", request.mode], ["Target thickness (mm)", request.criteria?.targetMm ?? null], ["Thickness tolerance ± (mm)", request.criteria?.toleranceMm ?? null], ["FSL lower tolerance (mm)", request.criteria?.lowerMm ?? null], ["FSL upper tolerance (mm)", request.criteria?.upperMm ?? null], ["Point filter", request.scope], ["Common grid", request.crs || "Not specified"], ["Common vertical datum", request.datum || "Not specified"], ["Alignment", request.alignmentName || "None"], ["Start E / N", `${request.line.start.easting.toFixed(3)} / ${request.line.start.northing.toFixed(3)}`], ["End E / N", `${request.line.end.easting.toFixed(3)} / ${request.line.end.northing.toFixed(3)}`], ["Start / end chainage", `${ch(result.startChainage)} / ${ch(result.endChainage)}`], ["Section length (m)", result.length], ["Point search distance each side (m)", request.corridor], ["FSL surface", request.document?.surfaces[0]?.name || "None"], ["Bottom TIN file", request.bottomDocument?.fileName || "None"], ["Bottom TIN surface", request.bottomDocument?.surfaces[0]?.name || "None"]],
    summary: [["Measured points in this section", result.points.length]],
    columns: ["Point", "Distance (m)", "Off line (m)", "Chainage", "Asbuilt RL", "Bottom RL", "Thickness (mm)", "Thickness deviation (mm)", "FSL RL at original XY", "FSL difference (mm)", "Check status", "Easting", "Northing"],
    rows: result.points.map((point) => [point.id, point.distance, point.offLine, point.chainage === null ? null : formatChainage(point.chainage), point.elevation, point.bottom?.elevation ?? null, point.thicknessMm ?? null, point.deviationMm ?? null, point.fslLevel, point.fslDifferenceMm, point.status, point.easting, point.northing]),
    notes: ["Measured points within the stated search distance are projected onto the drawn line for display; their original measured RLs are unchanged. Thickness uses the original matched top/bottom measurements, or the measured top minus the bottom TIN interpolated at its original XY. Bottom TIN levels outside coverage, in holes, or without reliable heights remain unassessed. FSL differences use the design level at each point's original XY.", "Horizontal axis: distance along the drawn line. Chainage labels refer to the selected alignment and are not extrapolated beyond its endpoints. The vertical scale is exaggerated to make level differences visible. No coordinate or vertical datum conversion is applied.", "DXF strings are plan reference layers; their default 2D heights are not treated as measured or design levels. FSL profile gaps have no design coverage and are not joined." ] }
}

export function pavementSectionCsv(request: PavementSectionRequest, result: PavementSectionResult) { return createReportCsv(pavementSectionReport(request, result)) }

export async function pavementSectionPdf(request: PavementSectionRequest, result: PavementSectionResult) {
  const report = pavementSectionReport(request, result)
  const [{ jsPDF }, { autoTable }, font] = await Promise.all([import("jspdf"), import("jspdf-autotable"), reportFont()])
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", putOnlyUsedFonts: true })
  pdf.addFileToVFS("survey.ttf", font); pdf.addFont("survey.ttf", "SurveyReport", "normal"); pdf.setFont("SurveyReport")
  pdf.setProperties({ title: report.title, author: "SurveyTool.io" })
  pdf.setFontSize(19); pdf.setTextColor(15, 23, 42); pdf.text(report.title, 14, 20)
  autoTable(pdf, { startY: 30, head: [["Section settings", "Value"]], body: [...report.metadata, ...report.summary].map(([name, value]) => [name, value === null ? "—" : String(value)]), styles: { font: "SurveyReport", fontStyle: "normal", fontSize: 9, cellPadding: 2 }, headStyles: { fillColor: [22, 78, 99], fontStyle: "normal" }, margin: { bottom: 15 } })
  pdf.addPage(); pdf.setFontSize(16); pdf.text("Measured pavement section", 14, 18)
  const plot = pavementSectionPlot(result)
  const x = (d: number) => 25 + d / result.length * 246
  const y = (z: number) => 155 - (z - plot.minimum) / (plot.maximum - plot.minimum) * 120
  pdf.setFontSize(8)
  for (const [i, tick] of pavementSectionTicks(result).entries()) {
    const d = tick.distance, z = plot.minimum + i / 5 * (plot.maximum - plot.minimum)
    pdf.setDrawColor(218, 225, 235); pdf.setLineWidth(.15); pdf.line(x(d), 35, x(d), 155); pdf.line(25, y(z), 271, y(z))
    pdf.setTextColor(51, 65, 85); pdf.text(d.toFixed(2), x(d), 161, { align: "center" }); pdf.text(z.toFixed(3), 22, y(z) + 1, { align: "right" })
    if (tick.chainage !== null) { pdf.setFontSize(7); pdf.text(`CH ${formatChainage(tick.chainage)}`, x(d), 168, { align: "center" }); pdf.setFontSize(8) }
  }
  pdf.setDrawColor(8, 145, 178); pdf.setLineWidth(.7)
  for (let i = 1; i < result.samples.length; i++) { const a = result.samples[i - 1], b = result.samples[i]; if (a.level !== null && b.level !== null) pdf.line(x(a.distance), y(a.level), x(b.distance), y(b.level)) }
  pdf.setDrawColor(100, 116, 139); pdf.setLineWidth(.7)
  for (let i = 1; i < result.samples.length; i++) { const a = result.samples[i - 1], b = result.samples[i]; if (a.bottomLevel != null && b.bottomLevel != null) pdf.line(x(a.distance), y(a.bottomLevel), x(b.distance), y(b.bottomLevel)) }
  const step = Math.max(1, Math.ceil(result.points.length / 1000))
  result.points.forEach((point, index) => {
    if (index % step) return
    if (point.bottom?.elevation != null && point.bottomDistance !== null) {
      pdf.setDrawColor(100, 116, 139); pdf.setLineWidth(.3); pdf.line(x(point.distance), y(point.elevation), x(point.bottomDistance), y(point.bottom.elevation)); pdf.setFillColor("#64748b"); pdf.circle(x(point.bottomDistance), y(point.bottom.elevation), .7, "F")
    }
    pdf.setFillColor(point.colour); pdf.circle(x(point.distance), y(point.elevation), 1, "F")
    if (result.points.length <= 40) { pdf.setTextColor(15, 23, 42); const value = request.mode === "thickness" ? `${point.thicknessMm?.toFixed(0) ?? "—"} mm` : `${point.fslDifferenceMm?.toFixed(1) ?? "—"} mm`; const right = point.distance / result.length > .8; pdf.text(`${point.id.slice(0, 18)} · ${value}`, x(point.distance) + (right ? -1 : 1), y(point.elevation) - 3, { align: right ? "right" : "left" }) }
  })
  pdf.setFontSize(9); pdf.setTextColor(51, 65, 85); pdf.text("Distance along drawn line (m). RLs in metres; vertical scale exaggerated.", 25, 178)
  pdf.setFontSize(8); pdf.text(pdf.splitTextToSize(`Cyan: FSL design; coloured dots: top / asbuilt check status; grey dots / line: bottom survey or bottom TIN. Profile preview shows up to 1,000 measured points; tables and CSV retain the stated report scope. ${result.points.length ? "" : "No measured points fall inside this section corridor."}`, 246), 25, 184)
  pdf.addPage(); pdf.setFontSize(16); pdf.text("Point results", 14, 18)
  autoTable(pdf, { startY: 25, body: report.notes.map((note) => [note]), styles: { font: "SurveyReport", fontSize: 8, cellPadding: 2 }, margin: { bottom: 15 } })
  const finalY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  autoTable(pdf, { startY: finalY + 5, head: [report.columns], body: report.rows.slice(0, 2000).map((row) => row.map((value) => typeof value === "number" ? value.toFixed(3) : value ?? "—")), styles: { font: "SurveyReport", fontStyle: "normal", fontSize: 7, cellPadding: 1.3 }, headStyles: { fillColor: [22, 78, 99], fontStyle: "normal" }, margin: { bottom: 15 } })
  if (report.rows.length > 2000) { pdf.addPage(); pdf.setFontSize(11); pdf.text("The PDF appendix contains the first 2,000 points. Download CSV for every section point.", 14, 20) }
  for (let i = 1; i <= pdf.getNumberOfPages(); i++) { pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(100, 116, 139); pdf.text(`SurveyTool.io · ${i} / ${pdf.getNumberOfPages()}`, 14, 203) }
  return pdf.output("arraybuffer")
}
