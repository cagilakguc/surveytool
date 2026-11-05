import { useEffect, useId, useMemo, useRef, useState } from "react"
import type { NetworkInput, NetworkResult } from "../lib/networkAdjustment"

export default function NetworkDiagram({ input, result }: { input: NetworkInput; result: NetworkResult }) {
  const host = useRef<HTMLDivElement>(null), [width, setWidth] = useState(800), [ellipses, setEllipses] = useState(true), [magnification, setMagnification] = useState(1000), [selected, setSelected] = useState("")
  const clip = useId().replace(/:/g, "")
  useEffect(() => { const node = host.current; if (!node) return; const observer = new ResizeObserver(entries => setWidth(Math.max(260, entries[0].contentRect.width))); observer.observe(node); return () => observer.disconnect() }, [])
  const level = input.mode === "level", height = 360, margin = 36
  const layout = useMemo(() => {
    const raw = result.points.map((p, i) => ({ ...p, x: level ? i : p.easting!, y: level ? p.height! : p.northing! }))
    const minX = Math.min(...raw.map(p => p.x)), maxX = Math.max(...raw.map(p => p.x)), minY = Math.min(...raw.map(p => p.y)), maxY = Math.max(...raw.map(p => p.y))
    const scaleX = (width - 2 * margin) / Math.max(level ? 1 : .1, maxX - minX), scaleY = (height - 2 * margin) / Math.max(.01, maxY - minY), scale = Math.min(scaleX, scaleY)
    const sx = level ? scaleX : scale, sy = level ? scaleY : scale, offsetX = (width - (maxX - minX) * sx) / 2, offsetY = (height - (maxY - minY) * sy) / 2
    return { points: raw.map(p => ({ ...p, cx: offsetX + (p.x - minX) * sx, cy: height - offsetY - (p.y - minY) * sy })), scale, minY, maxY, minX, maxX }
  }, [result, level, width])
  const byId = new Map(layout.points.map(p => [p.id, p])), edges = new Map<string, { from: string; to: string; review: boolean }>()
  for (const r of result.residuals.filter(r => r.enabled)) for (const to of r.type === "HA" ? [r.to, r.back] : [r.to]) { const key = [r.from, to].sort().join("\0"), old = edges.get(key); edges.set(key, { from: r.from, to, review: r.flag === "review" || Boolean(old?.review) }) }
  const chosen = result.points.find(p => p.id === selected)
  return <div ref={host} className="mt-6 min-w-0">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-4 text-sm">
      <p className="text-slate-300">{level ? "Level network · RL profile in point order" : "Network plan · north up, east right"}</p>
      <label className="flex min-h-11 items-center gap-2 text-slate-300">Highlight point<select aria-label="Highlight network point" value={selected} onChange={e => setSelected(e.target.value)} className="min-w-0 max-w-44 rounded-lg border border-white/20 bg-slate-950 p-2"><option value="">None</option>{result.points.map(p => <option key={p.id}>{p.id}</option>)}</select></label>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={level ? "Adjusted level-network RL profile; horizontal spacing is schematic point order" : "Adjusted horizontal network with fixed control, observations and 95 percent error ellipses"} className="block w-full rounded-xl border border-white/10 bg-slate-950/70">
      <defs><clipPath id={clip}><rect x="10" y="10" width={width - 20} height={height - 20} /></clipPath></defs>
      <g clipPath={`url(#${clip})`}>
        {[...edges.values()].map((edge, i) => { const a = byId.get(edge.from)!, b = byId.get(edge.to)!; return <line key={i} x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy} stroke={edge.review ? "#fb7185" : "#475569"} strokeWidth={edge.review ? 2 : 1.25}><title>{edge.from} ↔ {edge.to}{edge.review ? " · residual flagged" : ""}</title></line> })}
        {!level && ellipses && layout.points.filter(p => !p.fixed).map(p => <ellipse key={p.id} cx={p.cx} cy={p.cy} rx={p.ellipseMajor95! * layout.scale * magnification} ry={p.ellipseMinor95! * layout.scale * magnification} transform={`rotate(${p.ellipseBearing! - 90} ${p.cx} ${p.cy})`} fill="#22d3ee" fillOpacity=".08" stroke="#22d3ee" strokeOpacity=".8"><title>{p.id} · 95% ellipse: {(p.ellipseMajor95! * 1000).toFixed(3)} / {(p.ellipseMinor95! * 1000).toFixed(3)} mm · shown ×{magnification}</title></ellipse>)}
        {layout.points.map(p => <g key={p.id}>
          {p.id === selected && <circle cx={p.cx} cy={p.cy} r="12" fill="none" stroke="#f8fafc" strokeWidth="2" />}
          {p.fixed ? <path d={`M ${p.cx} ${p.cy - 7} l 7 13 h -14 Z`} fill="#fbbf24"><title>{p.id} · fixed control</title></path> : <circle cx={p.cx} cy={p.cy} r="5" fill="#22d3ee"><title>{p.id} · adjusted point</title></circle>}
          {(layout.points.length <= 16 || p.id === selected) && <text x={p.cx > width - 95 ? p.cx - 10 : p.cx + 10} y={p.cy - 9} textAnchor={p.cx > width - 95 ? "end" : "start"} fill="#e2e8f0" fontSize="12">{p.id.length > 18 ? p.id.slice(0, 16) + "…" : p.id}</text>}
        </g>)}
      </g>
    </svg>
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400"><span>▲ Fixed control</span><span className="text-cyan-200">● Adjusted points</span><span className="text-rose-200">Rose lines: residuals to review</span></div>
    {level ? <p className="mt-3 text-xs leading-5 text-slate-400">RL range {layout.minY.toFixed(4)}–{layout.maxY.toFixed(4)} m. Horizontal spacing follows input order and does not represent distance or geographic position.</p> : <>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-300"><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={ellipses} onChange={e => setEllipses(e.target.checked)} />Show 95% ellipses</label><label className="flex min-h-11 items-center gap-2">Ellipse magnification ×<input type="number" min="1" max="100000" aria-label="Ellipse magnification" value={magnification} onChange={e => setMagnification(Math.max(1, Math.min(100000, Number(e.target.value) || 1)))} className="w-24 rounded-lg border border-white/20 bg-slate-950 p-2" /></label></div>
      <p className="text-xs leading-5 text-slate-400">E {layout.minX.toFixed(3)}–{layout.maxX.toFixed(3)} m · N {layout.minY.toFixed(3)}–{layout.maxY.toFixed(3)} m. Ellipses use a priori sigmas; the stated magnification affects their display only. Large ellipses can extend beyond the plot.</p>
    </>}
    {chosen && <p role="status" className="mt-3 break-words text-sm text-cyan-100">{chosen.id} · {chosen.fixed ? "fixed" : "adjusted"} · {level ? `RL ${chosen.height?.toFixed(6)} m · σH ${(chosen.sigmaH! * 1000).toFixed(3)} mm` : `E ${chosen.easting?.toFixed(6)} · N ${chosen.northing?.toFixed(6)} · 95% ellipse ${(chosen.ellipseMajor95! * 1000).toFixed(3)} / ${(chosen.ellipseMinor95! * 1000).toFixed(3)} mm`}</p>}
  </div>
}
