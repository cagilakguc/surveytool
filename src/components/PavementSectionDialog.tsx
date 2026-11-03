import { useEffect, useRef, useState } from "react"
import type { PavementSectionRequest, PavementSectionResult } from "../lib/pavementSection"
import { pavementSectionPlot, pavementSectionTicks } from "../lib/pavementSection"
import { formatChainage } from "../lib/alignmentStationing"
import { downloadReportBlob } from "../lib/surveyReports"

export default function PavementSectionDialog({ request, onClose }: { request: PavementSectionRequest; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [completed, setCompleted] = useState<{ request: PavementSectionRequest; result: PavementSectionResult } | null>(null)
  const [error, setError] = useState(""), [busy, setBusy] = useState("")
  const [prepared, setPrepared] = useState<{ url: string; fileName: string } | null>(null)
  const latest = useRef(request); latest.current = request
  const result = completed?.request === request ? completed.result : null
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  useEffect(() => {
    setCompleted(null); setError(""); setPrepared(null)
    const worker = new Worker(new URL("../workers/pavementSection.worker.ts", import.meta.url), { type: "module" })
    worker.onmessage = (event) => { if (event.data.error) setError(event.data.error); else setCompleted({ request, result: event.data.result }); worker.terminate() }
    worker.onerror = () => { setError("The section could not be created. Reduce the work area and try again."); worker.terminate() }
    worker.postMessage(request)
    return () => worker.terminate()
  }, [request])
  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.url) }, [prepared])
  async function download(format: "pdf" | "csv") {
    if (!result) return
    setBusy(format); setError("")
    try {
      const reports = await import("../lib/pavementSectionReports")
      const data = format === "pdf" ? await reports.pavementSectionPdf(request, result) : reports.pavementSectionCsv(request, result)
      if (latest.current !== request) throw new Error("The section changed. Create the report again.")
      setPrepared(downloadReportBlob(data, format === "pdf" ? "application/pdf" : "text/csv;charset=utf-8", `pavement-${request.mode}-section.${format}`, true))
    } catch (error) { setError(error instanceof Error ? error.message : "The section report could not be created.") }
    finally { setBusy("") }
  }
  const plot = result ? pavementSectionPlot(result) : null
  const headerChainage = result?.startChainage != null ? `CH ${formatChainage(result.startChainage)} → ${result.endChainage == null ? "outside alignment" : `CH ${formatChainage(result.endChainage)}`}` : "Drawn section"
  return <dialog ref={dialog} aria-labelledby="pavement-section-title" onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => { if (event.target === event.currentTarget) onClose() }} className="fixed inset-0 z-50 m-auto max-h-[94dvh] w-[min(1200px,96vw)] max-w-none overflow-auto rounded-3xl border border-cyan-300/25 bg-slate-950 p-0 text-white shadow-2xl backdrop:bg-slate-950/80">
    <div className="p-5 md:p-7">
      <div className="flex items-start justify-between gap-4"><div><h2 id="pavement-section-title" className="text-2xl font-semibold">Pavement cross section</h2><p className="mt-2 text-sm text-cyan-200">{request.alignmentName ? `${request.alignmentName} · ` : ""}{headerChainage}</p></div><button type="button" onClick={onClose} aria-label="Close pavement section" className="rounded-full border border-white/20 px-4 py-2 text-sm">Close</button></div>
      <p className="mt-3 text-xs leading-6 text-slate-400">{request.scope} · Search distance ±{request.corridor} m · Original measured RLs retained. Horizontal axis follows your drawn line; alignment chainages are labelled separately. Vertical scale is exaggerated.</p>
      {error && <p role="alert" className="mt-4 rounded-xl bg-amber-400/10 p-4 text-sm text-amber-200">{error}</p>}
      {!result && !error && <p role="status" className="mt-6 text-cyan-200">Creating section…</p>}
      {result && plot && <>
        <svg viewBox="0 0 1000 475" role="img" aria-label="Pavement section profile showing FSL, measured levels and chainages" className="mt-5 block w-full rounded-2xl border border-white/10 bg-slate-900/40">
          {pavementSectionTicks(result).map(({ distance, chainage: ch }, i) => {
            const level = plot.minimum + (plot.maximum - plot.minimum) * i / 5
            return <g key={i} fontSize="11" fill="#94a3b8"><line x1={plot.x(distance)} x2={plot.x(distance)} y1="60" y2="390" stroke="#334155" /><line x1="85" x2="925" y1={plot.y(level)} y2={plot.y(level)} stroke="#334155" /><text x="76" y={plot.y(level) + 4} textAnchor="end">{level.toFixed(3)}</text><text x={plot.x(distance)} y="410" textAnchor="middle">{distance.toFixed(2)} m</text>{ch !== null && <text x={plot.x(distance)} y="429" textAnchor="middle" fill="#facc15">CH {formatChainage(ch)}</text>}</g>
          })}
          {result.samples.slice(1).map((sample, i) => sample.level !== null && result.samples[i].level !== null ? <line key={i} x1={plot.x(result.samples[i].distance)} y1={plot.y(result.samples[i].level!)} x2={plot.x(sample.distance)} y2={plot.y(sample.level)} stroke="#22d3ee" strokeWidth="2.5" /> : null)}
          {result.samples.slice(1).map((sample, i) => sample.bottomLevel != null && result.samples[i].bottomLevel != null ? <line key={`bottom-${i}`} x1={plot.x(result.samples[i].distance)} y1={plot.y(result.samples[i].bottomLevel!)} x2={plot.x(sample.distance)} y2={plot.y(sample.bottomLevel)} stroke="#94a3b8" strokeWidth="2.5" /> : null)}
          {result.points.filter((_, i) => i % Math.max(1, Math.ceil(result.points.length / 1500)) === 0).map((point, i) => <g key={i}>{point.bottom?.elevation != null && point.bottomDistance !== null && <><line x1={plot.x(point.distance)} y1={plot.y(point.elevation)} x2={plot.x(point.bottomDistance)} y2={plot.y(point.bottom.elevation)} stroke="#64748b" /><circle cx={plot.x(point.bottomDistance)} cy={plot.y(point.bottom.elevation)} r="3" fill="#94a3b8" /></>}<circle cx={plot.x(point.distance)} cy={plot.y(point.elevation)} r="4.5" fill={point.colour}><title>{point.id} · {point.status}</title></circle>{result.points.length <= 40 && <text x={plot.x(point.distance) + (point.distance / result.length > .8 ? -5 : 5)} y={plot.y(point.elevation) - 10} textAnchor={point.distance / result.length > .8 ? "end" : "start"} fontSize="11" fill="#f8fafc">{point.id} · {request.mode === "thickness" ? `${point.thicknessMm?.toFixed(0) ?? "—"} mm` : `${point.fslDifferenceMm?.toFixed(1) ?? "—"} mm`}</text>}</g>)}
          <text x="85" y="33" fontSize="12" fill="#cbd5e1">RL (m)</text><text x="505" y="459" fontSize="12" fill="#cbd5e1" textAnchor="middle">Distance along drawn line (m)</text>
        </svg>
        <p className="mt-3 text-xs leading-6 text-slate-400">Cyan line: FSL design. Coloured points: measured top/asbuilt status. Grey points / line: matched bottom survey or bottom TIN. DXF strings are plan reference layers. {result.points.length === 0 ? "No measured points fall inside this section corridor; widen the search distance or redraw the line." : `${result.points.length.toLocaleString()} measured point(s) in this section.`}</p>
        <div className="mt-5 flex flex-wrap gap-3">{(["pdf", "csv"] as const).map((format) => <button key={format} type="button" disabled={Boolean(busy)} onClick={() => void download(format)} className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-5 py-2.5 text-sm font-semibold text-cyan-100 disabled:opacity-50">{busy === format ? "Preparing…" : `Download section ${format.toUpperCase()}`}</button>)}</div>
        {prepared && <a href={prepared.url} download={prepared.fileName} className="mt-3 block text-sm text-cyan-300 underline">Download prepared section report</a>}
        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10"><table className="min-w-full text-left text-xs"><caption className="p-3 text-left text-slate-400">Showing {Math.min(500, result.points.length)} of {result.points.length} section points. CSV includes all.</caption><thead className="bg-slate-900"><tr>{["Point", "Distance (m)", "Off line (m)", "Chainage", "Asbuilt RL", "Bottom RL", "Thickness (mm)", "FSL RL", "FSL Δ (mm)", "Check status"].map((name) => <th key={name} className="whitespace-nowrap p-3">{name}</th>)}</tr></thead><tbody>{result.points.slice(0, 500).map((point, i) => <tr key={i} className="border-t border-white/5 text-slate-300">{[point.id, point.distance.toFixed(3), point.offLine.toFixed(3), point.chainage === null ? "—" : formatChainage(point.chainage), point.elevation.toFixed(3), point.bottom?.elevation?.toFixed(3) ?? "—", point.thicknessMm?.toFixed(1) ?? "—", point.fslLevel?.toFixed(3) ?? "—", point.fslDifferenceMm?.toFixed(1) ?? "—", point.status].map((value, index) => <td key={index} className="whitespace-nowrap p-3">{value}</td>)}</tr>)}</tbody></table></div>
      </>}
    </div>
  </dialog>
}
