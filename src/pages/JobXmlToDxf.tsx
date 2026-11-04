import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, Download, FileText, Upload } from "lucide-react"
import PageSeo from "../components/PageSeo"
import DxfExportSettings from "../components/DxfExportSettings"
import type { DxfSettings } from "../components/DxfExportSettings"
import type { JobXmlDocument, JobXmlPoint } from "../lib/jobXml"
import { downloadReportBlob } from "../lib/surveyReports"
import { trackToolAction } from "../lib/toolUsage"

const maximumBytes = 50 * 1024 * 1024
const field = "w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
const initialSettings: DxfSettings = { includePoint: true, includePointId: true, includeElevation: false, includeCode: false, layerByCode: true, textHeight: .4 }
const all = "__all__"

export default function JobXmlToDxf() {
  const [document, setDocument] = useState<JobXmlDocument | null>(null)
  const [busy, setBusy] = useState(""), [error, setError] = useState("")
  const [settings, setSettings] = useState(initialSettings)
  const [mode, setMode] = useState<"3d" | "2d">("3d")
  const [classification, setClassification] = useState(all), [code, setCode] = useState(all), [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const [prepared, setPrepared] = useState<{ url: string; fileName: string } | null>(null)
  const worker = useRef<Worker | null>(null), generation = useRef(0)
  useEffect(() => () => { generation.current++; worker.current?.terminate() }, [])
  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.url) }, [prepared])
  const stop = () => { worker.current?.terminate(); worker.current = null }

  async function openFile(file: File, source: "upload" | "demo" = "upload") {
    const requestId = ++generation.current
    stop(); setBusy("reading"); setError(""); setDocument(null); setPrepared(null)
    try {
      if (!/\.(jxl|xml)$/i.test(file.name)) throw new Error("Choose a Trimble .jxl or JobXML .xml file. Direct Leica DBX import is not yet available.")
      if (file.size > maximumBytes) throw new Error("Choose a JobXML file smaller than 50 MB.")
      const buffer = await file.arrayBuffer()
      if (requestId !== generation.current) return
      const task = new Worker(new URL("../workers/jobXml.worker.ts", import.meta.url), { type: "module" })
      worker.current = task
      task.onmessage = (event) => {
        if (requestId !== generation.current) return
        if (event.data.error) setError(event.data.error)
        else {
          setDocument(event.data.result); setClassification(all); setCode(all); setSearch(""); setPage(0); setMode("3d")
          trackToolAction("jxl_dxf", source === "demo" ? "demo_open" : "import_complete", { source, format: "jxl" })
        }
        setBusy(""); stop()
      }
      task.onerror = () => { if (requestId === generation.current) { setError("The job could not be read. Try a smaller JobXML export."); setBusy(""); stop() } }
      task.postMessage({ type: "parse", buffer, fileName: file.name }, [buffer])
    } catch (caught) {
      if (requestId === generation.current) { setError(caught instanceof Error ? caught.message : "The job could not be read."); setBusy(""); stop() }
    }
  }
  async function demo() {
    const requestId = ++generation.current
    stop(); setError(""); setBusy("demo")
    try {
      const response = await fetch("/examples/jobxml-points.jxl")
      if (!response.ok) throw new Error("The sample is unavailable. Choose a local JXL file.")
      const bytes = await response.arrayBuffer()
      if (requestId !== generation.current) return
      await openFile(new File([bytes], "jobxml-example.jxl"), "demo")
    } catch (caught) { if (requestId === generation.current) { setBusy(""); setError(caught instanceof Error ? caught.message : "The sample could not be opened.") } }
  }
  const classifications = useMemo(() => [...new Set(document?.points.map((point) => point.classification) ?? [])].sort(), [document])
  const codes = useMemo(() => [...new Set(document?.points.map((point) => point.code) ?? [])].sort(), [document])
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return document?.points.filter((point) => (classification === all || "value:" + point.classification === classification) && (code === all || "value:" + point.code === code) && (!term || [point.id, point.code, point.method, point.classification].some((value) => value.toLowerCase().includes(term)))) ?? []
  }, [document, classification, code, search])
  const missingHeights = useMemo(() => filtered.reduce((sum, point) => sum + (point.elevation === null ? 1 : 0), 0), [filtered])
  const eligibleCount = filtered.length - (mode === "3d" ? missingHeights : 0)
  const contentSelected = settings.includePoint || settings.includePointId || settings.includeCode && filtered.some((point) => point.code) || settings.includeElevation && filtered.some((point) => point.elevation !== null)
  const pageCount = Math.max(1, Math.ceil(filtered.length / 200))
  const currentPage = Math.min(page, pageCount - 1)

  function exportFile(format: "dxf" | "csv") {
    if (!document || busy || !filtered.length || format === "dxf" && (!eligibleCount || !contentSelected)) return
    const requestId = ++generation.current
    stop(); setBusy(format); setError(""); setPrepared(null)
    try {
      const task = new Worker(new URL("../workers/jobXml.worker.ts", import.meta.url), { type: "module" })
      worker.current = task
      task.onmessage = (event) => {
        if (requestId !== generation.current) return
        try {
          if (event.data.error) throw new Error(event.data.error)
          const base = document.fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 100) || "jobxml-points"
          setPrepared(downloadReportBlob(event.data.buffer, format === "dxf" ? "application/dxf" : "text/csv;charset=utf-8", `${base}.${format}`, true))
          trackToolAction("jxl_dxf", "export_prepared", { format })
        } catch (caught) { setError(caught instanceof Error ? caught.message : "The export could not be prepared.") }
        setBusy(""); stop()
      }
      task.onerror = () => { if (requestId === generation.current) { setError("The export could not be created. Filter to a smaller set of points and try again."); setBusy(""); stop() } }
      task.postMessage({ type: "export", format, points: filtered, settings, mode })
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The export could not be started."); setBusy(""); stop() }
  }
  function changeFilter(setter: (value: string) => void, value: string) { setter(value); setPage(0); setPrepared(null) }

  return <div className="relative z-10 min-h-screen px-5 py-16 md:px-8 md:py-24">
    <PageSeo title="Trimble JXL to DXF Converter | SurveyTool.io" description="Convert Trimble JobXML calculated grid points to DXF and CSV directly in your browser. Preview coordinates, filter point classes and export feature-code layers." canonicalUrl="https://www.surveytool.io/tools/jxl-to-dxf" />
    <div className="mx-auto max-w-6xl">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-cyan-300"><ArrowLeft size={18} />Back to home</Link>
      <header className="my-10"><p className="text-sm font-semibold uppercase tracking-[.3em] text-cyan-300">SurveyTool · Field files</p><h1 className="mt-4 text-4xl font-bold md:text-5xl">Trimble JXL → DXF</h1><p className="mt-4 max-w-3xl leading-7 text-slate-400">Turn calculated JobXML grid points into a CAD drawing with point numbers, RL labels and feature-code layers. Files are processed on this device.</p></header>
      <section className="rounded-3xl border border-white/15 bg-white/5 p-6 md:p-8">
        <h2 className="text-xl font-semibold">1. Open your JobXML file</h2>
        <div className="mt-5 flex flex-wrap items-center gap-4"><label className={`inline-flex items-center gap-3 rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 ${busy ? "opacity-50" : "cursor-pointer hover:bg-cyan-300"}`}><Upload size={20} />Choose JXL file<input aria-label="Trimble JobXML file" type="file" accept=".jxl,.xml,application/xml,text/xml" disabled={Boolean(busy)} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void openFile(file) }} /></label><button type="button" onClick={() => void demo()} disabled={Boolean(busy)} className="rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-slate-300 disabled:opacity-50">Load example</button><span className="text-xs text-slate-400">JobXML 5.x / 6.x · Up to 50 MB</span></div>
        <p className="mt-4 text-sm leading-6 text-slate-400">Uses the job’s calculated grid coordinates in metres. Coordinate values and heights keep their source grid and datum. Raw observations remain in your original JXL for later adjustment.</p>
      </section>
      {busy && <p role="status" className="mt-5 rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-4 text-cyan-100">{busy === "reading" || busy === "demo" ? "Reading JobXML…" : `Preparing ${busy.toUpperCase()}…`}</p>}
      {error && <p role="alert" className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 leading-6 text-amber-200">{error}</p>}
      {document && <>
        <section className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6"><h2 className="text-xl font-semibold">2. Check the imported job</h2><p className="mt-2 break-words text-sm text-cyan-200">{document.fileName} · JobXML {document.version}</p><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">{[["Grid points", document.points.length.toLocaleString()], ["Field-book point records", document.fieldBookPointCount.toLocaleString()], ["Coordinate system", document.systemName], ["Grid / zone", document.gridName]].map(([name, value]) => <div key={name} className="rounded-xl bg-slate-950/50 p-4"><dt className="text-slate-400">{name}</dt><dd className="mt-2 break-words font-semibold text-white">{value}</dd></div>)}</dl><p className="mt-4 text-xs leading-6 text-slate-400">The grid points are the job’s selected calculated positions. Field-book records can include repeat observations and station setups; they are counted for reference.</p>
          {document.warnings.map((warning) => <p key={warning} className="mt-3 text-sm leading-6 text-amber-200">{warning}</p>)}
          {document.issues.length > 0 && <details className="mt-4 rounded-xl border border-amber-400/20 p-4 text-sm"><summary className="cursor-pointer text-amber-200">Import issues · {document.omittedCount.toLocaleString()} omitted record(s)</summary><ul className="mt-3 space-y-2 text-slate-300">{document.issues.slice(0, 100).map((issue, i) => <li key={i}>{issue.point}: {issue.reason}</li>)}</ul>{document.issues.length > 100 && <p className="mt-3 text-slate-400">Showing the first 100 issue entries.</p>}</details>}
        </section>
        <section className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6"><h2 className="text-xl font-semibold">3. Select points</h2><div className="mt-5 grid gap-4 sm:grid-cols-3"><label className="space-y-2 text-sm text-slate-300"><span>Point classification</span><select aria-label="JXL point classification" value={classification} disabled={Boolean(busy)} onChange={(event) => changeFilter(setClassification, event.target.value)} className={field}><option value={all}>All classifications</option>{classifications.map((value) => <option key={value} value={"value:" + value}>{value}</option>)}</select></label><label className="space-y-2 text-sm text-slate-300"><span>Feature code</span><select aria-label="JXL feature code" value={code} disabled={Boolean(busy)} onChange={(event) => changeFilter(setCode, event.target.value)} className={field}><option value={all}>All feature codes</option>{codes.map((value) => <option key={value} value={"value:" + value}>{value || "Blank code"}</option>)}</select></label><label className="space-y-2 text-sm text-slate-300"><span>Search points</span><input aria-label="Search JXL points" value={search} disabled={Boolean(busy)} onChange={(event) => changeFilter(setSearch, event.target.value)} placeholder="Point number or code" className={field} /></label></div><p role="status" className="mt-4 text-sm text-cyan-200">{filtered.length.toLocaleString()} of {document.points.length.toLocaleString()} grid points selected</p><JobXmlPlan points={filtered} />
          <div className="mt-5 overflow-x-auto rounded-xl border border-white/10"><table className="min-w-full text-left text-xs"><caption className="p-3 text-left text-slate-400">Coordinate preview · metres · {filtered.length ? currentPage * 200 + 1 : 0}–{Math.min(filtered.length, (currentPage + 1) * 200)} of {filtered.length.toLocaleString()} selected points</caption><thead className="bg-slate-950"><tr>{["Point", "Easting", "Northing", "RL", "Feature code", "Classification", "Method"].map((name) => <th key={name} className="whitespace-nowrap p-3">{name}</th>)}</tr></thead><tbody>{filtered.slice(currentPage * 200, (currentPage + 1) * 200).map((point) => <tr key={point.id} className="border-t border-white/5 text-slate-300">{[point.id, String(point.easting), String(point.northing), point.elevation === null ? "Missing RL" : String(point.elevation), point.code, point.classification, point.method].map((value, i) => <td key={i} className="whitespace-nowrap p-3">{value}</td>)}</tr>)}</tbody></table></div>{pageCount > 1 && <div className="mt-3 flex items-center gap-4 text-sm"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded-lg border border-white/15 px-4 py-2 disabled:opacity-40">Previous</button><span className="text-slate-400">Page {currentPage + 1} of {pageCount}</span><button type="button" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)} className="rounded-lg border border-white/15 px-4 py-2 disabled:opacity-40">Next</button></div>}
        </section>
        <section className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6"><h2 className="text-xl font-semibold">4. Export the drawing</h2><label className="mt-5 block max-w-md space-y-2 text-sm text-slate-300"><span>Drawing elevations</span><select aria-label="JXL drawing elevations" value={mode} disabled={Boolean(busy)} onChange={(event) => { setMode(event.target.value as "3d" | "2d"); setPrepared(null) }} className={field}><option value="3d">3D · Use calculated point RLs</option><option value="2d">2D · Flatten drawing to Z = 0</option></select></label>{mode === "3d" && missingHeights > 0 && <p className="mt-3 text-sm text-amber-200">{missingHeights.toLocaleString()} selected point(s) without an RL will be excluded from the 3D DXF. Choose 2D to include them.</p>}<fieldset disabled={Boolean(busy)} className="mt-5 disabled:opacity-60"><DxfExportSettings settings={settings} onChange={(next) => { setSettings(next); setPrepared(null) }} hasElevation={filtered.some((point) => point.elevation !== null)} hasCode={filtered.some((point) => point.code.length > 0)} /></fieldset><p className="mt-4 text-sm text-slate-400">DXF: {eligibleCount.toLocaleString()} eligible point(s), in metres. Source point CSV: {filtered.length.toLocaleString()} selected point(s), with original RLs. Points and labels are exported; connecting strings and curves are a later addition.</p>
          <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={() => exportFile("dxf")} disabled={Boolean(busy) || !eligibleCount || !contentSelected} className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 disabled:opacity-40"><Download size={18} />Download DXF</button><button type="button" onClick={() => exportFile("csv")} disabled={Boolean(busy) || !filtered.length} className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-slate-200 disabled:opacity-40"><FileText size={18} />Download source point CSV</button></div>{prepared && <a href={prepared.url} download={prepared.fileName} className="mt-4 block break-words text-sm text-cyan-300 underline">Download prepared file · {prepared.fileName}</a>}
        </section>
      </>}
      <p className="mt-8 text-sm leading-6 text-slate-500">Leica DBX import is planned. This converter currently accepts Trimble JobXML files with calculated grid points. <Link to="/tools/csv-to-dxf" className="text-slate-300 underline">Use CSV / TXT → DXF</Link> for point text files.</p>
    </div>
  </div>
}

function JobXmlPlan({ points }: { points: JobXmlPoint[] }) {
  const plan = useMemo(() => {
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity
    for (const point of points) { minE = Math.min(minE, point.easting); maxE = Math.max(maxE, point.easting); minN = Math.min(minN, point.northing); maxN = Math.max(maxN, point.northing) }
    const scale = Math.min(900 / Math.max(maxE - minE, 1), 280 / Math.max(maxN - minN, 1))
    return { minE, maxN, scale, points: points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / 2000)) === 0) }
  }, [points])
  if (!points.length) return null
  return <svg viewBox="0 0 1000 360" role="img" aria-label="JXL grid point plan preview" className="mt-5 block w-full rounded-xl border border-white/10 bg-slate-950/60"><text x="30" y="25" fontSize="13" fill="#94a3b8">N ↑ · E → · Source grid · {plan.points.length.toLocaleString()} of {points.length.toLocaleString()} points drawn</text>{plan.points.map((point) => <circle key={point.id} cx={50 + (point.easting - plan.minE) * plan.scale} cy={55 + (plan.maxN - point.northing) * plan.scale} r="4" fill={point.classification === "Stakeout" ? "#fb923c" : "#22d3ee"}><title>{point.id} · {point.code} · RL {point.elevation ?? "missing"}</title></circle>)}</svg>
}
