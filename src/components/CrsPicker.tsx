import { useId, useMemo, useState } from "react"
import { localGridCode, searchCrsCatalogue } from "../lib/mapCoordinates"
import type { MapCrs } from "../lib/mapCoordinates"

export default function CrsPicker({ label, value, catalogue, onChange, loading, note = "", allowLocal = true, showMapNote = true, disabled = false }: {
  label: string; value: string; catalogue: MapCrs[]; onChange: (code: string) => void; loading: boolean; note?: string; allowLocal?: boolean; showMapNote?: boolean; disabled?: boolean
}) {
  const id = useId()
  const [query, setQuery] = useState("")
  const [country, setCountry] = useState("")
  const matching = useMemo(() => searchCrsCatalogue(catalogue, query, country), [catalogue, query, country])
  const selected = catalogue.find((entry) => entry.code === value)
  const popular = ["EPSG:4326", "EPSG:32631", "EPSG:32632", "EPSG:32633", "EPSG:32634", "EPSG:32635", "EPSG:32636", "EPSG:32755", "EPSG:32756", "EPSG:32760", "EPSG:2193", "EPSG:2105", "EPSG:27700", "EPSG:28355", "EPSG:28356", "EPSG:7855", "EPSG:7856", "EPSG:2263", "EPSG:5254"]
  const options = query || country ? matching.slice(0, 80) : popular.flatMap((code) => catalogue.find((entry) => entry.code === code) ?? [])
  if (selected && !options.includes(selected)) options.unshift(selected)

  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
      <label htmlFor={`${id}-crs`} className="text-sm font-semibold text-slate-200">{label} coordinate system</label>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] gap-2">
        <label className="min-w-0 text-xs text-slate-400" htmlFor={`${id}-search`}>EPSG code or grid name
          <input id={`${id}-search`} type="search" placeholder="e.g. 2193, UTM 33N" disabled={disabled} value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 w-full min-w-0 rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500" />
        </label>
        <label className="min-w-0 text-xs text-slate-400" htmlFor={`${id}-country`}>Country / region
          <input id={`${id}-country`} type="search" placeholder="e.g. New Zealand" disabled={disabled} value={country} onChange={(event) => setCountry(event.target.value)} className="mt-1 w-full min-w-0 rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500" />
        </label>
      </div>
      <select id={`${id}-crs`} value={value} disabled={loading || disabled} onChange={(event) => onChange(event.target.value)} className="mt-3 w-full min-w-0 rounded-xl border border-white/15 bg-slate-900 px-3 py-3 text-sm text-white" aria-describedby={`${id}-note`}>
        <option value="">{loading ? "Loading coordinate systems…" : "Choose the file coordinate system"}</option>
        {allowLocal && <option value={localGridCode}>Local / unknown grid — plan view only</option>}
        {value && value !== localGridCode && !selected && <option value={value}>{value} · not available in this catalogue</option>}
        {options.map((entry) => <option key={entry.code} value={entry.code}>{entry.code} · {entry.name}</option>)}
      </select>
      <p id={`${id}-note`} className="mt-2 text-xs leading-5 text-slate-400">{note}{selected ? ` · ${selected.unit}` : ""}</p>
      {(query || country) && <p aria-live="polite" className="mt-1 text-xs text-cyan-200">{matching.length.toLocaleString()} matches{matching.length > 80 ? " · showing the first 80; refine your search" : ""}</p>}
      {!query && !country && !loading && <p className="mt-1 text-xs text-slate-500">{catalogue.length.toLocaleString()} systems available · search to see more</p>}
      {selected && <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">Area of use: {selected.area}</p>}
      {showMapNote && selected?.note && <p className="mt-2 text-xs leading-5 text-amber-200">{selected.note}</p>}
    </div>
  )
}
