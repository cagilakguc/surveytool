import { useEffect, useRef, useState } from "react"
import { parseLandXmlFile } from "../lib/landxmlAsync"
import { pavementDesignUnitError } from "../lib/pavementDesign"
import type { PavementBottomState } from "../lib/pavementBottomSurface"

export default function PavementBottomSurfaceInput({ state, onChange }: { state: PavementBottomState; onChange: (state: PavementBottomState) => void }) {
  const parser = useRef<AbortController | null>(null)
  const [loading, setLoading] = useState(""), [error, setError] = useState("")
  const latest = useRef(state); latest.current = state
  useEffect(() => () => parser.current?.abort(), [])
  async function upload(file: File) {
    parser.current?.abort()
    const controller = new AbortController(); parser.current = controller
    setLoading("Opening bottom LandXML…"); setError("")
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error("Choose a bottom LandXML of 100 MB or smaller. Clip large surfaces to the work area first.")
      const document = await parseLandXmlFile(file, { signal: controller.signal, onProgress: (stage, percent) => setLoading(`${stage} · ${percent}%`) })
      if (controller.signal.aborted) return
      if (!document.surfaces.length) throw new Error("This file contains no TIN surfaces. Choose the basecourse or other bottom-layer surface XML.")
      parser.current = null
      onChange({ ...latest.current, document, surfaceName: "" })
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "The bottom LandXML could not be read.") }
    finally { if (parser.current === controller) parser.current = null; if (!controller.signal.aborted) setLoading("") }
  }
  const unitError = pavementDesignUnitError(state.document)
  return <div className="rounded-3xl border border-dashed border-white/20 bg-white/5 p-7" aria-label="Bottom LandXML surface input">
    <h2 className="text-xl font-semibold">1. Bottom layer surface</h2>
    <p className="mt-2 text-sm leading-6 text-slate-400">Use the TIN created from your basecourse, subbase or other lower-layer survey. Bottom RL is interpolated at each top/asbuilt point’s original Easting/Northing; matching point IDs are not needed.</p>
    <label className="mt-4 block text-sm text-slate-300">Bottom surface LandXML<input type="file" aria-label="Bottom surface LandXML file" accept=".xml,.landxml,application/xml,text/xml" className="mt-2 block max-w-full rounded-xl border border-white/15 bg-slate-950 p-3 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-cyan-300/10 file:px-3 file:py-1 file:text-cyan-200" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file) }} /></label>
    {loading && <p role="status" className="mt-3 text-sm text-cyan-200">{loading}</p>}
    {state.document && <><p className="mt-3 break-all text-xs text-slate-400">Loaded: {state.document.fileName} · {state.document.units}</p><label className="mt-4 block text-sm text-slate-300">Basecourse / bottom surface<select aria-label="Pavement bottom TIN surface" value={state.surfaceName} onChange={(event) => onChange({ ...state, surfaceName: event.target.value })} className="mt-2 w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-3 text-white"><option value="">Choose the correct bottom surface…</option>{state.document.surfaces.map((surface) => <option key={surface.name} value={surface.name}>{surface.name} · {surface.faces.length.toLocaleString()} faces</option>)}</select></label><button type="button" className="mt-3 text-xs text-slate-400 underline" onClick={() => { parser.current?.abort(); parser.current = null; setLoading(""); onChange({ ...state, document: null, surfaceName: "" }) }}>Remove bottom surface</button></>}
    {(error || unitError) && <p role="alert" className="mt-3 text-sm text-amber-200">{error || unitError}</p>}
    {Boolean(state.document?.warnings.length) && <details className="mt-3 text-xs text-amber-200"><summary>Bottom LandXML notes</summary><ul className="mt-2 list-disc pl-5">{state.document!.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
    <p className="mt-4 text-xs leading-5 text-slate-400">Use the same metre grid and vertical datum as the top survey. Points outside the TIN, in holes, or without a reliable bottom level remain unassessed.</p>
  </div>
}
