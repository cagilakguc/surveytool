import { useState } from "react"
import type { ReactNode } from "react"
export default function NetworkTable({ columns, rows, caption }: { columns: string[]; rows: ReactNode[][]; caption: string }) {
  const [page, setPage] = useState(0), size = 25, current = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1))
  return <div className="mt-4 min-w-0">
    <div className="overflow-x-auto rounded-xl border border-white/10"><table className="min-w-full text-left text-xs tabular-nums"><caption className="p-3 text-left leading-5 text-slate-400">{caption} · {rows.length ? current * size + 1 : 0}–{Math.min(rows.length, (current + 1) * size)} of {rows.length}</caption><thead className="bg-slate-950"><tr>{columns.map(c => <th key={c} className="whitespace-nowrap p-3 font-semibold">{c}</th>)}</tr></thead><tbody>{rows.slice(current * size, (current + 1) * size).map((row, i) => <tr key={i} className="border-t border-white/5 text-slate-300">{row.map((cell, j) => <td key={j} className="max-w-xs whitespace-nowrap p-3">{cell}</td>)}</tr>)}</tbody></table></div>
    {rows.length > size && <div className="mt-3 flex items-center gap-4 text-sm"><button type="button" disabled={!current} onClick={() => setPage(current - 1)} className="min-h-11 rounded-lg border border-white/20 px-4 disabled:opacity-40">Previous rows</button><span>{current + 1} / {Math.ceil(rows.length / size)}</span><button type="button" disabled={(current + 1) * size >= rows.length} onClick={() => setPage(current + 1)} className="min-h-11 rounded-lg border border-white/20 px-4 disabled:opacity-40">Next rows</button></div>}
  </div>
}
