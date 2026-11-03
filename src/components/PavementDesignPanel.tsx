import { useEffect, useMemo, useRef, useState } from "react"
import type { LandXmlDocument } from "../lib/landxml"
import type { SurveyPoint } from "../lib/surveyPoints"
import type { MapCrs, MapProjectSettings, Basemap } from "../lib/mapCoordinates"
import { loadCrsCatalogue } from "../lib/mapCoordinates"
import { pavementMapCoordinateError, pavementReportLines, withPavementDxf } from "../lib/pavementMap"
import type { PavementWorkspaceState } from "../lib/pavementMap"
import type { PavementMeasurement } from "../lib/pavementSection"
import PavementFieldMap from "./PavementFieldMap"
import { horizontalAlignment } from "../lib/alignmentGeometry"
import { alignmentChainageMarkers, formatChainage } from "../lib/alignmentStationing"
import { parseLandXmlFile } from "../lib/landxmlAsync"
import { pavementDesignMapGeometry, pavementDesignReport, pavementDesignUnitError, pavementLevelColours } from "../lib/pavementDesign"
import type { PavementDesignResult, PavementDesignState } from "../lib/pavementDesign"
import { trackToolAction } from "../lib/toolUsage"
import CrsPicker from "./CrsPicker"
import ReportDownloads from "./ReportDownloads"

const inputClass = "mt-2 w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-cyan-400"
const buttonClass = "rounded-full border border-cyan-300/30 bg-cyan-300/5 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/15 disabled:opacity-40"
type MeasuredFile = { name: string; points: SurveyPoint[]; warnings: string[] }

export default function PavementDesignPanel({ state, onChange, measured, mapSettings, onMapChange, workspace, onWorkspaceChange }: {
  workspace: PavementWorkspaceState
  onWorkspaceChange: (patch: Partial<PavementWorkspaceState>) => void
  state: PavementDesignState
  onChange: (state: PavementDesignState) => void
  measured: MeasuredFile | null
  mapSettings: MapProjectSettings
  onMapChange: (settings: MapProjectSettings) => void
}) {
  const [catalogue, setCatalogue] = useState<MapCrs[]>([])
  const [catalogueError, setCatalogueError] = useState("")
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState({ alignment: "", fsl: "" })
  const parsers = useRef<{ alignment?: AbortController; fsl?: AbortController }>({})
  const activeWorker = useRef<Worker | null>(null)
  const latestState = useRef(state)
  latestState.current = state
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const alignment = state.alignmentDocument?.alignments.find((item) => item.name === state.alignmentName)
  const surface = state.fslDocument?.surfaces.find((item) => item.name === state.surfaceName)
  const request = useMemo(() => measured && surface ? { points: measured.points, surface, alignment, lowerMm: state.lowerMm, upperMm: state.upperMm } : null, [measured, surface, alignment, state.lowerMm, state.upperMm])
  const [completed, setCompleted] = useState<{ request: typeof request; crs: string; result: PavementDesignResult } | null>(null)
  const result = completed?.request === request && completed?.crs === mapSettings.defaultCrs && state.confirmed ? completed.result : null
  const crs = catalogue.find((entry) => entry.code === mapSettings.defaultCrs)
  const coordinateError = crs ? pavementMapCoordinateError(crs) : ""
  const unitError = pavementDesignUnitError(state.fslDocument) || pavementDesignUnitError(state.alignmentDocument)
  const alignmentPreview = useMemo(() => {
    if (!alignment) return { alignment: null, error: "" }
    try { return { alignment: horizontalAlignment(alignment).preview(), error: "" } }
    catch (error) { return { alignment: null, error: error instanceof Error ? error.message : "This alignment could not be stationed." } }
  }, [alignment])
  const mapDocument = useMemo<LandXmlDocument | undefined>(() => {
    const base = state.fslDocument ?? state.alignmentDocument
    return base ? { ...base, surfaces: surface ? [surface] : [], alignments: alignmentPreview.alignment ? [alignmentPreview.alignment] : [], cogoPoints: [] } : undefined
  }, [state.fslDocument, state.alignmentDocument, surface, alignmentPreview.alignment])
  const markers = useMemo(() => {
    try { return alignment ? alignmentChainageMarkers(alignment, state.labelInterval) : { markers: [], interval: state.labelInterval } }
    catch { return { markers: [], interval: state.labelInterval } }
  }, [alignment, state.labelInterval])
  const geometry = useMemo(() => pavementDesignMapGeometry(measured?.points ?? [], result), [measured, result])
  const warnings = [...(measured?.warnings ?? []), ...(state.alignmentDocument?.warnings ?? []), ...(state.fslDocument?.warnings ?? [])]
  const sectionPoints = useMemo<PavementMeasurement[]>(() => result ? result.rows.map((row) => ({ ...row, colour: pavementLevelColours[row.status] })) : (measured?.points ?? []).map((point) => ({ ...point, colour: "#22d3ee", status: "NOT ASSESSED" })), [result, measured])
  const report = useMemo(() => {
    if (!result || !measured) return null
    const base = pavementDesignReport(result, state, measured.name, mapSettings.defaultCrs, [...measured.warnings, ...(state.alignmentDocument?.warnings ?? []), ...(state.fslDocument?.warnings ?? [])])
    const overlay = withPavementDxf({ name: "Reference", format: "DXF", points: [], lines: [], polygons: [], warnings: [] }, workspace.overlays, workspace.hiddenLayers)
    return { ...base, metadata: [...base.metadata, ["DXF reference files", workspace.overlays.map((layer) => layer.name).join("; ") || "None"] as [string, string]], plot: base.plot ? { ...base.plot, lines: pavementReportLines(overlay) } : undefined }
  }, [result, measured, state, mapSettings.defaultCrs, workspace.overlays, workspace.hiddenLayers])
  const summary = useMemo(() => {
    let assessed = 0, passed = 0, beyondEnds = 0
    for (const row of result?.rows ?? []) {
      if (row.differenceMm !== null) assessed++
      if (row.status === "PASS") passed++
      if (row.stationStatus === "BEFORE_START" || row.stationStatus === "AFTER_END") beyondEnds++
    }
    return { assessed, passed, beyondEnds }
  }, [result])
  const ready = Boolean(request && state.confirmed && !unitError && !coordinateError && !alignmentPreview.error && (!state.alignmentDocument || alignment) && !loading.alignment && !loading.fsl)

  useEffect(() => {
    let active = true
    setCatalogueError("")
    loadCrsCatalogue().then((value) => { if (active) setCatalogue(value) }).catch(() => { if (active) setCatalogueError("The coordinate-system catalogue could not load. Retry to choose a map background.") })
    return () => { active = false }
  }, [retry])
  useEffect(() => {
    activeWorker.current?.terminate(); activeWorker.current = null
    setBusy(false); setProgress(0); setCompleted(null); setError("")
    return () => { activeWorker.current?.terminate(); activeWorker.current = null }
  }, [request, mapSettings.defaultCrs, state.confirmed])
  // A project restore/reset must cancel a parser for an older file as well.
  const previousDocuments = useRef([state.alignmentDocument, state.fslDocument])
  useEffect(() => {
    for (const [index, role] of (["alignment", "fsl"] as const).entries()) {
      const doc = role === "alignment" ? state.alignmentDocument : state.fslDocument
      if (doc !== previousDocuments.current[index]) { parsers.current[role]?.abort(); delete parsers.current[role]; setLoading((value) => ({ ...value, [role]: "" })) }
    }
    previousDocuments.current = [state.alignmentDocument, state.fslDocument]
  }, [state.alignmentDocument, state.fslDocument])
  useEffect(() => () => { parsers.current.alignment?.abort(); parsers.current.fsl?.abort(); activeWorker.current?.terminate() }, [])

  async function upload(file: File, role: "alignment" | "fsl") {
    parsers.current[role]?.abort()
    const controller = new AbortController()
    parsers.current[role] = controller
    activeWorker.current?.terminate(); activeWorker.current = null; setBusy(false); setCompleted(null)
    setLoading((value) => ({ ...value, [role]: "Opening LandXML…" })); setError("")
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error("Choose a LandXML file of 100 MB or smaller. Clip large surfaces to the work area first.")
      const document = await parseLandXmlFile(file, { signal: controller.signal, onProgress: (stage, percent) => setLoading((value) => ({ ...value, [role]: `${stage} · ${percent}%` })) })
      if (controller.signal.aborted) return
      if (role === "alignment" && !document.alignments.length) throw new Error("This XML contains no alignments. Choose the alignment LandXML file.")
      if (role === "fsl" && !document.surfaces.length) throw new Error("This XML contains no surfaces. Choose the FSL design LandXML file.")
      delete parsers.current[role]
      onChange({ ...latestState.current, ...(role === "alignment" ? { alignmentDocument: document, alignmentName: "" } : { fslDocument: document, surfaceName: "" }), confirmed: false })
      trackToolAction("pavement", "import_complete", { source: "upload" })
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "The LandXML file could not be opened.")
    } finally {
      if (parsers.current[role] === controller) delete parsers.current[role]
      if (!controller.signal.aborted) setLoading((value) => ({ ...value, [role]: "" }))
    }
  }
  function compare() {
    if (!ready || !request) return
    activeWorker.current?.terminate(); setCompleted(null); setError(""); setProgress(0); setBusy(true)
    try {
      const worker = new Worker(new URL("../workers/pavementDesign.worker.ts", import.meta.url), { type: "module" })
      activeWorker.current = worker
      worker.onmessage = (event) => {
        if (activeWorker.current !== worker) return
        if (event.data.type === "progress") { setProgress(event.data.percent); return }
        if (event.data.type === "result") setCompleted({ request, crs: mapSettings.defaultCrs, result: event.data.result })
        else setError(event.data.message || "The pavement design check failed.")
        worker.terminate(); activeWorker.current = null; setBusy(false)
      }
      worker.onerror = () => { if (activeWorker.current === worker) { worker.terminate(); activeWorker.current = null; setBusy(false); setError("The design check stopped. Clip the design surface to the work area and try again.") } }
      worker.postMessage(request)
    } catch (error) { activeWorker.current?.terminate(); activeWorker.current = null; setBusy(false); setError(error instanceof Error ? error.message : "The design check could not start.") }
  }
  function patch(value: Partial<PavementDesignState>) { onChange({ ...state, ...value }) }

  return <section className="mt-8 space-y-6 rounded-3xl border border-cyan-300/20 bg-cyan-300/[0.03] p-5 md:p-7" aria-label="Pavement FSL conformance">
    <div><p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">Design conformance</p><h2 className="mt-2 text-2xl font-semibold">Alignment and FSL design</h2><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">Choose the alignment and finished surface level (FSL) files, then select the correct alignment and surface inside each file. The top layer survey is your asbuilt file for this check; a bottom survey is only needed for thickness.</p></div>
    <div className="grid gap-5 lg:grid-cols-2">
      {(["alignment", "fsl"] as const).map((role) => {
        const doc = role === "alignment" ? state.alignmentDocument : state.fslDocument
        const options = role === "alignment" ? doc?.alignments : doc?.surfaces
        return <div key={role} className="min-w-0 rounded-2xl border border-white/15 bg-slate-950/40 p-5">
          <h3 className="font-semibold">{role === "alignment" ? "3. Alignment LandXML" : "4. FSL design LandXML"}</h3>
          <label className="mt-3 block text-sm text-slate-300">{role === "alignment" ? "Choose alignment file" : "Choose FSL file"}<input type="file" accept=".xml,.landxml,application/xml,text/xml" aria-label={role === "alignment" ? "Alignment LandXML file" : "FSL design LandXML file"} className={`${inputClass} file:mr-3 file:rounded-full file:border-0 file:bg-cyan-300/15 file:px-3 file:py-1.5 file:text-cyan-100`} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file, role) }} /></label>
          {loading[role] && <p role="status" className="mt-3 text-xs text-cyan-200">{loading[role]}</p>}
          {doc && <><p className="mt-3 break-all text-xs text-slate-400">Loaded: {doc.fileName} · {doc.units}</p><label className="mt-3 block text-sm text-slate-300">{role === "alignment" ? "Alignment" : "FSL surface"}<select aria-label={role === "alignment" ? "Pavement alignment" : "Pavement FSL surface"} value={role === "alignment" ? state.alignmentName : state.surfaceName} className={inputClass} onChange={(event) => patch({ ...(role === "alignment" ? { alignmentName: event.target.value } : { surfaceName: event.target.value }), confirmed: false })}><option value="">Choose the correct {role === "alignment" ? "alignment" : "FSL surface"}…</option>{options?.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label><button type="button" className="mt-3 text-xs text-slate-400 underline" onClick={() => patch({ ...(role === "alignment" ? { alignmentDocument: null, alignmentName: "" } : { fslDocument: null, surfaceName: "" }), confirmed: false })}>Remove {role === "alignment" ? "alignment" : "FSL file"}</button></>}
        </div>
      })}
    </div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm text-slate-300">Lower FSL tolerance (mm)<input type="number" aria-label="Lower FSL tolerance (mm)" value={state.lowerMm} step="1" className={inputClass} onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) patch({ lowerMm: event.target.valueAsNumber }) }} /></label>
      <label className="text-sm text-slate-300">Upper FSL tolerance (mm)<input type="number" aria-label="Upper FSL tolerance (mm)" value={state.upperMm} step="1" className={inputClass} onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) patch({ upperMm: event.target.valueAsNumber }) }} /></label>
      <label className="text-sm text-slate-300">Chainage label interval<select aria-label="Pavement chainage label interval" value={state.labelInterval} className={inputClass} onChange={(event) => patch({ labelInterval: Number(event.target.value) })}>{[5, 10, 20, 50, 100].map((value) => <option key={value} value={value}>{value} m</option>)}</select></label>
      <label className="text-sm text-slate-300">Common vertical datum<input type="text" aria-label="Pavement vertical datum" placeholder="e.g. AUCK46 or NZVD2016" value={state.datum} className={inputClass} onChange={(event) => patch({ datum: event.target.value })} /></label>
    </div>
    <label className="flex items-start gap-3 text-sm leading-6 text-slate-300"><input type="checkbox" checked={state.confirmed} onChange={(event) => patch({ confirmed: event.target.checked })} className="mt-1.5 accent-cyan-400" />I confirm the asbuilt, alignment and FSL use the same survey grid, metre units and vertical datum. No height or coordinate conversion is applied.</label>
    {(unitError || coordinateError || alignmentPreview.error || error) && <p role="alert" className="rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-200">{unitError || coordinateError || alignmentPreview.error || error}</p>}
    <div className="flex flex-wrap items-center gap-4"><button type="button" disabled={!ready || busy} onClick={compare} className={buttonClass}>{busy ? `Comparing… ${progress}%` : "Compare asbuilt with FSL"}</button>{busy && <button type="button" className="text-sm text-slate-300 underline" onClick={() => { activeWorker.current?.terminate(); activeWorker.current = null; setBusy(false) }}>Cancel</button>}<p className="text-xs text-slate-400">{!measured ? "Upload the top/asbuilt point file to compare levels." : !surface ? "Choose the FSL surface to compare levels." : state.alignmentDocument && !alignment ? "Choose the alignment to calculate chainages and offsets." : !state.confirmed ? "Confirm the common grid, metre units and vertical datum." : "FSL is sampled at each asbuilt point’s original Easting/Northing."}</p></div>
    {result && <>
      <div className="grid gap-3 sm:grid-cols-4">{[["Assessed", summary.assessed], ["PASS", summary.passed], ["HIGH / LOW", summary.assessed - summary.passed], ["Unassessed", result.rows.length - summary.assessed]].map(([name, value]) => <div key={name} className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs text-slate-400">{name}</p><p className="mt-2 text-2xl font-semibold">{value.toLocaleString()}</p></div>)}</div>
      <ReportDownloads report={report} />
      <p className="text-xs leading-6 text-slate-400">Difference = asbuilt RL − FSL RL. Positive is high. Offset: + left / − right in the direction of increasing chainage. {summary.beyondEnds} point(s) lie beyond the alignment ends and have no chainage. Missing design levels remain unassessed.</p>
      <div className="overflow-x-auto rounded-2xl border border-white/10"><table className="min-w-full text-left text-sm"><caption className="p-3 text-left text-xs text-slate-400">Asbuilt vs FSL — showing {Math.min(500, result.rows.length)} of {result.rows.length.toLocaleString()} points. Reports include all points.</caption><thead className="bg-slate-950 text-xs text-slate-400"><tr>{["Point", "Chainage", "Offset (m)", "Asbuilt RL", "FSL RL", "Difference (mm)", "FSL status"].map((label) => <th key={label} className="whitespace-nowrap px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/5">{result.rows.slice(0, 500).map((row, index) => <tr key={index} className="text-slate-300"><td className="whitespace-nowrap px-4 py-3">{row.id}</td><td className="whitespace-nowrap px-4 py-3">{row.chainage === null ? row.stationStatus.replaceAll("_", " ") : `CH ${formatChainage(row.chainage)}`}</td><td className="whitespace-nowrap px-4 py-3">{row.offset === null ? "—" : `${Math.abs(row.offset).toFixed(3)} ${row.offset < 0 ? "R" : "L"}`}</td><td className="px-4 py-3">{row.elevation.toFixed(3)}</td><td className="px-4 py-3">{row.designLevel?.toFixed(3) ?? "—"}</td><td className="px-4 py-3">{row.differenceMm?.toFixed(1) ?? "—"}</td><td className="whitespace-nowrap px-4 py-3" style={{ color: pavementLevelColours[row.status] }}>{row.status.replaceAll("_", " ")}</td></tr>)}</tbody></table></div>
    </>}
    {(measured || mapDocument) && <div className="space-y-4 border-t border-white/10 pt-6">
      <h3 className="text-xl font-semibold">Alignment, FSL and asbuilt map</h3>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"><CrsPicker label="Pavement design and asbuilt survey" value={mapSettings.defaultCrs} onChange={(code) => { onMapChange({ ...mapSettings, defaultCrs: code }); patch({ confirmed: false }) }} catalogue={catalogue} loading={!catalogue.length && !catalogueError} note="Choose the actual common projected metre grid. This positions the map; the input coordinates and heights are not converted." /><div><label className="block text-sm text-slate-300">Map background<select aria-label="Pavement design map background" value={mapSettings.basemap} onChange={(event) => onMapChange({ ...mapSettings, basemap: event.target.value as Basemap })} className={inputClass}><option value="street">Street map</option><option value="aerial">Aerial / satellite (Esri)</option><option value="none">Source-grid plan</option></select></label><label className="mt-4 block text-xs text-slate-300">Survey opacity · {mapSettings.opacity}%<input type="range" aria-label="Pavement design map opacity" min="0" max="100" value={mapSettings.opacity} onChange={(event) => onMapChange({ ...mapSettings, opacity: Number(event.target.value) })} className="mt-3 w-full accent-cyan-400" /></label></div></div>
      {catalogueError && <p role="alert" className="text-sm text-amber-200">{catalogueError} <button type="button" className="underline" onClick={() => setRetry((value) => value + 1)}>Retry</button></p>}
      <PavementFieldMap geometry={geometry} document={mapDocument} points={sectionPoints} settings={mapSettings} crs={crs} state={workspace} onChange={onWorkspaceChange} alignmentName={state.alignmentName} interval={state.labelInterval} mode="level" scope="All asbuilt points" datum={state.datum} criteria={{ lowerMm: state.lowerMm, upperMm: state.upperMm }} />
      <p className="text-xs leading-6 text-slate-400">Yellow: alignment and chainages at {markers.interval} m intervals; labels are decluttered at smaller scales. Map points: {geometry.points.length.toLocaleString()} of {(measured?.points.length ?? 0).toLocaleString()}; reports assess every asbuilt point. Background imagery provides location context.</p>
    </div>}
    {(warnings.length > 0 || Boolean(result?.rejectedFaces)) && <details className="text-xs text-amber-200"><summary className="cursor-pointer">File and surface notes</summary><ul className="mt-2 list-disc space-y-1 pl-5">{result?.rejectedFaces ? <li>{result.rejectedFaces} invalid or degenerate TIN faces ignored.</li> : null}{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
  </section>
}
