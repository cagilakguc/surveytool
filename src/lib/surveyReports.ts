export type ReportCell = string | number | null;
export type ReportPlot = {
  points: Array<{ easting: number; northing: number; colour: string }>;
  legend: Record<string, string>;
};
export type SurveyReport = {
  title: string;
  project: string;
  createdAt: string;
  metadata: Array<[string, ReportCell]>;
  summary: Array<[string, ReportCell]>;
  columns: string[];
  rows: ReportCell[][];
  notes: string[];
  plot?: ReportPlot;
};
export function safeReportName(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90) || "survey-report"
  );
}
function csvCell(value: ReportCell) {
  if (value === null || (typeof value === "number" && !Number.isFinite(value)))
    return "";
  let text = String(value);
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function createReportCsv(report: SurveyReport) {
  const rows: ReportCell[][] = [
    [report.title],
    ["Project", report.project],
    ["Generated (UTC)", report.createdAt],
    ...report.metadata,
    [],
    ...report.summary,
    [],
    ...report.notes.map((note) => ["Note", note]),
    [],
    report.columns,
    ...report.rows,
  ];
  return (
    "\uFEFF" +
    rows.map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}
export function downloadReportBlob(
  content: BlobPart,
  mime: string,
  name: string,
  retain = false,
) {
  const blob = new Blob([content], { type: mime }),
    url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Retain long enough for browsers that complete the download asynchronously.
  if (!retain) window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { url, fileName: name };
}
export async function createReportExcel(report: SurveyReport) {
  if (report.rows.length > 100_000)
    throw new Error(
      "For more than 100,000 result rows, use CSV to download the complete dataset.",
    );
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  workbook.creator = "SurveyTool.io";
  workbook.created = new Date(report.createdAt);
  const sheet = workbook.addWorksheet("Results", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = report.columns.map((header, index) => ({
    header,
    key: String(index),
    width: index === 0 ? 24 : 20,
  }));
  report.rows.forEach((row) =>
    sheet.addRow(
      row.map((cell) =>
        typeof cell === "number" && !Number.isFinite(cell) ? null : cell,
      ),
    ),
  );
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: {
      row: Math.max(1, report.rows.length + 1),
      column: report.columns.length,
    },
  };
  sheet.columns.forEach((column, index) => {
    column.numFmt = report.columns[index].includes("(mm)") ? "0.00" : "0.0000";
  });
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF164E63" },
  };
  const summary = workbook.addWorksheet("Summary");
  summary.columns = [{ width: 36 }, { width: 90 }];
  summary.getColumn(2).numFmt = "0.0000";
  summary.addRows([
    [report.title],
    ["Project", report.project],
    ["Generated (UTC)", report.createdAt],
    ...report.metadata,
    [],
    ...report.summary,
    [],
    ...report.notes.map((note) => ["Note", note]),
  ]);
  summary.getRow(1).font = { bold: true, size: 16 };
  summary.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });
  return workbook.xlsx.writeBuffer();
}
let fontPromise: Promise<string> | null = null;
export async function reportFont() {
  if (!fontPromise)
    fontPromise = fetch(
      `${import.meta.env?.BASE_URL ?? "/"}fonts/survey-report.ttf`,
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "The report font could not be loaded. Retry the PDF download.",
          );
        const bytes = new Uint8Array(await response.arrayBuffer());
        let raw = "";
        for (let i = 0; i < bytes.length; i += 8192)
          raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(raw);
      })
      .catch((error) => {
        fontPromise = null;
        throw error;
      });
  return fontPromise;
}
export async function createReportPdf(report: SurveyReport) {
  const [{ jsPDF }, { autoTable }, font] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    reportFont(),
  ]);
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    putOnlyUsedFonts: true,
  });
  doc.setCreationDate(new Date(report.createdAt));
  doc.setProperties({
    title: report.title,
    author: "SurveyTool.io",
    subject: report.project,
  });
  doc.addFileToVFS("survey-report.ttf", font);
  doc.addFont("survey-report.ttf", "SurveyReport", "normal");
  doc.setFont("SurveyReport");
  const margin = 14;
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text(report.title, margin, 20);
  doc.setFontSize(11);
  doc.text(
    doc.splitTextToSize(report.project || "Survey project", 265),
    margin,
    29,
  );
  const metadata = [
    ["Generated (UTC)", report.createdAt],
    ...report.metadata,
    ...report.summary,
  ].map(([label, value]) => [
    label,
    typeof value === "number"
      ? Number.isFinite(value)
        ? String(Math.round(value * 1e6) / 1e6)
        : "—"
      : String(value ?? "—"),
  ]);
  autoTable(doc, {
    startY: 36,
    head: [["Project / check information", "Value"]],
    body: metadata,
    styles: { font: "SurveyReport", fontSize: 8, cellPadding: 1.25 },
    headStyles: { fontStyle: "normal", fillColor: [22, 78, 99] },
    columnStyles: { 0: { cellWidth: 65 } },
    margin: { left: margin, right: margin, bottom: 15 },
  });
  if (report.plot?.points.length) {
    doc.addPage();
    doc.setFontSize(14);
    doc.text("Plan view — results in the design grid", margin, 18);
    const finite = report.plot.points.filter(
      (p) => Number.isFinite(p.easting) && Number.isFinite(p.northing),
    );
    let minE = Infinity,
      maxE = -Infinity,
      minN = Infinity,
      maxN = -Infinity;
    finite.forEach((p) => {
      minE = Math.min(minE, p.easting);
      maxE = Math.max(maxE, p.easting);
      minN = Math.min(minN, p.northing);
      maxN = Math.max(maxN, p.northing);
    });
    const width = 242,
      height = 140,
      scale = Math.min(
        width / Math.max(maxE - minE, 1),
        height / Math.max(maxN - minN, 1),
      ),
      x = 23,
      y = 32;
    doc.setDrawColor(203, 213, 225);
    doc.rect(x, y, width, height);
    const step = Math.max(1, Math.ceil(finite.length / 3000));
    finite.forEach((p, index) => {
      if (index % step) return;
      doc.setFillColor(p.colour);
      doc.circle(
        x + (p.easting - minE) * scale,
        y + height - (p.northing - minN) * scale,
        0.65,
        "F",
      );
    });
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text(
      `E ${minE.toFixed(3)} to ${maxE.toFixed(3)}; N ${minN.toFixed(3)} to ${maxN.toFixed(3)}`,
      x,
      181,
    );
    doc.text(
      `North is up. Plan preview shows ${Math.ceil(finite.length / step).toLocaleString()} of ${finite.length.toLocaleString()} points; statistics and CSV include all results.`,
      x,
      187,
    );
    let legendX = x;
    for (const [label, colour] of Object.entries(report.plot.legend)) {
      doc.setFillColor(colour);
      doc.circle(legendX, 193, 1, "F");
      doc.text(label, legendX + 3, 194);
      legendX += label.length * 1.8 + 10;
    }
  }
  doc.addPage();
  doc.setFontSize(14);
  doc.text("Results", margin, 18);
  const limit = 2000;
  const notes = [
    ...report.notes,
    ...(report.rows.length > limit
      ? [
          `PDF appendix: first ${limit.toLocaleString()} of ${report.rows.length.toLocaleString()} results. CSV contains every result; all statistics include the full dataset.`,
        ]
      : []),
  ];
  autoTable(doc, {
    startY: 24,
    body: notes.map((note) => [note]),
    styles: { font: "SurveyReport", fontSize: 8, cellPadding: 2 },
    theme: "plain",
    margin: { left: margin, right: margin, bottom: 20 },
  });
  const finalY =
    (doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY ?? 24;
  const startY = finalY + 5;
  autoTable(doc, {
    startY,
    head: [report.columns],
    body: report.rows
      .slice(0, limit)
      .map((row) =>
        row.map((cell) =>
          cell === null
            ? "—"
            : typeof cell === "number"
              ? Number.isFinite(cell)
                ? String(Math.round(cell * 1e6) / 1e6)
                : "—"
              : cell,
        ),
      ),
    styles: {
      font: "SurveyReport",
      fontSize: 6.5,
      cellPadding: 1.5,
      overflow: "linebreak",
    },
    headStyles: { fontStyle: "normal", fillColor: [22, 78, 99] },
    margin: { left: margin, right: margin, bottom: 15 },
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`SurveyTool.io · ${page} / ${pages}`, margin, 203);
  }
  return doc.output("arraybuffer");
}
