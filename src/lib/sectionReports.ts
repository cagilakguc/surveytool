import type { LandXmlDocument } from "./landxml"
import type { SectionAnalysis } from "./sectionAnalysis"
import { calculateSectionThickness } from "./sectionOptions"
import { metresPerLinearUnit } from "./mapCoordinates"
import { createReportCsv, reportFont } from "./surveyReports"

export type SectionBook = {
  document: LandXmlDocument
  sections: SectionAnalysis[]
  surfaceIndices: number[]
  pointFiles: string[]
  unitLabel: string
  alignment: string
  corridor: number
  interval?: number
  top: string
  bottom: string
  reference: string
  crs: string
}
const colours = ["#22a3b8", "#2563eb", "#9333ea", "#059669", "#db2777"]
export function sectionBookCsv(book: SectionBook) {
  return createReportCsv({
    title: "Cross-section Book", project: book.document.projectName, createdAt: new Date().toISOString(),
    metadata: [["Alignment", book.alignment || "Drawn section"], ["Interval", book.interval ?? null], ["File units", book.document.units], ["CRS (map selection)", book.crs || "Not declared"], ["Selected measured files", book.pointFiles.join("; ") || "None"], ["Top surface", book.top], ["Bottom surface", book.bottom || "None — thickness off"], ["Design reference", book.reference || "None"], ["Point search distance each side", book.corridor]],
    summary: [["Sections", book.sections.length]],
    columns: ["Section", "Chainage", "Type", "Source", "Point ID", `Distance from line start (${book.unitLabel})`, `Distance off line (${book.unitLabel})`, `Easting (${book.unitLabel})`, `Northing (${book.unitLabel})`, `RL (${book.unitLabel})`, `Design RL (${book.unitLabel})`, "Difference (mm)"],
    rows: book.sections.flatMap((section, i) => [
      ...section.samples.flatMap((sample) => book.surfaceIndices.map((index) => [i + 1, section.station?.chainage ?? null, "TIN sample", book.document.surfaces[index].name, "", sample.distance, null,
        section.line.start.easting + (section.line.end.easting - section.line.start.easting) * sample.distance / (section.length || 1),
        section.line.start.northing + (section.line.end.northing - section.line.start.northing) * sample.distance / (section.length || 1), sample.values[index], null, null])),
      ...section.sectionPoints.map((point) => [i + 1, section.station?.chainage ?? null, "Measured point", point.layerName, point.id, point.distance, point.offset, point.easting, point.northing, point.elevation, point.referenceLevel, point.differenceMm]),
    ]),
    notes: ["Source survey coordinates and measured RLs are retained. All files must share a grid, linear units and height datum. No vertical datum conversion is applied.", "Points within the selected distance either side of a section are projected onto it for display. Differences use design levels at the original measured X/Y. Blank levels are unassessed.", "Alignment sections use perpendiculars to the imported alignment's horizontal line, circular-curve and clothoid geometry at the requested chainages. Station equations and unsupported spirals require manual sections."],
  })
}

export async function createSectionBookPdf(book: SectionBook) {
  if (!book.sections.length) throw new Error("Create or draw a section first.")
  const [{ jsPDF }, { autoTable }, font] = await Promise.all([import("jspdf"), import("jspdf-autotable"), reportFont()])
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", putOnlyUsedFonts: true })
  pdf.addFileToVFS("survey-report.ttf", font); pdf.addFont("survey-report.ttf", "SurveyReport", "normal"); pdf.setFont("SurveyReport")
  pdf.setProperties({ title: "Cross-section Book", author: "SurveyTool.io", subject: book.document.projectName })
  pdf.setTextColor(15, 23, 42); pdf.setFontSize(20); pdf.text("Cross-section Book", 14, 20)
  pdf.setFontSize(10); pdf.text(pdf.splitTextToSize(book.document.projectName || "Survey project", 269), 14, 29)
  autoTable(pdf, { startY: 39, head: [["Project / section settings", "Value"]], body: [
    ["Generated (UTC)", new Date().toISOString()], ["LandXML", book.document.fileName], ["Alignment", book.alignment || "No alignment — drawn section"], ["Sections", String(book.sections.length)],
    ["Interval", book.interval ? `${book.interval} ${book.unitLabel}` : "Manually drawn"], ["Top / design surface", book.top], ["Bottom surface", book.bottom || "None — thickness check off"], ["Design reference for measured levels", book.reference || "None"],
    ["Measured files", book.pointFiles.join("; ") || "None"], ["Point search distance each side", `${book.corridor} ${book.unitLabel}`], ["Source linear units", book.document.units], ["CRS (map selection)", book.crs || "Not declared"],
    ["Method", "TIN profiles sampled at 161 positions. Nearby measured points are projected onto each section without changing their RLs. Differences use the design level at the point's original X/Y. Missing design levels are unassessed. All files must already share the same horizontal grid, linear units and vertical datum."],
    ["Reading the sheets", "Each profile uses independently fitted horizontal and vertical scales. Point tables list up to 8 points per sheet; download the sections CSV for all samples and measured points. Background imagery is not included in the section sheets."],
  ], styles: { font: "SurveyReport", fontSize: 8, cellPadding: 1.5 }, headStyles: { fontStyle: "normal", fillColor: [22, 78, 99] }, columnStyles: { 0: { cellWidth: 68 } }, margin: { left: 14, right: 14, bottom: 15 } })

  for (let sectionIndex = 0; sectionIndex < book.sections.length; sectionIndex++) {
    const section = book.sections[sectionIndex]
    pdf.addPage(); pdf.setTextColor(15, 23, 42); pdf.setFontSize(15)
    const chainage = section.station?.chainage
    pdf.text(chainage === undefined ? `Drawn section ${sectionIndex + 1}` : `CH ${Math.floor(chainage / 1000)}+${(chainage % 1000).toFixed(3).padStart(7, "0")}`, 14, 17)
    pdf.setFontSize(8)
    pdf.text(`${book.alignment || "Drawn section"} · ${section.sectionPoints.length} measured points · search ±${book.corridor} ${book.unitLabel}`.slice(0, 180), 14, 25)
    pdf.text(`Start E ${section.line.start.easting.toFixed(3)}, N ${section.line.start.northing.toFixed(3)} · End E ${section.line.end.easting.toFixed(3)}, N ${section.line.end.northing.toFixed(3)}`, 14, 31)
    const x = 28, y = 43, w = 253, h = 86, origin = section.station?.sectionDistance ?? 0
    let min = Infinity, max = -Infinity
    section.samples.forEach((sample) => book.surfaceIndices.forEach((index) => { const v = sample.values[index]; if (v !== null && Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v) } }))
    section.sectionPoints.forEach((point) => { min = Math.min(min, point.elevation); max = Math.max(max, point.elevation) })
    const hasLevels = Number.isFinite(min)
    if (!hasLevels) { min = 0; max = 1 }
    const span = Math.max(max - min, 0.1); min -= span * 0.08; max += span * 0.08
    const px = (d: number) => x + d / (section.length || 1) * w
    const py = (z: number) => y + (max - z) / (max - min) * h
    pdf.setFontSize(7); pdf.setDrawColor(203, 213, 225); pdf.setLineWidth(0.15)
    for (let t = 0; t <= 4; t++) {
      const r = t / 4, gy = y + r * h, gx = x + r * w
      pdf.line(x, gy, x + w, gy); pdf.line(gx, y, gx, y + h)
      pdf.text((max - r * (max - min)).toFixed(3), x - 3, gy + 1, { align: "right" })
      pdf.text((r * section.length - origin).toFixed(2), gx, y + h + 4, { align: "center" })
    }
    pdf.setDrawColor(100, 116, 139); pdf.rect(x, y, w, h)
    pdf.text(`RL (${book.unitLabel})`, 14, y - 4)
    pdf.text(`${section.station?.sectionDistance === null || !section.station ? "Distance along section" : "Offset from alignment"} (${book.unitLabel}) · independent axis scales`, x, y + h + 9)
    if (origin > 0 && origin < section.length) { pdf.setDrawColor(148, 163, 184); pdf.setLineDashPattern([1, 1], 0); pdf.line(px(origin), y, px(origin), y + h); pdf.setLineDashPattern([], 0) }
    book.surfaceIndices.forEach((index) => {
      pdf.setDrawColor(colours[index % colours.length]); pdf.setLineWidth(0.6)
      let previous: { x: number; y: number } | null = null
      section.samples.forEach((sample) => { const value = sample.values[index]; if (value === null || !Number.isFinite(value)) { previous = null; return }; const next = { x: px(sample.distance), y: py(value) }; if (previous) pdf.line(previous.x, previous.y, next.x, next.y); previous = next })
    })
    const pointStep = Math.max(1, Math.ceil(section.sectionPoints.length / 1000))
    section.sectionPoints.forEach((point, index) => { if (index % pointStep) return; pdf.setFillColor("#e87924"); pdf.setDrawColor("#ffffff"); pdf.circle(px(point.distance), py(point.elevation), 0.85, "FD") })
    if (!hasLevels) { pdf.setTextColor(100, 116, 139); pdf.text("No design levels or measured points within this section.", x + w / 2, y + h / 2, { align: "center" }); pdf.setTextColor(15, 23, 42) }
    let legendX = 14
    pdf.setFontSize(7)
    book.surfaceIndices.forEach((index) => {
      const name = book.document.surfaces[index].name, label = name.length > 31 ? `${name.slice(0, 28)}…` : name
      pdf.setDrawColor(colours[index % colours.length]); pdf.setLineWidth(0.6); pdf.line(legendX, 143, legendX + 5, 143)
      pdf.text(label, legendX + 7, 144); legendX += Math.min(74, pdf.getTextWidth(label) + 14)
    })
    pdf.setFillColor("#e87924"); pdf.circle(legendX + 1, 143, 0.8, "F"); pdf.text(`Measured points${pointStep > 1 ? ` (1 in ${pointStep} plotted)` : ""}`, legendX + 4, 144)
    const thickness = calculateSectionThickness(section.samples, book.document.surfaces.findIndex((s) => s.name === book.top), book.document.surfaces.findIndex((s) => s.name === book.bottom), metresPerLinearUnit(book.document.units))
    if (book.bottom) { pdf.setFontSize(7); pdf.text(thickness ? `Thickness (mm) · min ${thickness.minimum.toFixed(1)} · mean ${thickness.average.toFixed(1)} · max ${thickness.maximum.toFixed(1)}` : "Thickness unassessed: no common design levels.", 14, 37) }
    if (section.sectionPoints.length) {
      autoTable(pdf, { startY: 152, head: [["File / point", `Section x (${book.unitLabel})`, `Off line (${book.unitLabel})`, `Measured RL (${book.unitLabel})`, `Design RL (${book.unitLabel})`, "Difference (mm)"]], body: section.sectionPoints.slice(0, 8).map((p) => [
        `${p.layerName} / ${p.id}`, (p.distance - origin).toFixed(3), p.offset.toFixed(3), p.elevation.toFixed(3), p.referenceLevel === null ? "—" : p.referenceLevel.toFixed(3), p.differenceMm === null ? "—" : p.differenceMm.toFixed(1),
      ]), styles: { font: "SurveyReport", fontSize: 6.5, cellPadding: 1, overflow: "ellipsize" }, headStyles: { fontStyle: "normal", fillColor: [22, 78, 99] }, columnStyles: { 0: { cellWidth: 78 } }, margin: { left: 14, right: 14, bottom: 15 }, rowPageBreak: "avoid" })
      if (section.sectionPoints.length > 8) pdf.text(`First 8 of ${section.sectionPoints.length} points listed. Sections CSV contains every point and design sample.`, 14, 197)
    } else pdf.text("No measured points within the selected search distance. Design profile shown where available.", 14, 157)
  }
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) { pdf.setPage(i); pdf.setTextColor(100, 116, 139); pdf.setFontSize(7); pdf.text(`SurveyTool.io · ${i} / ${pages}`, 14, 205) }
  return pdf.output("arraybuffer")
}
