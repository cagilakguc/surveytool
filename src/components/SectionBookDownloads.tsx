import { useEffect, useRef, useState } from "react"
import type { SectionBook } from "../lib/sectionReports"
import { downloadReportBlob, safeReportName } from "../lib/surveyReports"

export default function SectionBookDownloads({ book, single = false }: { book: SectionBook | null; single?: boolean }) {
  const [busy, setBusy] = useState(""), [error, setError] = useState("")
  const [prepared, setPrepared] = useState<{ url: string; fileName: string } | null>(null)
  const current = useRef(book); current.current = book
  useEffect(() => { setPrepared(null); setError("") }, [book])
  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.url) }, [prepared])
  async function download(format: "pdf" | "csv") {
    if (!book) return
    setBusy(format); setError("")
    try {
      const reports = await import("../lib/sectionReports")
      const data = format === "pdf" ? await reports.createSectionBookPdf(book) : reports.sectionBookCsv(book)
      if (current.current !== book) throw new Error("Section settings changed. Create the download again.")
      setPrepared(downloadReportBlob(data, format === "pdf" ? "application/pdf" : "text/csv;charset=utf-8", `${safeReportName(book.document.projectName)}-${single ? "section" : "sections"}.${format}`, true))
    } catch (error) { setError(error instanceof Error ? error.message : "The section export could not be created.") }
    finally { setBusy("") }
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!book || !!busy} onClick={() => void download("pdf")} className="rounded-full bg-cyan-300 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40">{busy === "pdf" ? "Preparing PDF…" : single ? "Download section PDF" : "Download sections PDF"}</button>
      {!single&&<button type="button" disabled={!book || !!busy} onClick={() => void download("csv")} className="rounded-full border border-white/20 px-4 py-2 text-xs disabled:opacity-40">{busy === "csv" ? "Preparing CSV…" : "Download sections CSV"}</button>}
    </div>
    {prepared&&<a href={prepared.url} download={prepared.fileName} className="block text-xs text-cyan-300 underline">Download prepared {prepared.fileName.endsWith(".pdf") ? "section PDF" : "sections CSV"}</a>}
    {error&&<p role="alert" className="text-sm text-amber-200">{error}</p>}
  </div>
}
