import { lazy, Suspense, useMemo, useState } from "react"
import type { MouseEvent, PointerEvent } from "react"
import type { SurveyGeometryLayer } from "../lib/surveyGeometry"
import type { LandXmlDocument, PlanPoint } from "../lib/landxml"
import type { MapCrs, MapProjectSettings } from "../lib/mapCoordinates"
import type { PavementWorkspaceState } from "../lib/pavementMap"
import { pavementMapCoordinateError, withPavementDxf } from "../lib/pavementMap"
import { pavementDesignUnitError } from "../lib/pavementDesign"
import type { PavementMeasurement, PavementSectionRequest, PavementSectionCriteria } from "../lib/pavementSection"
import { alignmentChainageMarkers } from "../lib/alignmentStationing"
import PavementSectionDialog from "./PavementSectionDialog"

const SurveyMap = lazy(() => import("./SurveyMap"))
export default function PavementFieldMap({ geometry, document, points, settings, crs, state, onChange, alignmentName = "", interval = 10, mode, scope, datum = "", criteria }: {
  geometry: SurveyGeometryLayer; document?: LandXmlDocument; points: PavementMeasurement[]; settings: MapProjectSettings; crs?: MapCrs; state: PavementWorkspaceState; onChange: (patch: Partial<PavementWorkspaceState>) => void; alignmentName?: string; interval?: number; mode: "thickness" | "level"; scope: string; datum?: string; criteria?: PavementSectionCriteria
}) {
  const [open, setOpen] = useState(false)
  const combined = useMemo(() => withPavementDxf(geometry, state.overlays, state.hiddenLayers), [geometry, state.overlays, state.hiddenLayers])
  const allLayers = useMemo(() => withPavementDxf(geometry, state.overlays, []), [geometry, state.overlays])
  const hiddenGroups = useMemo(() => state.hiddenLayers.map((key) => `status-${key}`), [state.hiddenLayers])
  const request = useMemo<PavementSectionRequest | null>(() => state.sectionLine ? { line: state.sectionLine, corridor: state.corridor, points, document, alignmentName, mode, scope, crs: settings.defaultCrs, datum, criteria } : null, [state.sectionLine, state.corridor, points, document, alignmentName, mode, scope, settings.defaultCrs, datum, criteria])
  const coordinateError = crs ? pavementMapCoordinateError(crs) : ""
  const unitError = pavementDesignUnitError(document ?? null)
  const hasGeometry = allLayers.points.length + allLayers.lines.length + allLayers.polygons.length + (document?.surfaces.length ?? 0) + (document?.alignments.length ?? 0) > 0
  const draw = (line: NonNullable<PavementWorkspaceState["sectionLine"]>) => { onChange({ sectionLine: line }); setOpen(true) }
  const plan = <PavementPlan geometry={combined} document={document} state={state} interval={interval} canDraw={!unitError} onDraw={draw} />
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
      <label className="inline-flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={state.showLabels} onChange={(event) => onChange({ showLabels: event.target.checked })} className="accent-cyan-400" />{mode === "thickness" ? "Thickness labels (mm)" : "Level difference labels (mm)"}</label>
      <label className="inline-flex items-center gap-2 text-sm text-slate-300">Section search ± (m)<input aria-label={`${mode} section search distance`} type="number" min="0.01" step="0.1" value={state.corridor} onChange={(event) => { if (event.target.valueAsNumber > 0) onChange({ corridor: event.target.valueAsNumber }) }} className="w-24 rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-white" /></label>
      {state.sectionLine && <button type="button" disabled={Boolean(unitError)} onClick={() => setOpen(true)} className="rounded-full border border-cyan-300/30 px-4 py-2 text-sm text-cyan-100">Open drawn section</button>}
    </div>
    {unitError && <p role="alert" className="text-sm text-amber-200">{unitError}</p>}
    {settings.basemap !== "none" && crs && !coordinateError && !unitError && hasGeometry ? <Suspense fallback={plan}><SurveyMap crs={crs} basemap={settings.basemap} opacity={settings.opacity} document={document} geometry={allLayers} hiddenGeometryGroups={hiddenGroups} onGroupVisibilityChange={(group, visible) => { if (group.startsWith("status-DXF ")) { const key = group.slice(7); onChange({ hiddenLayers: visible ? state.hiddenLayers.filter((value) => value !== key) : [...new Set([...state.hiddenLayers, key])] }) } }} geometryContext="survey" heightUnitLabel="m (survey)" pointLabels={state.showLabels} selectedAlignmentName={alignmentName} chainageInterval={interval} sectionLine={state.sectionLine} onSectionDraw={draw} fallback={plan} /></Suspense> : <>{settings.basemap !== "none" && !unitError && <p role="status" className="text-sm text-amber-200">{coordinateError || (!crs ? "Select the actual survey grid to display the background map." : "No visible geometry matches the current selection.")}</p>}{plan}</>}
    <p className="text-xs leading-6 text-slate-400">Draw a line across the map to open its section. The section uses every point in the current filter within the search distance, including points omitted from the bounded map preview. Source-grid labels are simplified when crowded.</p>
    {open && request && <PavementSectionDialog request={request} onClose={() => setOpen(false)} />}
  </div>
}

function PavementPlan({ geometry, document, state, interval, onDraw, canDraw }: { geometry: SurveyGeometryLayer; document?: LandXmlDocument; state: PavementWorkspaceState; interval: number; onDraw: (line: NonNullable<PavementWorkspaceState["sectionLine"]>) => void; canDraw: boolean }) {
  const [drawing, setDrawing] = useState(false), [start, setStart] = useState<PlanPoint | null>(null), [end, setEnd] = useState<PlanPoint | null>(null)
  const plan = useMemo(() => {
    const alignment = document?.alignments[0], surface = document?.surfaces[0]
    const faces = surface?.faces.filter((_, i) => i % Math.max(1, Math.ceil(surface.faces.length / 1500)) === 0) ?? []
    const vertices = [...geometry.points, ...(alignment?.points ?? []), ...geometry.lines.flatMap((line) => line.vertices), ...geometry.polygons.flatMap((polygon) => polygon.rings.flat()), ...faces.flatMap((face) => face.map((id) => surface!.points[id]).filter(Boolean))]
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity
    for (const p of vertices) { minE = Math.min(minE, p.easting); maxE = Math.max(maxE, p.easting); minN = Math.min(minN, p.northing); maxN = Math.max(maxN, p.northing) }
    if (!vertices.length) { minE = 0; maxE = 100; minN = 0; maxN = 50 }
    const scale = Math.min(900 / Math.max(maxE - minE, 1), 430 / Math.max(maxN - minN, 1)), centerE = (minE + maxE) / 2, centerN = (minN + maxN) / 2
    let budget = 50000
    const lines = geometry.lines.filter((line) => { if (line.vertices.length > budget) return false; budget -= line.vertices.length; return true }).slice(0, 2000)
    const rings = geometry.polygons.flatMap((polygon) => polygon.rings.map((ring) => ({ code: polygon.code, ring }))).filter(({ ring }) => { if (ring.length > budget) return false; budget -= ring.length; return true }).slice(0, 2000)
    const points = geometry.points.slice(0, 5000)
    let markers: ReturnType<typeof alignmentChainageMarkers>["markers"] = []
    try { if (alignment) markers = alignmentChainageMarkers(alignment, interval).markers } catch { /* Unsupported stationing remains a plan reference. */ }
    return { alignment, surface, faces, markers, lines, rings, points, x: (e: number) => 500 + (e - centerE) * scale, y: (n: number) => 270 - (n - centerN) * scale, unproject: (x: number, y: number): PlanPoint => ({ easting: (x - 500) / scale + centerE, northing: (270 - y) / scale + centerN, elevation: null }) }
  }, [geometry, document, interval])
  const xy = (event: MouseEvent<SVGSVGElement> | PointerEvent<SVGSVGElement>) => { const r = event.currentTarget.getBoundingClientRect(); return plan.unproject((event.clientX - r.left) / r.width * 1000, (event.clientY - r.top) / r.height * 540) }
  const line = drawing && start && end ? { start, end } : state.sectionLine
  const { x, y } = plan
  const colour = (code: string) => geometry.pointColours?.[code] ?? "#a78bfa"
  return <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-3"><span className="text-xs text-slate-300">Source-grid plan · metres</span><button type="button" disabled={!canDraw} onClick={() => { setDrawing(!drawing); setStart(null); setEnd(null) }} className="rounded-full border border-cyan-300/30 px-4 py-2 text-xs text-cyan-100 disabled:opacity-40">{drawing ? "Cancel drawing" : "Draw section line"}</button></div>
    {drawing && <p role="status" className="p-3 text-xs text-cyan-200">{start ? "Choose the end of the section line." : "Choose the start of the section line."}</p>}
    <svg viewBox="0 0 1000 540" role="img" aria-label="Pavement source-grid plan with thickness labels, DXF strings and section drawing" className={`block w-full ${drawing ? "cursor-crosshair" : ""}`} onPointerMove={(event) => { if (drawing && start) setEnd(xy(event)) }} onClick={(event) => { if (!drawing) return; const p = xy(event); if (!start) setStart(p); else if (Math.hypot(p.easting - start.easting, p.northing - start.northing) >= .05) { onDraw({ start, end: p }); setDrawing(false); setStart(null); setEnd(null) } }}>
      {plan.faces.map((face, i) => { const p = face.map((id) => plan.surface!.points[id]); return p.every(Boolean) ? <polygon key={i} points={p.map((v) => `${x(v.easting)},${y(v.northing)}`).join(" ")} fill="#22d3ee10" stroke="#22d3ee30" strokeWidth=".5" /> : null })}
      {plan.rings.map(({ code, ring }, i) => <polygon key={i} points={ring.map((p) => `${x(p.easting)},${y(p.northing)}`).join(" ")} fill="none" stroke={colour(code)} strokeWidth="2" />)}
      {plan.lines.map((line, i) => <polyline key={i} points={line.vertices.map((p) => `${x(p.easting)},${y(p.northing)}`).join(" ")} fill="none" stroke={colour(line.code)} strokeWidth="2"><title>{line.code}</title></polyline>)}
      {plan.alignment && <polyline points={plan.alignment.points.map((p) => `${x(p.easting)},${y(p.northing)}`).join(" ")} fill="none" stroke="#facc15" strokeWidth="2.5" />}
      {plan.points.map((point, i) => <g key={i}><circle cx={x(point.easting)} cy={y(point.northing)} r={point.radius ?? 4} fill={colour(point.code)} stroke="#0f172a" strokeWidth=".8"><title>{point.id}</title></circle>{state.showLabels && point.label && i % Math.max(1, Math.ceil(geometry.points.length / 120)) === 0 && <text x={x(point.easting) + 6} y={y(point.northing) - 6} fill="#fff" fontSize="11" stroke="#020617" strokeWidth="3" paintOrder="stroke">{point.label}</text>}</g>)}
      {plan.markers.filter((_, i) => i % Math.max(1, Math.ceil(plan.markers.length / 50)) === 0).map((p) => <text key={p.chainage} x={x(p.easting)} y={y(p.northing) - 15} fill="#fef08a" fontSize="10" stroke="#020617" strokeWidth="3" paintOrder="stroke">{p.label}</text>)}
      {line && <line x1={x(line.start.easting)} y1={y(line.start.northing)} x2={x(line.end.easting)} y2={y(line.end.northing)} stroke="#f472b6" strokeWidth="3" strokeDasharray="8 4" />}
    </svg>
  </div>
}
