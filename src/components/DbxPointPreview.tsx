import { useMemo, useState } from "react"
import type { JobXmlPoint } from "../lib/jobXml"
export default function DbxPointPreview({ points, grid }: { points: JobXmlPoint[]; grid: string }) {
  const [page, setPage] = useState(0)
  const current = Math.min(page, Math.max(0, Math.ceil(points.length / 200) - 1))
  const plan = useMemo(() => {
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity
    for (const p of points) { minE = Math.min(minE, p.easting); maxE = Math.max(maxE, p.easting); minN = Math.min(minN, p.northing); maxN = Math.max(maxN, p.northing) }
    const step = Math.max(1, Math.ceil(points.length / 2000))
    return { minE, maxN, scale: Math.min(900 / Math.max(1, maxE - minE), 260 / Math.max(1, maxN - minN)), dots: points.filter((_, i) => i % step === 0) }
  }, [points])
  if (!points.length) return <p className="mt-5 text-slate-400">No points match this filter.</p>
  return <>
    <svg viewBox="0 0 1000 340" role="img" aria-label="DBX point plan preview" className="mt-5 block w-full rounded-xl border border-white/10 bg-slate-950/60"><text x="30" y="25" fill="#94a3b8" fontSize="13">N ↑ · E → · {grid} · {plan.dots.length.toLocaleString()} points drawn</text>{plan.dots.map((p) => <circle key={p.recordId} cx={50 + (p.easting - plan.minE) * plan.scale} cy={50 + (plan.maxN - p.northing) * plan.scale} r="4" fill="#22d3ee"><title>{p.id} · {p.code} · RL {p.elevation}</title></circle>)}</svg>
    <div className="mt-5 overflow-x-auto rounded-xl border border-white/10"><table className="min-w-full text-left text-xs"><caption className="p-3 text-left text-slate-400">Preview rounded to 0.001 m · exports retain full precision · {current * 200 + 1}–{Math.min(points.length, (current + 1) * 200)} of {points.length.toLocaleString()}</caption><thead className="bg-slate-950"><tr>{["Point", "Easting", "Northing", "Output RL", "Feature code", "Stored class"].map((s) => <th key={s} className="whitespace-nowrap p-3">{s}</th>)}</tr></thead><tbody>{points.slice(current * 200, (current + 1) * 200).map((p) => <tr key={p.recordId} className="border-t border-white/5 text-slate-300">{[p.id, p.easting.toFixed(3), p.northing.toFixed(3), p.elevation?.toFixed(3) ?? "Missing", p.code, p.classification].map((s, i) => <td key={i} className="whitespace-nowrap p-3">{s}</td>)}</tr>)}</tbody></table></div>
    {points.length > 200 && <div className="mt-3 flex items-center gap-4 text-sm"><button type="button" disabled={!current} onClick={() => setPage(current - 1)} className="rounded-lg border border-white/15 px-4 py-2 disabled:opacity-40">Previous</button><span>{current + 1} / {Math.ceil(points.length / 200)}</span><button type="button" disabled={(current + 1) * 200 >= points.length} onClick={() => setPage(current + 1)} className="rounded-lg border border-white/15 px-4 py-2 disabled:opacity-40">Next</button></div>}
  </>
}
