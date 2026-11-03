import type { PavementSectionRequest, PavementSectionResult } from "./pavementSection"
import { formatPavementSlope, pavementSectionPlot, pavementSectionTicks, pavementSlopeLabelSegments, pavementSlopeNote } from "./pavementSection"
import { formatChainage } from "./alignmentStationing"
import { createReportCsv, reportFont } from "./surveyReports"
import type { SurveyReport } from "./surveyReports"
import { restoreThicknessRule, thicknessColourNote, thicknessCriteriaMetadata } from "./pavementThickness"

export function pavementSectionReport(request: PavementSectionRequest, result: PavementSectionResult): SurveyReport {
  const ch = (value: number | null) => value === null ? "Unavailable" : `CH ${formatChainage(value)}`
  const rule = restoreThicknessRule(request.criteria?.thicknessRule)
  const criteria: Array<[string, string | number | null]> = request.mode === "thickness"
    ? request.criteria?.targetMm !== undefined ? thicknessCriteriaMetadata(request.criteria.targetMm, request.criteria.toleranceMm ?? 0, rule) : []
    : [["FSL lower tolerance (mm)", request.criteria?.lowerMm ?? null], ["FSL upper tolerance (mm)", request.criteria?.upperMm ?? null]]
  const intervals = new Map(result.segments.map((segment) => [segment.endIndex, segment]))
  return { title: "Pavement Drawn Section Report", project: request.mode === "thickness" ? "Pavement thickness" : "Asbuilt vs FSL", createdAt: new Date().toISOString(),
    metadata: [["Check", request.mode], ...criteria, ["Point filter", request.scope], ["Common grid", request.crs || "Not specified"], ["Common vertical datum", request.datum || "Not specified"], ["Alignment", request.alignmentName || "None"], ["Start E / N", `${request.line.start.easting.toFixed(3)} / ${request.line.start.northing.toFixed(3)}`], ["End E / N", `${request.line.end.easting.toFixed(3)} / ${request.line.end.northing.toFixed(3)}`], ["Start / end chainage", `${ch(result.startChainage)} / ${ch(result.endChainage)}`], ["Section length (m)", result.length], ["Point search distance each side (m)", request.corridor], ["FSL surface", request.document?.surfaces[0]?.name || "None"], ["Bottom TIN file", request.bottomDocument?.fileName || "None"], ["Bottom TIN surface", request.bottomDocument?.surfaces[0]?.name || "None"]],
    summary: [["Measured points in this section", result.points.length]],
    columns: ["Point", "Distance (m)", "Off line (m)", "Chainage", "Asbuilt RL", "Bottom RL", "Thickness (mm)", rule === "minimum" ? "Thickness difference from minimum (mm)" : "Thickness deviation (mm)", "FSL RL at original XY", "FSL difference (mm)", "Check status", "Easting", "Northing", "Slope from point", "Horizontal run (m)", "Asbuilt slope (%)", "Design avg slope (%)"],
    rows: result.points.map((point, index) => { const segment = intervals.get(index); return [point.id, point.distance, point.offLine, point.chainage === null ? null : formatChainage(point.chainage), point.elevation, point.bottom?.elevation ?? null, point.thicknessMm ?? null, point.deviationMm ?? null, point.fslLevel, point.fslDifferenceMm, point.status, point.easting, point.northing, segment ? result.points[segment.startIndex].id : null, segment?.run ?? null, segment?.asbuiltSlopePercent ?? null, segment?.designSlopePercent ?? null] }),
    notes: [...(request.mode === "thickness" ? [thicknessColourNote(rule)] : []), "Measured points within the stated search distance are projected onto the drawn line for display; their original measured RLs are unchanged. Thickness uses the original matched top/bottom measurements, or the measured top minus the bottom TIN interpolated at its original XY. Bottom TIN levels outside coverage, in holes, or without reliable heights remain unassessed. FSL differences use the design level at each point's original XY.", "Horizontal axis: distance along the drawn line. Chainage labels refer to the selected alignment and are not extrapolated beyond its endpoints. The vertical scale is exaggerated to make level differences visible. No coordinate or vertical datum conversion is applied.", "Orange line: asbuilt points automatically connected in section distance order. " + pavementSlopeNote, "DXF strings are plan reference layers; their default 2D heights are not treated as measured or design levels. FSL profile gaps have no design coverage and are not joined." ] }
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
  pdf.setDrawColor(234, 88, 12); pdf.setLineWidth(.7)
  for (const segment of result.segments) { const a = result.points[segment.startIndex], b = result.points[segment.endIndex]; pdf.line(x(a.distance), y(a.elevation), x(b.distance), y(b.elevation)) }
  const step = Math.max(1, Math.ceil(result.points.length / 1000))
  result.points.forEach((point, index) => {
    if (index % step) return
    if (point.bottom?.elevation != null && point.bottomDistance !== null) {
      pdf.setDrawColor(100, 116, 139); pdf.setLineWidth(.3); pdf.line(x(point.distance), y(point.elevation), x(point.bottomDistance), y(point.bottom.elevation)); pdf.setFillColor("#64748b"); pdf.circle(x(point.bottomDistance), y(point.bottom.elevation), .7, "F")
    }
    pdf.setFillColor(point.colour); pdf.circle(x(point.distance), y(point.elevation), 1, "F")
    if (result.points.length <= 40) { pdf.setTextColor(15, 23, 42); const value = request.mode === "thickness" ? `${point.thicknessMm?.toFixed(0) ?? "—"} mm` : `${point.fslDifferenceMm?.toFixed(1) ?? "—"} mm`; const right = point.distance / result.length > .8; pdf.text(`${point.id.slice(0, 18)} · ${value}`, x(point.distance) + (right ? -1 : 1), y(point.elevation) - 3, { align: right ? "right" : "left" }) }
  })
  pdf.setFontSize(8)
  for (const segment of pavementSlopeLabelSegments(result)) {
    const a = result.points[segment.startIndex], b = result.points[segment.endIndex], midX = x((a.distance + b.distance) / 2)
    const asbuiltLineY = y((a.elevation + b.elevation) / 2)
    const designLineY = segment.designStartLevel !== null && segment.designEndLevel !== null ? y((segment.designStartLevel + segment.designEndLevel) / 2) : asbuiltLineY
    const designLabelY = Math.max(39, designLineY - 6), asbuiltLabelY = Math.min(152, asbuiltLineY + 8)
    const separation = Math.max(0, (designLabelY + 6 - asbuiltLabelY) / 2)
    const designY = Math.max(39, designLabelY - separation), asbuiltY = Math.min(152, asbuiltLabelY + separation)
    pdf.setTextColor(8, 145, 178); pdf.text(`D avg ${formatPavementSlope(segment.designSlopePercent)}`, midX, designY, { align: "center" })
    pdf.setTextColor(194, 65, 12); pdf.text(`AB ${formatPavementSlope(segment.asbuiltSlopePercent)}`, midX, asbuiltY, { align: "center" })
  }
  pdf.setFontSize(9); pdf.setTextColor(51, 65, 85); pdf.text("Distance along drawn line (m). RLs in metres; vertical scale exaggerated.", 25, 178)
  pdf.setFontSize(8); pdf.text(pdf.splitTextToSize(`Orange / AB: connected asbuilt profile and slope (%). Cyan / D avg: FSL design and interval average slope (%). Coloured dots: asbuilt check status; grey: bottom survey or TIN. Up to 1,000 measured dots; all asbuilt line segments. Slopes use real RLs and horizontal run; crowded labels are reduced. ${result.points.length ? "" : "No measured points fall inside this section corridor."}`, 246), 25, 184)
  pdf.addPage(); pdf.setFontSize(16); pdf.text("Asbuilt and design slopes", 14, 18)
  pdf.setFontSize(9); pdf.text(pdf.splitTextToSize(pavementSlopeNote, 267), 14, 26)
  if (result.segments.length) autoTable(pdf, { startY: 48, head: [["From point", "To point", "From distance (m)", "To distance (m)", "Horizontal run (m)", "Asbuilt slope (%)", "Design avg slope (%)"]], body: result.segments.slice(0, 2000).map((segment) => { const a = result.points[segment.startIndex], b = result.points[segment.endIndex]; return [a.id, b.id, a.distance.toFixed(3), b.distance.toFixed(3), segment.run.toFixed(3), formatPavementSlope(segment.asbuiltSlopePercent), formatPavementSlope(segment.designSlopePercent)] }), styles: { font: "SurveyReport", fontStyle: "normal", fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [22, 78, 99], fontStyle: "normal" }, margin: { bottom: 15 } })
  else pdf.text("At least two measured points at distinct section positions are needed for slopes.", 14, 50)
  if (result.segments.length > 2000) { pdf.addPage(); pdf.setFontSize(11); pdf.text("The PDF includes the first 2,000 slope intervals. Download CSV for every interval.", 14, 20) }
  pdf.addPage(); pdf.setFontSize(16); pdf.text("Point results", 14, 18)
  autoTable(pdf, { startY: 25, body: report.notes.map((note) => [note]), styles: { font: "SurveyReport", fontSize: 8, cellPadding: 2 }, margin: { bottom: 15 } })
  const finalY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  autoTable(pdf, { startY: finalY + 5, head: [report.columns.slice(0, 13)], body: report.rows.slice(0, 2000).map((row) => row.slice(0, 13).map((value) => typeof value === "number" ? value.toFixed(3) : value ?? "—")), styles: { font: "SurveyReport", fontStyle: "normal", fontSize: 7, cellPadding: 1.3 }, headStyles: { fillColor: [22, 78, 99], fontStyle: "normal" }, margin: { bottom: 15 } })
  if (report.rows.length > 2000) { pdf.addPage(); pdf.setFontSize(11); pdf.text("The PDF appendix contains the first 2,000 points. Download CSV for every section point.", 14, 20) }
  for (let i = 1; i <= pdf.getNumberOfPages(); i++) { pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(100, 116, 139); pdf.text(`SurveyTool.io · ${i} / ${pdf.getNumberOfPages()}`, 14, 203) }
  return pdf.output("arraybuffer")
}
