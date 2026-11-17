import { useState } from "react"
import type { ChangeEvent, DragEvent } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, ArrowRightLeft, CheckCircle2, Download, FileCode2, Layers3, Upload, AlertTriangle } from "lucide-react"
import PageSeo from "../components/PageSeo"
import { convertDxfHatches } from "../lib/dxfHatchConverter"
import type { HatchConvertResult, HatchOutputMode } from "../lib/dxfHatchConverter"
import { trackToolAction } from "../lib/toolUsage"

const MAX_BYTES = 25 * 1024 * 1024

export default function DxfHatchConverter() {
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<HatchOutputMode>("full")
  const [spacing, setSpacing] = useState("0.25")
  const [convertSolids, setConvertSolids] = useState(true)
  const [result, setResult] = useState<HatchConvertResult | null>(null)
  const [error, setError] = useState("")
  const [working, setWorking] = useState(false)

  function chooseFile(next: File | null) {
    setResult(null)
    setError("")
    if (!next) return
    if (!/\.dxf$/i.test(next.name)) { setFile(null); setError("Select an AutoCAD DXF (.dxf) file."); return }
    if (next.size > MAX_BYTES) { setFile(null); setError("The maximum file size is 25 MB. Try a smaller ASCII DXF."); return }
    setFile(next)
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0] ?? null)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    chooseFile(event.dataTransfer.files?.[0] ?? null)
  }

  async function convert() {
    if (!file) return
    const distance = Number(spacing)
    if (mode === "full" && (!Number.isFinite(distance) || distance <= 0)) {
      setError("Enter a positive line spacing in the source drawing units.")
      return
    }
    setWorking(true)
    setError("")
    setResult(null)
    try {
      const text = await file.text()
      // Yield to the browser before the potentially large geometry conversion.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      const converted = convertDxfHatches(text, {
        mode,
        spacing: mode === "outlines" ? 0.25 : distance,
        convertSolids,
      })
      setResult(converted)
      trackToolAction("hatch_dxf", "export_prepared", { format: "dxf" })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not convert this DXF.")
    } finally {
      setWorking(false)
    }
  }

  function download() {
    if (!result || !file) return
    const blob = new Blob([result.dxf], { type: "application/dxf" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = file.name.replace(/\.dxf$/i, "") + (mode === "full" ? "_TSC5_full.dxf" : "_TSC5_outlines.dxf")
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1500)
  }

  return (
    <div className="relative z-10 min-h-screen px-6 py-24 text-white">
      <PageSeo
        title="DXF Hatch & Road Marking Converter for Trimble | SurveyTool.io"
        description="Convert AutoCAD DXF hatch, road marking arrows, symbols and filled polygons into Trimble Access-friendly linework and outlines without changing coordinates."
        canonicalUrl="https://www.surveytool.io/tools/dxf-hatch-converter"
      />
      <div className="mx-auto max-w-5xl">
        <Link to="/" className="mb-8 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-cyan-300"><ArrowLeft size={18} /> Back to tools</Link>
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300">DXF field utilities</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Hatch & Road Marking Converter</h1>
        <p className="mt-5 max-w-3xl text-slate-300">Make AutoCAD hatches, bus-lane fills, painted islands, road arrows, turn symbols and other line markings visible as normal geometry in Trimble Access on a TSC5.</p>
        <div className="mt-7 grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><Layers3 className="mb-3 text-cyan-300" size={22}/><strong className="block text-white">Layers & colours</strong><span className="mt-1 block text-slate-400">Retains source layer assignments and entity colours.</span></div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><ArrowRightLeft className="mb-3 text-cyan-300" size={22}/><strong className="block text-white">Arrows & symbols</strong><span className="mt-1 block text-slate-400">Converts fills inside block definitions while keeping INSERT placement.</span></div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><FileCode2 className="mb-3 text-cyan-300" size={22}/><strong className="block text-white">Local conversion</strong><span className="mt-1 block text-slate-400">Processes your ASCII DXF in the browser, with no file upload to a server.</span></div>
        </div>

        <div className="mt-8 rounded-3xl border border-white/10 bg-slate-900/80 p-6 sm:p-8">
          <label
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            className="flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed border-cyan-400/30 bg-cyan-300/[0.04] px-6 py-12 text-center transition hover:border-cyan-300"
          >
            <Upload className="mb-4 text-cyan-300" size={34}/>
            <span className="text-lg font-semibold">{file ? file.name : "Choose or drop an ASCII DXF file"}</span>
            <span className="mt-2 text-sm text-slate-400">{file ? (file.size / 1048576).toFixed(2) + " MB" : "DXF · up to 25 MB · preserved drawing coordinates"}</span>
            <input aria-label="Choose DXF" type="file" accept=".dxf" onChange={handleFileChange} className="sr-only"/>
          </label>
          <div className="mt-7 grid gap-5 md:grid-cols-2">
            <fieldset>
              <legend className="mb-3 text-sm font-semibold text-white">Export style</legend>
              <div className="space-y-2 text-sm">
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 p-4">
                  <input type="radio" checked={mode === "full"} onChange={() => { setMode("full"); setResult(null) }} className="mt-1 accent-cyan-400"/>
                  <span><strong className="block text-white">Full hatch / line marking</strong><span className="block text-slate-400">Boundary polylines plus clipped line fills for arrows, painted areas and patterned hatches.</span></span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 p-4">
                  <input type="radio" checked={mode === "outlines"} onChange={() => { setMode("outlines"); setResult(null) }} className="mt-1 accent-cyan-400"/>
                  <span><strong className="block text-white">Lightweight boundaries</strong><span className="block text-slate-400">Closed polylines only: simpler field map and easier selection for setting out.</span></span>
                </label>
              </div>
            </fieldset>
            <div className="space-y-6">
              <label className="block text-sm">
                <span className="mb-2 block font-semibold">Fill line spacing (drawing units)</span>
                <input disabled={mode === "outlines"} type="number" min="0.01" step="0.05" value={spacing} onChange={(event) => { setSpacing(event.target.value); setResult(null) }} className="w-full rounded-xl border border-white/15 bg-slate-950 p-3 text-white outline-none focus:border-cyan-400 disabled:opacity-40"/>
                <span className="mt-2 block text-xs text-slate-400">For a DXF in metres, 0.25 means 250 mm between hatch lines. Smaller values produce more detail and larger files.</span>
              </label>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" checked={convertSolids} onChange={(event) => { setConvertSolids(event.target.checked); setResult(null) }} className="mt-1 accent-cyan-400"/>
                <span><strong className="block">Also convert SOLID / TRACE fills</strong><span className="block text-slate-400">Recommended for filled arrows, lettering, symbols and other road markings.</span></span>
              </label>
            </div>
          </div>
          <button disabled={!file || working} onClick={() => void convert()} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-6 py-4 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
            <ArrowRightLeft size={19}/>{working ? "Converting DXF…" : "Convert for Trimble Access"}
          </button>
          {error && <p role="alert" className="mt-5 rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</p>}
          {result && <section aria-label="Conversion result" className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-5">
            <div className="flex items-center gap-2 font-semibold text-emerald-300"><CheckCircle2 size={20}/> Conversion prepared</div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><strong className="block text-xl text-white">{result.hatches}</strong><span className="text-slate-400">Hatches converted</span></div>
              <div><strong className="block text-xl text-white">{result.solids}</strong><span className="text-slate-400">Solid fills converted</span></div>
              <div><strong className="block text-xl text-white">{result.generatedOutlines.toLocaleString()}</strong><span className="text-slate-400">Closed outlines</span></div>
              <div><strong className="block text-xl text-white">{result.generatedLines.toLocaleString()}</strong><span className="text-slate-400">Fill lines</span></div>
            </div>
            <p className="mt-4 text-xs text-slate-400">{result.blocksUpdated} block definitions modified. Existing linework, arrow INSERT positions and drawing coordinates were left unchanged.</p>
            {result.warnings.length > 0 && <div className="mt-4 text-sm text-amber-200"><div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16}/> Check these warnings</div><ul className="mt-2 list-disc pl-5">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
            <button onClick={download} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 font-semibold text-slate-950 hover:bg-slate-200"><Download size={18}/> Download converted DXF</button>
          </section>}
        </div>
        <p className="mt-6 max-w-4xl text-sm leading-6 text-slate-400"><strong className="text-slate-200">For field use:</strong> This tool converts fills into geometry; it does not reproduce every complex AutoCAD pattern exactly. Existing circles, arcs, inserts and labels are kept in place, and hatch curve boundaries are approximated with short segments. Check road arrow shape, the drawing's units, alignment and known control points on the TSC5 before setting out. Binary DXF and non-planar hatch extrusions need conversion in CAD first.</p>
      </div>
    </div>
  )
}
