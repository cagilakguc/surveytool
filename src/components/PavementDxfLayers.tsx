import { useEffect, useMemo, useRef, useState } from "react"
import { parseSurveyGeometryFile } from "../lib/surveyGeometry"
import type { SurveyGeometryLayer } from "../lib/surveyGeometry"
import { pavementDxfGroups } from "../lib/pavementMap"
import type { PavementWorkspaceState } from "../lib/pavementMap"

export default function PavementDxfLayers({ state, onChange }: { state: PavementWorkspaceState; onChange: (patch: Partial<PavementWorkspaceState>) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("")
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  const latest = useRef(state); latest.current = state
  const groups = useMemo(() => pavementDxfGroups(state.overlays), [state.overlays])
  async function upload(files: File[]) {
    const run = ++generation.current
    setBusy(true); setError("")
    try {
      if (files.some((file) => file.size > 50 * 1024 * 1024)) throw new Error("Choose DXF files of 50 MB or smaller. Clip large drawings to the work area.")
      const parsed: SurveyGeometryLayer[] = []
      for (const file of files) {
        if (!file.name.toLowerCase().endsWith(".dxf")) throw new Error("Choose ASCII DXF files for string overlays.")
        parsed.push(await parseSurveyGeometryFile(file))
      }
      if (run !== generation.current) return
      const existing = latest.current.overlays.filter((layer) => !parsed.some((next) => next.name === layer.name))
      if (existing.length + parsed.length > 20) throw new Error("Use up to 20 DXF files per pavement project.")
      onChange({ overlays: [...existing, ...parsed] })
    } catch (error) { if (run === generation.current) setError(error instanceof Error ? error.message : "The DXF files could not be opened.") }
    finally { if (run === generation.current) setBusy(false) }
  }
  return <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6" aria-label="Pavement DXF reference layers">
    <h2 className="text-xl font-semibold">DXF strings and reference layers</h2>
    <p className="mt-2 text-sm leading-6 text-slate-400">Add kerbs, lane lines, boundaries or other strings. Each DXF layer can be switched on or off in both pavement maps. Use the same survey grid and metre units as the points. DXF strings provide plan reference; section RLs come from measured points and the selected FSL.</p>
    <label className="mt-4 block text-sm text-slate-300">Add DXF files<input aria-label="Pavement DXF strings" type="file" accept=".dxf" multiple disabled={busy} className="mt-2 block max-w-full rounded-xl border border-white/15 bg-slate-950 p-3 file:mr-3 file:rounded-full file:border-0 file:bg-cyan-300/10 file:px-3 file:py-1 file:text-cyan-200" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void upload(files) }} /></label>
    {busy && <p role="status" className="mt-3 text-sm text-cyan-200">Reading DXF strings…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-amber-200">{error}</p>}
    {groups.length > 0 && <><div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">{groups.map((group) => <label key={group.key} className="inline-flex min-w-0 items-center gap-2 text-sm"><input type="checkbox" checked={!state.hiddenLayers.includes(group.key)} onChange={(event) => onChange({ hiddenLayers: event.target.checked ? state.hiddenLayers.filter((key) => key !== group.key) : [...state.hiddenLayers, group.key] })} className="accent-cyan-400" /><span className="break-all" style={{ color: group.colour }}>{group.label}</span></label>)}</div><div className="mt-4 flex flex-wrap gap-3">{state.overlays.map((layer) => <button key={layer.name} type="button" className="text-xs text-slate-400 underline" onClick={() => onChange({ overlays: state.overlays.filter((item) => item !== layer) })}>Remove {layer.name}</button>)}</div></>}
    {state.overlays.some((layer) => layer.warnings.length) && <details className="mt-3 text-xs text-amber-200"><summary>DXF import notes</summary><ul className="mt-2 list-disc pl-5">{state.overlays.flatMap((layer) => layer.warnings.map((warning, i) => <li key={`${layer.name}-${i}`}>{warning}</li>))}</ul></details>}
  </section>
}
