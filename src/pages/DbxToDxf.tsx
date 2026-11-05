import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, Download, FileText, FolderOpen, Upload } from "lucide-react"
import PageSeo from "../components/PageSeo"
import DxfExportSettings from "../components/DxfExportSettings"
import type { DxfSettings } from "../components/DxfExportSettings"
import DbxPointPreview from "../components/DbxPointPreview"
import type { DbxComponent, DbxJob, DbxOptions, DbxPrepared } from "../lib/leicaDbx"
import type { NzHeightDatum } from "../lib/nzHeightModels"
import { makeDbxExample } from "../lib/dbxExample"
import { downloadReportBlob } from "../lib/surveyReports"
import { trackToolAction } from "../lib/toolUsage"

const field = "w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
const initialSettings: DxfSettings = { includePoint: true, includePointId: true, includeElevation: true, includeCode: false, layerByCode: true, textHeight: .4 }
const initialOptions: DbxOptions = { coordinateClass: "all", sourceHeightDatum: "unspecified", sourceGrid: "job", targetHeightDatum: "NZVD2016" }
const accepts = ".xcf,.x01,.x02,.x03,.x04,.x06,.x08,.x09,.x10,.x11,.x12,.x13,.x14,.x15,.x16,.x18,.x20,.x22,.x23,.x24,.x30,.x50,.m00"

export default function DbxToDxf() {
  const [job, setJob] = useState<DbxJob | null>(null), [prepared, setPrepared] = useState<DbxPrepared | null>(null)
  const [options, setOptions] = useState(initialOptions), [settings, setSettings] = useState(initialSettings)
  const [busy, setBusy] = useState(""), [error, setError] = useState("")
  const [mode, setMode] = useState<"3d" | "2d">("3d"), [code, setCode] = useState("all"), [search, setSearch] = useState("")
  const [download, setDownload] = useState<{ url: string; fileName: string } | null>(null)
  const worker = useRef<Worker | null>(null), generation = useRef(0)
  useEffect(() => () => { generation.current++; worker.current?.terminate() }, [])
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url) }, [download])
  const stop = () => { worker.current?.terminate(); worker.current = null }
  const cancel = () => { generation.current++; stop(); setBusy(""); setError("") }
  function task<T>(message: unknown, receive: (result: T) => void, transfer: Transferable[] = []) {
    const id = ++generation.current
    stop()
    try {
      const next = new Worker(new URL("../workers/dbx.worker.ts", import.meta.url), { type: "module" })
      worker.current = next
      next.onmessage = (event) => {
        if (id !== generation.current) return
        try {
          if (event.data.error) throw new Error(event.data.error)
          receive(event.data.result ?? event.data)
        } catch (caught) { setError(caught instanceof Error ? caught.message : "The DBX operation could not be completed.") }
        setBusy(""); stop()
      }
      next.onerror = () => { if (id === generation.current) { setError("The DBX worker could not finish. Try a smaller job or a calculated point export."); setBusy(""); stop() } }
      next.postMessage(message, transfer)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The DBX worker could not start."); setBusy(""); stop() }
  }
  function readComponents(components: DbxComponent[], demo = false) {
    setBusy("Reading the DBX job…"); setError(""); setJob(null); setPrepared(null); setDownload(null)
    task<DbxJob>({ type: "parse", components }, (next) => {
      setJob(next); setOptions(demo ? { ...initialOptions, sourceGrid: "NZTM2000", sourceHeightDatum: "NZVD2016" } : initialOptions)
      setCode("all"); setSearch(""); setMode("3d")
      trackToolAction("dbx_dxf", demo ? "demo_open" : "import_complete", { source: demo ? "demo" : "upload", format: "dbx" })
    }, components.flatMap((f) => f.buffer ? [f.buffer] : []))
  }
  async function openFiles(files: FileList | null) {
    if (!files?.length) return
    const selected = Array.from(files), id = ++generation.current
    stop(); setBusy("Opening the selected files…"); setError(""); setJob(null); setPrepared(null); setDownload(null)
    try {
      const relevant = selected.filter((f) => /\.(x\d\d|xcf|m\d\d)$/i.test(f.name))
      if (!relevant.length || relevant.length > 128 || relevant.reduce((n, f) => n + f.size, 0) > 200 * 1024 * 1024) throw new Error("Choose one DBX job containing up to 128 files and 200 MB.")
      const components = await Promise.all(relevant.map(async (f) => ({ name: f.name, size: f.size, buffer: /\.(xcf|x01|x06|x14|x18)$/i.test(f.name) ? await f.arrayBuffer() : undefined })))
      if (id === generation.current) readComponents(components)
    } catch (caught) { if (id === generation.current) { setBusy(""); setError(caught instanceof Error ? caught.message : "The selected files could not be opened.") } }
  }
  function changeOption<K extends keyof DbxOptions>(key: K, value: DbxOptions[K]) { setOptions((old) => ({ ...old, [key]: value })); setPrepared(null); setDownload(null); setError("") }
  function prepare() {
    if (!job || busy) return
    setBusy(job.source === "geographic" ? "Preparing coordinates and checking the LINZ height models…" : "Preparing the selected point positions…"); setError(""); setPrepared(null); setDownload(null)
    task<DbxPrepared>({ type: "prepare", job, options }, (result) => { setPrepared(result); setCode("all"); setSearch("") })
  }
  const classes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of job?.records ?? []) counts.set(p.coordinateClass, (counts.get(p.coordinateClass) ?? 0) + 1)
    return [...counts].sort(([a], [b]) => Number(a) - Number(b))
  }, [job])
  const uniquePointCount = useMemo(() => new Set(job?.records.map((p) => p.id) ?? []).size, [job])
  const codes = useMemo(() => [...new Set(prepared?.points.map((p) => p.code) ?? [])].sort(), [prepared])
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return prepared?.points.filter((p) => (code === "all" || "code:" + p.code === code) && (!term || p.id.toLowerCase().includes(term) || p.code.toLowerCase().includes(term))) ?? []
  }, [prepared, code, search])
  const canDraw = settings.includePoint || settings.includePointId || settings.includeElevation || settings.includeCode && filtered.some((p) => p.code)
  function exportFile(format: "dxf" | "csv") {
    if (!job || !prepared || busy || !filtered.length || format === "dxf" && !canDraw) return
    setBusy(`Preparing ${format.toUpperCase()}…`); setError(""); setDownload(null)
    task<{ buffer: ArrayBuffer }>({ type: "export", job, prepared: { ...prepared, points: filtered }, settings, mode, format }, (result) => {
      const base = job.jobName.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 90) || "leica-job"
      const datum = options.targetHeightDatum === "preserve" ? options.sourceHeightDatum === "unspecified" ? "SOURCE_RL" : options.sourceHeightDatum : options.targetHeightDatum
      const name = `${base}_${datum}${format === "dxf" && mode === "2d" ? "_2D" : ""}.${format}`
      setDownload(downloadReportBlob(result.buffer, format === "dxf" ? "application/dxf" : "text/csv;charset=utf-8", name, true))
      trackToolAction("dbx_dxf", "export_prepared", { format })
    })
  }

  return <div className="relative z-10 min-h-screen px-5 py-16 md:px-8 md:py-24">
    <PageSeo title="Leica DBX to DXF Converter | SurveyTool.io" description="Open a Leica DBX job locally, preview stored points and codes, and export DXF or CSV. Supports NZTM2000 GNSS positions with NZVD2016 and Auckland 1946 heights." canonicalUrl="https://www.surveytool.io/tools/dbx-to-dxf" />
    <div className="mx-auto max-w-6xl">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-cyan-300"><ArrowLeft size={18} />Back to home</Link>
      <header className="my-10"><p className="text-sm font-semibold uppercase tracking-[.3em] text-cyan-300">SurveyTool · Field files</p><h1 className="mt-4 text-4xl font-bold md:text-5xl">Leica DBX → DXF</h1><p className="mt-4 max-w-3xl leading-7 text-slate-400">Open the files for one Leica job together. Review stored point positions and feature codes, choose the output height datum, and prepare a CAD drawing on this device.</p></header>
      <section className="rounded-3xl border border-white/15 bg-white/5 p-6 md:p-8">
        <h2 className="text-xl font-semibold">1. Open one DBX job</h2>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <label className={`inline-flex items-center gap-3 rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 ${busy ? "opacity-50" : "cursor-pointer hover:bg-cyan-300"}`}><Upload size={20} />Choose DBX files<input type="file" multiple accept={accepts} aria-label="Leica DBX job files" disabled={Boolean(busy)} className="sr-only" onChange={(e) => { void openFiles(e.target.files); e.target.value = "" }} /></label>
          <label className={`inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-slate-300 ${busy ? "opacity-50" : "cursor-pointer"}`}><FolderOpen size={18} />Choose folder<input type="file" multiple {...{ webkitdirectory: "", directory: "" }} aria-label="Leica DBX job folder" disabled={Boolean(busy)} className="sr-only" onChange={(e) => { void openFiles(e.target.files); e.target.value = "" }} /></label>
          <button type="button" disabled={Boolean(busy)} onClick={() => readComponents(makeDbxExample(), true)} className="rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-slate-300 disabled:opacity-50">Load example</button>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-400">Include the matching .XCF, .X01 and associated .X files. Choose one job only, up to 200 MB. Files stay on this device; the original database is never changed. The example is a synthetic NZVD2016 grid job.</p>
        <p className="mt-3 text-xs leading-6 text-slate-500">Initial DBX support covers the validated ALI database layout, stored grid coordinates, and NZTM2000 GNSS jobs with the supported NZGD2000 definition. Other variants stop with an explanation.</p>
      </section>
      {busy && <div role="status" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-4 text-cyan-100"><span>{busy}</span><button type="button" onClick={cancel} className="text-sm underline">Cancel</button></div>}
      {error && <p role="alert" className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 leading-6 text-amber-200">{error}</p>}
      {job && <>
        <section className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-xl font-semibold">2. Check the imported job</h2><p className="mt-3 break-words text-cyan-200">{job.jobName}</p>
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">{[["Stored positions", job.records.length.toLocaleString()], ["Point names", uniquePointCount.toLocaleString()], ["Source coordinates", job.source === "geographic" ? "GNSS latitude / longitude / ellipsoidal height" : "Stored grid North / East / RL"]].map(([name, value]) => <div key={name} className="rounded-xl bg-slate-950/50 p-4"><dt className="text-slate-400">{name}</dt><dd className="mt-2 font-semibold">{value}</dd></div>)}</dl>
          <p className="mt-4 break-words text-xs text-slate-400">Components: {job.components.join(", ")}</p>
          {job.warnings.map((s) => <p key={s} className="mt-3 text-sm leading-6 text-amber-200">{s}</p>)}
        </section>
        <section className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-xl font-semibold">3. Choose positions and height datum</h2>
          <fieldset disabled={Boolean(busy)} className="mt-5 grid gap-5 disabled:opacity-60 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-slate-300"><span>Stored coordinate class</span><select className={field} aria-label="DBX coordinate class" value={options.coordinateClass} onChange={(e) => changeOption("coordinateClass", e.target.value)}><option value="all">All classes · omit duplicate point names</option>{classes.map(([c, count]) => <option key={c} value={c}>Class {c} · {count.toLocaleString()} stored positions</option>)}</select></label>
            <label className="space-y-2 text-sm text-slate-300"><span>Output height datum</span><select className={field} aria-label="DBX output height datum" value={options.targetHeightDatum} onChange={(e) => changeOption("targetHeightDatum", e.target.value as DbxOptions["targetHeightDatum"])}><option value="NZVD2016">NZVD2016 · new output default</option><option value="AUCK46">Auckland 1946 (AUCK46)</option>{job.source === "grid" && <option value="preserve">Preserve stored grid RLs</option>}</select></label>
            {job.source === "grid" && <><label className="space-y-2 text-sm text-slate-300"><span>Source grid height datum</span><select className={field} aria-label="DBX source height datum" value={options.sourceHeightDatum} onChange={(e) => changeOption("sourceHeightDatum", e.target.value as NzHeightDatum | "unspecified")}><option value="unspecified">Unspecified</option><option value="AUCK46">Auckland 1946 (AUCK46)</option><option value="NZVD2016">NZVD2016</option></select></label><label className="space-y-2 text-sm text-slate-300"><span>Source horizontal grid</span><select className={field} aria-label="DBX source grid" value={options.sourceGrid} onChange={(e) => changeOption("sourceGrid", e.target.value as DbxOptions["sourceGrid"])}><option value="job">Job grid · unspecified</option><option value="NZTM2000">I confirm these coordinates are NZTM2000</option></select></label></>}
          </fieldset>
          {job.source === "geographic" ? <p className="mt-4 text-sm leading-6 text-slate-300">Horizontal output: NZTM2000. Stored heights are ellipsoidal. The job references <span className="font-semibold">{job.geoidName}</span>{job.instrumentHeightDatum !== "unspecified" ? ` (${job.instrumentHeightDatum === "AUCK46" ? "Auckland 1946" : "NZVD2016"})` : ""}. Output RLs are calculated with the published LINZ models for your selected datum.</p> : <p className="mt-4 text-sm leading-6 text-slate-400">Confirm source datums from the project control information. Auckland 1946 ↔ NZVD2016 conversion also needs NZTM2000 positions. Preserving stored RLs applies no height conversion.</p>}
          <p className="mt-3 text-xs leading-6 text-slate-400">Each point must have one selected position. Duplicate names are omitted until a coordinate class resolves them. Classes retain their numeric DBX values. Height models use a position-dependent correction and stop outside valid coverage.</p>
          <button type="button" onClick={prepare} disabled={Boolean(busy)} className="mt-5 rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 disabled:opacity-40">Prepare points</button>
          <p className="mt-3 text-xs leading-6 text-slate-500">GNSS height conversion downloads an 8.5 MB LINZ model on first use. Verified models are cached for reuse when browser storage is available. Historic controller models can differ slightly from the current published grid.</p>
        </section>
      </>}
      {prepared && <section className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-xl font-semibold">4. Review and export</h2>
        <p className="mt-3 text-lg font-semibold text-cyan-200">{prepared.grid} · {prepared.heightDatum}</p><p className="mt-2 text-sm text-slate-400">{prepared.conversion}{prepared.models.length ? ` · ${prepared.models.join(" + ")}` : ""}</p>
        {prepared.omittedCount > 0 && <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/5 p-4 text-sm text-amber-200"><p>{prepared.omittedCount} coordinate records omitted because of duplicate point names. Choose a stored coordinate class above to resolve them.</p><details className="mt-2"><summary className="cursor-pointer">Show omitted points</summary><ul className="mt-2 space-y-2">{prepared.issues.slice(0, 100).map((s) => <li key={s}>{s}</li>)}</ul></details></div>}
        <fieldset disabled={Boolean(busy)} className="mt-5 grid gap-4 disabled:opacity-60 sm:grid-cols-2"><label className="space-y-2 text-sm text-slate-300"><span>Feature code</span><select className={field} aria-label="DBX feature code" value={code} onChange={(e) => { setCode(e.target.value); setDownload(null) }}><option value="all">All codes</option>{codes.map((s) => <option key={s} value={"code:" + s}>{s || "Blank code"}</option>)}</select></label><label className="space-y-2 text-sm text-slate-300"><span>Search points</span><input className={field} aria-label="Search DBX points" placeholder="Point ID or code" value={search} onChange={(e) => { setSearch(e.target.value); setDownload(null) }} /></label></fieldset>
        <p role="status" className="mt-4 text-sm text-cyan-200">{filtered.length.toLocaleString()} of {prepared.points.length.toLocaleString()} prepared points selected</p><DbxPointPreview points={filtered} grid={prepared.grid} />
        <fieldset disabled={Boolean(busy)} className="mt-6 disabled:opacity-60"><label className="block max-w-md space-y-2 text-sm text-slate-300"><span>Drawing elevations</span><select className={field} aria-label="DBX drawing elevations" value={mode} onChange={(e) => { setMode(e.target.value as "3d" | "2d"); setDownload(null) }}><option value="3d">3D · use output RLs</option><option value="2d">2D · flatten drawing to Z = 0</option></select></label><div className="mt-5"><DxfExportSettings settings={settings} onChange={(s) => { setSettings(s); setDownload(null) }} hasCode={filtered.some((p) => p.code)} hasElevation={true} /></div></fieldset>
        <p className="mt-4 text-sm leading-6 text-slate-400">DXF: points and labels in metres, with layers by feature code. The CSV includes output RLs and datum, plus the original stored coordinates and heights for checking. No linework or curves are created.</p>
        <div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled={Boolean(busy) || !filtered.length || !canDraw} onClick={() => exportFile("dxf")} className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 disabled:opacity-40"><Download size={18} />Download DXF</button><button type="button" disabled={Boolean(busy) || !filtered.length} onClick={() => exportFile("csv")} className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-slate-200 disabled:opacity-40"><FileText size={18} />Download point CSV</button></div>
        {download && <a href={download.url} download={download.fileName} className="mt-4 block break-words text-sm text-cyan-300 underline">Download prepared file · {download.fileName}</a>}
      </section>}
      <p className="mt-8 text-sm leading-6 text-slate-500">Height models: <a href="https://github.com/linz/proj-datumgrid-nz" target="_blank" rel="noreferrer" className="text-slate-300 underline">Land Information New Zealand, CC BY 4.0</a>. Choose the height datum specified for the project. <Link to="/tools/jxl-to-dxf" className="text-slate-300 underline">Trimble JXL → DXF</Link> is available separately.</p>
    </div>
  </div>
}
