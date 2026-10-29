import { useId, useMemo, useState } from "react"
import { Globe2 } from "lucide-react"
import { localGridCode, searchCrsCatalogue } from "../lib/mapCoordinates"
import type { MapCrs, Basemap } from "../lib/mapCoordinates"
import type { MapProject } from "../lib/useMapProject"

export default function MapSettings({ project }: { project: MapProject }) {
  return (
    <section className="rounded-3xl border border-cyan-400/20 bg-slate-900/70 p-5 md:p-6" aria-label="Map and coordinate settings">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Globe2 size={20} className="text-cyan-300" />Map & coordinates</h2>
          <p className="mt-1 break-words text-xs text-slate-400">Project: {project.projectKey} · {project.storageFailed ? "Settings could not be saved on this device" : "Map preferences saved on this device"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <label className="text-xs font-medium text-slate-300">Background
            <select aria-label="Background" className="mt-1 block rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white" value={project.settings.basemap} onChange={(event) => project.setBasemap(event.target.value as Basemap)}>
              <option value="street">Street map</option><option value="aerial">Aerial / satellite</option><option value="none">No background</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-300">Overlay opacity · {project.settings.opacity}%
            <input aria-label="Overlay opacity" type="range" min="0" max="100" value={project.settings.opacity} onChange={(event) => project.setOpacity(Number(event.target.value))} className="mt-3 block w-40 max-w-full accent-cyan-400" />
          </label>
        </div>
      </div>
      <p className="mt-5 text-sm leading-6 text-slate-400">Select the coordinate system used in each file. Search by EPSG code, grid name or country. Local grids remain available in the plan view.</p>
      {project.catalogueError ? (
        <p role="alert" className="mt-4 text-sm text-amber-200">{project.catalogueError} <button type="button" onClick={project.retryCatalogue} className="ml-2 underline">Retry</button></p>
      ) : (
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          {project.selections.map((file) => (
            <CrsPicker key={file.id} label={file.label} value={file.code} catalogue={project.catalogue} loading={project.loading} onChange={(code) => project.setCrs(file, code)} note={`${file.origin}${file.document.coordinateSystem?.name ? ` · File metadata: ${file.document.coordinateSystem.name}` : ""}`} />
          ))}
        </div>
      )}
      {project.files.length > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <p>Both surfaces must share a survey grid, compatible units and a height datum for comparison.</p>
          <button type="button" disabled={!project.selections[0]?.crs} onClick={project.useFirstCrsForAll} className="rounded-full border border-white/15 px-4 py-2 font-semibold text-white hover:bg-white/10 disabled:opacity-40">Use first CRS for both files</button>
        </div>
      )}
    </section>
  )
}

function CrsPicker({ label, value, catalogue, onChange, loading, note }: {
  label: string; value: string; catalogue: MapCrs[]; onChange: (code: string) => void; loading: boolean; note: string
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
          <input id={`${id}-search`} type="search" placeholder="e.g. 2193, UTM 33N" value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 w-full min-w-0 rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500" />
        </label>
        <label className="min-w-0 text-xs text-slate-400" htmlFor={`${id}-country`}>Country / region
          <input id={`${id}-country`} type="search" placeholder="e.g. New Zealand" value={country} onChange={(event) => setCountry(event.target.value)} className="mt-1 w-full min-w-0 rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500" />
        </label>
      </div>
      <select id={`${id}-crs`} value={value} disabled={loading} onChange={(event) => onChange(event.target.value)} className="mt-3 w-full min-w-0 rounded-xl border border-white/15 bg-slate-900 px-3 py-3 text-sm text-white" aria-describedby={`${id}-note`}>
        <option value="">{loading ? "Loading coordinate systems…" : "Choose the file coordinate system"}</option>
        <option value={localGridCode}>Local / unknown grid — plan view only</option>
        {value && value !== localGridCode && !selected && <option value={value}>{value} · not available in this catalogue</option>}
        {options.map((entry) => <option key={entry.code} value={entry.code}>{entry.code} · {entry.name}</option>)}
      </select>
      <p id={`${id}-note`} className="mt-2 text-xs leading-5 text-slate-400">{note}{selected ? ` · ${selected.unit}` : ""}</p>
      {(query || country) && <p aria-live="polite" className="mt-1 text-xs text-cyan-200">{matching.length.toLocaleString()} matches{matching.length > 80 ? " · showing the first 80; refine your search" : ""}</p>}
      {!query && !country && !loading && <p className="mt-1 text-xs text-slate-500">{catalogue.length.toLocaleString()} systems available · search to see more</p>}
      {selected && <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">Area of use: {selected.area}</p>}
      {selected?.note && <p className="mt-2 text-xs leading-5 text-amber-200">{selected.note}</p>}
    </div>
  )
}
