import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, Calculator, Download, FileText, Upload } from "lucide-react"
import PageSeo from "../components/PageSeo"
import ProjectPanel from "../components/ProjectPanel"
import NetworkDiagram from "../components/NetworkDiagram"
import NetworkTable from "../components/NetworkTable"
import { displayObservation, displayResidual, residualUnits } from "../lib/networkAdjustment"
import type { NetworkInput, NetworkMode, NetworkResult } from "../lib/networkAdjustment"
import { defaultNetworkSettings, editObservationInclusion, networkCsv, parseNetwork, restoredNetworkSettings } from "../lib/networkInput"
import type { NetworkSettings } from "../lib/networkInput"
import { networkExample } from "../lib/networkExamples"
import { createNetworkPdf, networkCovarianceCsv, networkPointRows, networkResidualRows, networkReportNotes } from "../lib/networkReports"
import { downloadReportBlob, safeReportName } from "../lib/surveyReports"
import { createPointDxf } from "../lib/pointDxf"
import { trackToolAction } from "../lib/toolUsage"

const field = "mt-2 w-full min-w-0 rounded-xl border border-white/15 bg-slate-950 px-3 py-3 text-base text-white outline-none focus:border-cyan-300 sm:text-sm"
const panel = "mt-6 min-w-0 rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-7"
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-slate-200 disabled:opacity-40"
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950 disabled:opacity-40"
const f = (value: number | null, digits = 3) => value === null ? "—" : value.toFixed(digits)

export default function NetworkAdjustment() {
  const [settings, setSettings] = useState<NetworkSettings>(defaultNetworkSettings), [pointsText, setPointsText] = useState(""), [observationsText, setObservationsText] = useState("")
  const [review, setReview] = useState<NetworkInput | null>(null), [result, setResult] = useState<NetworkResult | null>(null), [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [onlyReview, setOnlyReview] = useState(false), [download, setDownload] = useState<{ url: string; fileName: string } | null>(null)
  const worker = useRef<Worker | null>(null), generation = useRef(0)
  useEffect(() => () => { generation.current++; worker.current?.terminate() }, [])
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url) }, [download])
  const stop = () => { generation.current++; worker.current?.terminate(); worker.current = null; setBusy("") }
  const invalidate = () => { stop(); setResult(null); setReview(null); setError(""); setDownload(null) }
  function change<K extends keyof NetworkSettings>(key: K, value: NetworkSettings[K]) { invalidate(); setConfirmed(false); setSettings(old => ({ ...old, [key]: value })) }
  function editText(kind: "points" | "observations", text: string) { invalidate(); setConfirmed(false); if (kind === "points") setPointsText(text); else setObservationsText(text) }
  function example(mode: NetworkMode) { invalidate(); const next = networkExample(mode); setSettings(next.settings); setPointsText(next.points); setObservationsText(next.observations); setConfirmed(true); setReview(parseNetwork(next.points, next.observations, next.settings)); trackToolAction("network_adjustment", "demo_open", { source: "demo" }) }
  async function importFile(kind: "points" | "observations", file?: File) {
    if (!file) return
    invalidate(); setConfirmed(false)
    const id = ++generation.current; setBusy("Reading CSV on this device…")
    try {
      if (!/\.(csv|txt)$/i.test(file.name) || file.size > 1_000_000) throw new Error("Choose a CSV or delimited TXT file under 1 MB. DAT, raw DBX/JXL and Excel observation import are not supported yet.")
      const text = await file.text()
      if (id !== generation.current) return
      if (kind === "points") setPointsText(text); else setObservationsText(text)
      trackToolAction("network_adjustment", "import_complete", { source: "upload", format: "csv" })
    } catch (caught) { if (id === generation.current) setError(caught instanceof Error ? caught.message : "The input file could not be read.") }
    finally { if (id === generation.current) setBusy("") }
  }
  function reviewInput() {
    invalidate()
    try { setReview(parseNetwork(pointsText, observationsText, settings)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Check the network input.") }
  }
  function include(id: string, enabled: boolean) {
    if (busy) return
    setResult(null); setDownload(null); setError("")
    try { const next = editObservationInclusion(observationsText, id, enabled); setObservationsText(next); setReview(parseNetwork(pointsText, next, settings)) }
    catch (caught) { setReview(null); setError(caught instanceof Error ? caught.message : "The inclusion setting could not be changed.") }
  }
  function adjust() {
    if (!review || busy || !confirmed) return
    stop(); setResult(null); setError(""); setDownload(null); setBusy("Adjusting the weighted network…")
    const id = ++generation.current
    try {
      const next = new Worker(new URL("../workers/network.worker.ts", import.meta.url), { type: "module" }); worker.current = next
      next.onmessage = event => {
        if (id !== generation.current) return
        if (event.data.error) setError(event.data.error)
        else { setResult(event.data.result); setOnlyReview(false); trackToolAction("network_adjustment", "calculate_complete") }
        setBusy(""); next.terminate(); worker.current = null
      }
      next.onerror = () => { if (id === generation.current) { setError("The adjustment worker could not finish. Check the data and try a smaller network."); setBusy(""); next.terminate(); worker.current = null } }
      next.postMessage(review)
    } catch (caught) { stop(); setError(caught instanceof Error ? caught.message : "The adjustment could not start.") }
  }
  const savedState = useMemo(() => ({ settings, pointsText, observationsText }), [settings, pointsText, observationsText])
  function restore(state: Record<string, unknown>) {
    const restored = restoredNetworkSettings(state.settings)
    if (typeof state.pointsText !== "string" || typeof state.observationsText !== "string" || state.pointsText.length > 1_000_000 || state.observationsText.length > 1_000_000) throw new Error("Invalid saved network source data.")
    invalidate(); setSettings(restored); setPointsText(state.pointsText); setObservationsText(state.observationsText); setConfirmed(false)
  }
  async function exportFile(kind: "points" | "residuals" | "pdf" | "covariance" | "json" | "dxf") {
    if (!result || !review || busy) return
    const id = ++generation.current; setBusy("Preparing the adjustment export…"); setError(""); setDownload(null)
    try {
      let content: BlobPart, mime = "text/csv;charset=utf-8", suffix: string = kind + ".csv"
      if (kind === "pdf") { content = await createNetworkPdf(review, result, settings); mime = "application/pdf"; suffix = "adjustment-report.pdf" }
      else if (kind === "json") { content = JSON.stringify({ format: "surveytool-network-results", version: 1, generatedAt: new Date().toISOString(), settings, input: review, result, notes: networkReportNotes }, null, 2); mime = "application/json"; suffix = "adjustment-results.json" }
      else if (kind === "dxf") {
        if (review.mode !== "horizontal") throw new Error("This DXF export is for adjusted horizontal networks only.")
        content = `999\r\nSurveyTool adjusted 2D network; Grid=${review.grid.replace(/[\r\n]/g, " ")}; drawing Z=0; heights NOT adjusted\r\n` + createPointDxf(result.points.map((p, i) => ({ rowNumber: i + 1, pointId: p.id, easting: p.easting!, northing: p.northing!, elevation: 0, code: p.fixed ? "FIXED_CONTROL" : "ADJUSTED_CONTROL", valid: true })), { includePoint: true, includePointId: true, includeElevation: false, includeCode: false, layerByCode: true, textHeight: .4 }, { metres: true, flatten: true }); mime = "application/dxf"; suffix = "adjusted-2D.dxf"
      } else if (kind === "covariance") content = networkCovarianceCsv(result)
      else content = networkCsv(kind === "points" ? networkPointRows(review, result) : networkResidualRows(result))
      if (id !== generation.current) return
      setDownload(downloadReportBlob(content, mime, `${safeReportName(settings.name)}_${suffix}`, true))
      trackToolAction("network_adjustment", "export_prepared", kind === "pdf" ? { format: "pdf" } : kind === "dxf" ? { format: "dxf" } : kind === "json" ? {} : { format: "csv" })
    } catch (caught) { if (id === generation.current) setError(caught instanceof Error ? caught.message : "The adjustment export could not be prepared.") }
    finally { if (id === generation.current) setBusy("") }
  }
  const residuals = result?.residuals.filter(r => !onlyReview || ["review", "weak", "uncontrolled"].includes(r.flag)) ?? []
  const status = result?.statistics.globalTest

  return <div className="relative z-10 min-h-screen px-4 py-16 sm:px-6 md:py-24">
    <PageSeo title="Survey Network Adjustment | SurveyTool.io" description="Adjust levelling and 2D survey control networks by weighted least squares. Review fixed control, residuals, precision, level closures and PDF reports locally." canonicalUrl="https://www.surveytool.io/tools/network-adjustment" />
    <div className="mx-auto max-w-7xl">
      <Link to="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-400 hover:text-cyan-300"><ArrowLeft size={18} />Back to home</Link>
      <header className="my-8"><p className="text-xs font-semibold uppercase tracking-[.25em] text-cyan-300">SurveyTool · Least squares</p><h1 className="mt-4 text-4xl font-bold sm:text-5xl">Network adjustment</h1><p className="mt-4 max-w-3xl leading-7 text-slate-400">Adjust a levelling or 2D control network, hold known control fixed, and inspect every observation before using the results. Your survey data stays on this device.</p><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">This release uses reduced observations in metres and degrees. It does not read STAR*NET DAT files or reduce raw DBX/JXL observations. Start with an example to see the input format.</p></header>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={Boolean(busy)} onClick={() => example("level")} className={secondary}>Load levelling example</button><button type="button" disabled={Boolean(busy)} onClick={() => example("horizontal")} className={secondary}>Load 2D example</button></div>
      <ProjectPanel tool="network" state={savedState} onRestore={restore} disabled={Boolean(busy)} />
      <section className={panel}>
        <h2 className="text-xl font-semibold">1. Network and observation accuracy</h2>
        <fieldset disabled={Boolean(busy)} className="mt-5 grid gap-5 disabled:opacity-60 sm:grid-cols-2 lg:grid-cols-4">
          <label className="min-w-0 text-sm text-slate-300">Project name<input className={field} value={settings.name} maxLength={200} onChange={e => change("name", e.target.value)} /></label>
          <label className="min-w-0 text-sm text-slate-300">Adjustment mode<select className={field} value={settings.mode} onChange={e => change("mode", e.target.value as NetworkMode)}><option value="level">1D · levelling network</option><option value="horizontal">2D · horizontal control network</option></select></label>
          <label className="min-w-0 text-sm text-slate-300">Horizontal grid name<input className={field} value={settings.grid} maxLength={200} onChange={e => change("grid", e.target.value)} /></label>
          <label className="min-w-0 text-sm text-slate-300">Height datum name<input className={field} value={settings.datum} maxLength={200} onChange={e => change("datum", e.target.value)} /></label>
          {settings.mode === "level" ? <label className="text-sm text-slate-300">Default level sigma (mm / √km)<input className={field} type="number" min="0.000001" step="any" value={settings.levelMmPerSqrtKm} onChange={e => change("levelMmPerSqrtKm", Number(e.target.value))} /></label> : <>
            <label className="text-sm text-slate-300">EDM constant (mm)<input className={field} type="number" min="0" step="any" value={settings.distanceMm} onChange={e => change("distanceMm", Number(e.target.value))} /></label>
            <label className="text-sm text-slate-300">EDM distance term (ppm)<input className={field} type="number" min="0" step="any" value={settings.distancePpm} onChange={e => change("distancePpm", Number(e.target.value))} /></label>
            <label className="text-sm text-slate-300">EDM sigma model<select className={field} value={settings.edmModel} onChange={e => change("edmModel", e.target.value as NetworkSettings["edmModel"])}><option value="additive">Constant + distance term</option><option value="quadrature">√(constant² + distance term²)</option></select></label>
            <label className="text-sm text-slate-300">Default angular sigma (arcsec)<input className={field} type="number" min="0.000001" step="any" value={settings.angularSeconds} onChange={e => change("angularSeconds", Number(e.target.value))} /></label>
          </>}
        </fieldset>
        <p className="mt-4 text-xs leading-6 text-slate-400">Defaults apply only when an observation’s Sigma cell is blank. Sigmas are 1-standard-deviation uncertainties, including instrument and centering effects where relevant. Fixed control is treated as exact. Grid and datum names identify the input; they do not perform a conversion.</p>
      </section>
      <section className={panel}>
        <h2 className="text-xl font-semibold">2. Control points and observations</h2>
        <fieldset disabled={Boolean(busy)} className="mt-5 grid min-w-0 gap-6 disabled:opacity-60 lg:grid-cols-2">
          {(["points", "observations"] as const).map(kind => <div key={kind} className="min-w-0"><div className="flex flex-wrap items-center justify-between gap-3"><label htmlFor={`network-${kind}`} className="text-sm font-semibold text-slate-200">{kind === "points" ? "Points CSV" : "Observations CSV"}</label><label className={`${secondary} cursor-pointer !px-4 !py-2`}><Upload size={16} />Import {kind}<input type="file" accept=".csv,.txt,text/csv,text/plain" aria-label={`Import network ${kind} CSV`} className="sr-only" onChange={e => { void importFile(kind, e.target.files?.[0]); e.target.value = "" }} /></label></div><textarea id={`network-${kind}`} aria-label={kind === "points" ? "Points CSV" : "Observations CSV"} value={kind === "points" ? pointsText : observationsText} onChange={e => editText(kind, e.target.value)} rows={9} maxLength={1_000_000} spellCheck={false} placeholder={kind === "points" ? "Point,Easting,Northing,RL,Fixed\nBM1,,,100,true\nP1,,,100.5,false" : "ID,Type,From,To,Back,Value,Sigma,Set,Length_km,Enabled\nL1,DH,BM1,P1,,0.502,,,0.25,true"} className={`${field} resize-y font-mono text-sm leading-6`} /></div>)}
        </fieldset>
        <details className="mt-5 rounded-xl border border-white/10 p-4 text-sm leading-7 text-slate-300"><summary className="cursor-pointer font-semibold text-cyan-200">CSV formats, units and point order</summary><div className="mt-3 space-y-3">
          <p><strong>Points:</strong> Point, Easting, Northing, RL, Fixed. Use true for fixed control and false for adjusted points. 2D needs approximate E/N for every point. Levelling needs fixed benchmark RLs; approximate RLs for free points are optional. Point IDs are case-sensitive.</p>
          <p><strong>Observations:</strong> ID, Type, From, To, Back, Value, Sigma, Set, Length_km, Enabled. Optional columns may be omitted. Empty cells keep their commas. Use one independent observation per row; every row needs a unique ID.</p>
          <ul className="list-disc space-y-1 pl-5"><li>DH: RL(To) − RL(From), in metres. Sigma is mm. Blank Sigma uses level sigma × √Length_km.</li><li>HD: reduced horizontal grid distance, in metres. Sigma is mm; blank uses the chosen EDM model.</li><li>AZ: grid azimuth from north clockwise. HA: clockwise angle at From, from Back to To.</li><li>DIR: circle reading at From to To. Use one Set ID per unchanged instrument orientation; each setup has its own solved orientation.</li><li>AZ, HA and DIR values: decimal degrees or D:M:S, such as 123:45:06.7. Sigma is arcseconds. 123.4506 is decimal degrees, not packed D.MMSS.</li><li>Enabled: true or false. Excluded observations remain listed and can be included again.</li></ul>
          <p>Use observations already reduced to the stated grid and height datum. Slope distance/zenith reduction, ground-to-grid scale, atmospheric/prism corrections and GNSS-vector covariance require a separate validated workflow. Limit: 80 points, 2,000 observations and 200 unknowns.</p>
        </div></details>
        <label className="mt-5 flex min-h-11 items-start gap-3 text-sm leading-6 text-slate-300"><input type="checkbox" checked={confirmed} disabled={Boolean(busy)} onChange={e => { setConfirmed(e.target.checked); if (!e.target.checked) { setResult(null); setDownload(null) } }} className="mt-1 size-5 shrink-0" />I confirm the observations are reduced to this project’s grid and datum, and the sigmas describe the supplied measurements.</label>
        <button type="button" disabled={Boolean(busy) || !pointsText.trim() || !observationsText.trim()} onClick={reviewInput} className={`${secondary} mt-5`}>Review network input</button>
      </section>
      {error && <p role="alert" className="mt-5 rounded-xl border border-amber-400/25 bg-amber-400/10 p-5 text-sm leading-7 text-amber-100">{error}</p>}
      {busy && <div role="status" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-4 text-cyan-100"><span>{busy}</span><button type="button" onClick={stop} className="min-h-11 px-3 text-sm underline">Cancel</button></div>}
      {review && <section className={panel}>
        <h2 className="text-xl font-semibold">3. Review and adjust</h2>
        <p className="mt-3 text-sm leading-7 text-cyan-100">{review.points.length} points · {review.points.filter(p => p.fixed).length} fixed · {review.observations.filter(o => o.enabled).length} included observations · {review.observations.filter(o => !o.enabled).length} excluded</p>
        <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-300">Check control coordinates</summary><NetworkTable caption="Input control and approximate positions (m)" columns={["Point", "Status", "Easting", "Northing", "RL"]} rows={review.points.map(p => [p.id, p.fixed ? "FIXED" : "FREE", f(p.easting, 6), f(p.northing, 6), f(p.height, 6)])} /></details>
        <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-300">Check observations, weights and exclusions</summary><NetworkTable caption="Explicit inclusion; sigmas include project defaults" columns={["Include", "ID", "Type", "From", "Back", "To", "Value (m / deg)", "Sigma", "Units", "Set", "Weight source"]} rows={review.observations.map(o => [<input type="checkbox" aria-label={`Include observation ${o.id}`} checked={o.enabled} disabled={Boolean(busy)} onChange={e => include(o.id, e.target.checked)} className="size-5" />, o.id, o.type, o.from, o.back || "—", o.to, f(displayObservation(o.value, o.type), 8), f(displayResidual(o.sigma, o.type)), residualUnits(o), o.set || "—", o.weightSource])} /></details>
        <button type="button" disabled={Boolean(busy) || !confirmed} onClick={adjust} className={`${primary} mt-6`}><Calculator size={18} />Adjust network</button>
        {!confirmed && <p className="mt-3 text-sm text-amber-200">Confirm the reductions and sigmas above to enable adjustment.</p>}
      </section>}
      {result && review && <section className={panel}>
        <h2 className="text-2xl font-semibold">Adjustment results</h2><p role="status" className="mt-3 text-sm leading-7 text-cyan-100">Converged · {result.statistics.observations} equations · {result.statistics.unknowns} unknowns · {result.statistics.dof} degrees of freedom</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">{[["95% global chi-square", status === "pass" ? "Within bounds" : status === "high" ? "High — review network" : status === "low" ? "Low — review sigmas" : "No redundancy"], ["Estimated sigma factor", f(result.statistics.varianceFactor, 4)], ["Observations flagged |w| > 3", String(result.statistics.reviewCount)]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-950/60 p-4"><p className="text-xs text-slate-400">{label}</p><p className={`mt-2 text-lg font-semibold ${label.startsWith("95%") && status !== "pass" ? "text-amber-200" : "text-cyan-100"}`}>{value}</p></div>)}</div>
        <p className="mt-4 text-xs leading-6 text-slate-400">v′Pv = {f(result.statistics.weightedSum, 6)} · 95% bounds {f(result.statistics.chiLower, 6)}–{f(result.statistics.chiUpper, 6)}. Point sigmas, ellipses and standardized residuals use the supplied a priori sigmas. A global test is one check, not an accuracy certificate.</p>
        {result.warnings.length > 0 && <ul className="mt-4 space-y-2 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm leading-6 text-amber-100">{result.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
        <NetworkDiagram input={review} result={result} />
        <h3 className="mt-8 text-lg font-semibold">{review.mode === "level" ? "Adjusted reduced levels" : "Adjusted horizontal coordinates"}</h3>
        <NetworkTable caption="A priori precision; displayed coordinates rounded to 0.000001 m; CSV retains full precision" columns={review.mode === "level" ? ["Point", "Status", "Adjusted RL (m)", "dH (mm)", "Sigma H (mm)"] : ["Point", "Status", "Easting (m)", "Northing (m)", "dE (mm)", "dN (mm)", "Sigma E (mm)", "Sigma N (mm)", "95% major (mm)", "95% minor (mm)", "Bearing (deg N)"]} rows={result.points.map(p => review.mode === "level" ? [p.id, p.fixed ? "FIXED" : "FREE", f(p.height, 6), f(p.deltaH === null ? null : p.deltaH * 1000), f(p.sigmaH! * 1000)] : [p.id, p.fixed ? "FIXED" : "FREE", f(p.easting, 6), f(p.northing, 6), f(p.deltaE! * 1000), f(p.deltaN! * 1000), f(p.sigmaE! * 1000), f(p.sigmaN! * 1000), f(p.ellipseMajor95! * 1000), f(p.ellipseMinor95! * 1000), f(p.ellipseBearing)] )} />
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4"><h3 className="text-lg font-semibold">Observation residuals</h3><label className="flex min-h-11 items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={onlyReview} onChange={e => setOnlyReview(e.target.checked)} />Only flagged or weak observations</label></div>
        <NetworkTable caption="Residual = adjusted − observed; w uses residual covariance; exclusions are retained in complete exports" columns={["ID", "Type", "From", "Back", "To", "Residual", "Sigma", "Units", "Redundancy %", "w", "Check"]} rows={residuals.map(r => [r.id, r.type, r.from, r.back || "—", r.to, f(r.residual === null ? null : displayResidual(r.residual, r.type)), f(displayResidual(r.sigma, r.type)), residualUnits(r), f(r.redundancy === null ? null : r.redundancy * 100, 1), f(r.standardized), <span className={r.flag === "review" ? "font-semibold text-rose-200" : r.flag === "ok" ? "text-slate-300" : "text-amber-200"}>{r.flag}</span>])} />
        {result.closures.length > 0 && <details className="mt-6"><summary className="cursor-pointer text-sm font-semibold text-cyan-200">Level-loop and benchmark-tie misclosures</summary><NetworkTable caption="Independent spanning-tree checks in input order; misclosure = observed DH minus tree-path DH" columns={["Closing obs.", "Tree path", "Misclosure (mm)", "Loop sigma (mm)", "Length (km)", "Misclosure / sigma"]} rows={result.closures.map(c => [c.observation, c.path, f(c.misclosure * 1000), f(c.sigma * 1000), f(c.lengthKm), f(c.misclosure / c.sigma)])} /></details>}
        {result.orientations.length > 0 && <details className="mt-6"><summary className="cursor-pointer text-sm font-semibold text-cyan-200">Direction-set orientations</summary><NetworkTable caption="Orientation = grid azimuth − circle reading; separate unknown per station and setup" columns={["Station", "Set", "Orientation (degrees)", "Sigma (arcsec)"]} rows={result.orientations.map(o => [o.station, o.set, f(o.degrees, 9), f(o.sigmaSeconds)])} /></details>}
        <div className="mt-8 flex flex-wrap gap-3"><button type="button" disabled={Boolean(busy)} onClick={() => void exportFile("points")} className={primary}><Download size={17} />Adjusted points CSV</button><button type="button" disabled={Boolean(busy)} onClick={() => void exportFile("residuals")} className={secondary}>Residuals CSV</button><button type="button" disabled={Boolean(busy)} onClick={() => void exportFile("pdf")} className={secondary}><FileText size={17} />PDF adjustment report</button>{review.mode === "horizontal" && <button type="button" disabled={Boolean(busy)} onClick={() => void exportFile("dxf")} className={secondary}>2D DXF · Z = 0</button>}</div>
        <details className="mt-5"><summary className="cursor-pointer text-sm text-slate-400">Covariance, complete results and calculation notes</summary><div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={Boolean(busy)} onClick={() => void exportFile("covariance")} className={secondary}>A priori covariance CSV</button><button type="button" disabled={Boolean(busy)} onClick={() => void exportFile("json")} className={secondary}>Complete results JSON</button></div><ul className="mt-4 list-disc space-y-3 pl-5 text-xs leading-6 text-slate-400">{networkReportNotes.map(n => <li key={n}>{n}</li>)}</ul></details>
        {download && <a href={download.url} download={download.fileName} className="mt-5 block break-words text-sm text-cyan-300 underline">Download prepared file · {download.fileName}</a>}
      </section>}
      <p className="my-8 max-w-4xl text-xs leading-6 text-slate-500">Version 1 · local plane and levelling adjustment. Weighted least squares and statistical conventions are documented with validation references in the project. Keep source observations and project backups so adjustments can be reproduced and independently checked.</p>
    </div>
  </div>
}
