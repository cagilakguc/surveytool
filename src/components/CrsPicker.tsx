import { useEffect, useId, useMemo, useState } from "react"
import { isGeographicCrs, localGridCode, searchCrsCatalogue } from "../lib/mapCoordinates"
import type { MapCrs } from "../lib/mapCoordinates"
import {
  commonCrsCodes, countryMatchesCrs, crsCountries, normaliseCountryText,
  readCrsPickerPreferences, requiredDatumGrids, resolveCrsCountry, saveCrsPickerPreferences,
} from "../lib/crsSelection"

const pageSize = 100
const preferencesEvent = "surveytool:crs-picker-changed"
const fieldClass = "mt-1 w-full min-w-0 rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300 disabled:opacity-50"

export default function CrsPicker({ label, value, catalogue, onChange, loading, note = "", allowLocal = true, showMapNote = true, disabled = false }: {
  label: string; value: string; catalogue: MapCrs[]; onChange: (code: string) => void; loading: boolean; note?: string; allowLocal?: boolean; showMapNote?: boolean; disabled?: boolean
}) {
  const id = useId()
  const [query, setQuery] = useState("")
  const [saved] = useState(readCrsPickerPreferences)
  const [country, setCountry] = useState(saved.country)
  const [countrySearch, setCountrySearch] = useState("")
  const [recent, setRecent] = useState(saved.recent)
  const [kind, setKind] = useState("all")
  const [visibleCount, setVisibleCount] = useState(pageSize)
  const [storageFailed, setStorageFailed] = useState(false)
  useEffect(() => {
    const update = () => setRecent(readCrsPickerPreferences().recent)
    window.addEventListener(preferencesEvent, update)
    window.addEventListener("storage", update)
    return () => { window.removeEventListener(preferencesEvent, update); window.removeEventListener("storage", update) }
  }, [])

  const countryOptions = useMemo(() => {
    const search = normaliseCountryText(countrySearch)
    return crsCountries.filter((entry) => entry.code === country || entry.code === resolveCrsCountry(countrySearch) || !search || normaliseCountryText(`${entry.name} ${entry.code}`).includes(search))
  }, [countrySearch, country])
  const directCode = /^\s*(?:EPSG\s*:?\s*)?\d{4,6}\s*$/i.test(query)
  const matching = useMemo(() => searchCrsCatalogue(catalogue, query, directCode ? "" : country)
    .filter((entry) => kind === "all" || (kind === "geographic") === isGeographicCrs(entry)), [catalogue, query, country, directCode, kind])
  const selected = catalogue.find((entry) => entry.code === value)
  const common = useMemo(() => {
    const codes = commonCrsCodes(catalogue, country)
    return codes.flatMap((code) => matching.find((entry) => entry.code === code) ?? [])
  }, [catalogue, matching, country])
  const recentOptions = recent.flatMap((code) => matching.find((entry) => entry.code === code) ?? [])
  const priority = new Set([...common, ...recentOptions].map((entry) => entry.code))
  const remaining = matching.filter((entry) => !priority.has(entry.code))
  const visible = remaining.slice(0, visibleCount)
  const selectedOutside = selected && ![...common, ...recentOptions, ...visible].some((entry) => entry.code === selected.code)
  const grids = selected ? requiredDatumGrids(selected) : []

  function changeCountry(next: string) {
    setCountry(next)
    setCountrySearch("")
    setVisibleCount(pageSize)
    setStorageFailed(!saveCrsPickerPreferences({ ...readCrsPickerPreferences(), country: next }))
    // Country is a browsing filter. Changing it never reassigns a file's CRS.
  }
  function choose(code: string) {
    onChange(code)
    if (!/^EPSG:\d{4,6}$/.test(code)) return
    const next = [code, ...readCrsPickerPreferences().recent.filter((entry) => entry !== code)].slice(0, 8)
    setRecent(next)
    setStorageFailed(!saveCrsPickerPreferences({ country, recent: next }))
    window.dispatchEvent(new Event(preferencesEvent))
  }
  const option = (entry: MapCrs) => <option key={entry.code} value={entry.code}>{entry.name} · {entry.code} · {entry.unit}</option>

  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
      <h3 className="text-sm font-semibold text-slate-200">{label} coordinate system</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label className="block text-xs text-slate-400" htmlFor={`${id}-country-search`}>1. Country / territory
            <input id={`${id}-country-search`} type="search" placeholder="Find a country or ISO code" disabled={disabled} value={countrySearch} onChange={(event) => setCountrySearch(event.target.value)} className={`${fieldClass} placeholder:text-slate-500`} />
          </label>
          <select id={`${id}-country`} aria-label={`${label} country / territory`} value={country} onChange={(event) => changeCountry(event.target.value)} disabled={disabled} className={fieldClass}>
            <option value="">All countries / Global</option>
            {countryOptions.map((entry) => <option key={entry.code} value={entry.code}>{entry.name}</option>)}
          </select>
          {countrySearch && countryOptions.length === 0 && <p className="mt-1 text-xs text-slate-400">No countries found.</p>}
        </div>
        <div className="min-w-0">
          <label className="block text-xs text-slate-400" htmlFor={`${id}-search`}>2. Grid name, zone or EPSG code
            <input id={`${id}-search`} type="search" placeholder="e.g. NZTM, UTM 33N, 2193" disabled={disabled} value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(pageSize) }} className={`${fieldClass} placeholder:text-slate-500`} />
          </label>
          <select aria-label={`${label} system type`} value={kind} onChange={(event) => { setKind(event.target.value); setVisibleCount(pageSize) }} disabled={disabled} className={fieldClass}>
            <option value="all">All system types</option><option value="projected">Projected grids</option><option value="geographic">Geographic (longitude / latitude)</option>
          </select>
        </div>
      </div>
      <label htmlFor={`${id}-crs`} className="mt-3 block text-xs text-slate-400">3. Coordinate system</label>
      <select id={`${id}-crs`} aria-label={`${label} coordinate system`} value={value} disabled={loading || disabled} onChange={(event) => choose(event.target.value)} className={`${fieldClass} py-3`} aria-describedby={`${id}-note ${id}-matches`}>
        <option value="">{loading ? "Loading coordinate systems…" : "Choose a coordinate system"}</option>
        {allowLocal && <option value={localGridCode}>Local / unknown grid — plan view only</option>}
        {value && value !== localGridCode && !selected && <option value={value}>{value} · not available in this catalogue</option>}
        {selectedOutside && <optgroup label="Current selection (outside these results)">{option(selected)}</optgroup>}
        {recentOptions.length > 0 && <optgroup label="Recently used">{recentOptions.map(option)}</optgroup>}
        {common.length > 0 && <optgroup label="Common systems">{common.filter((entry) => !recentOptions.includes(entry)).map(option)}</optgroup>}
        {visible.length > 0 && <optgroup label="Other systems (including older datums)">{visible.map(option)}</optgroup>}
      </select>
      <p id={`${id}-matches`} aria-live="polite" className="mt-2 text-xs text-cyan-200">{loading ? "Loading catalogue…" : `${matching.length.toLocaleString()} matching systems · ${catalogue.length.toLocaleString()} in the catalogue`}</p>
      {remaining.length > visibleCount && <button type="button" disabled={disabled} onClick={() => setVisibleCount((count) => count + pageSize)} className="mt-2 rounded-full border border-cyan-300/30 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-300/10 disabled:opacity-50">Show next {Math.min(pageSize, remaining.length - visibleCount)} systems</button>}
      {!loading && matching.length === 0 && <p className="mt-1 text-xs text-slate-400">No matches. Try another name or zone, or choose All countries / Global.</p>}
      {directCode && country && <p className="mt-1 text-xs text-slate-400">Direct EPSG lookup searches all countries.</p>}
      {selected && country && !countryMatchesCrs(selected, country) && <p className="mt-2 text-xs text-amber-200">The selected CRS is outside this country filter. Choose another system to change it.</p>}
      <p id={`${id}-note`} className="mt-2 text-xs leading-5 text-slate-400">{note}</p>
      {selected && <p className="mt-2 text-xs leading-5 text-slate-300"><strong>{selected.code}</strong> · {selected.unit}<br />Area of use: {selected.area}</p>}
      {grids.length > 0 && <p className="mt-2 text-xs leading-5 text-amber-200">Some conversions require a datum grid ({grids.join(", ")}). Exporting in the same CRS keeps coordinates unchanged.</p>}
      {showMapNote && selected?.note && <p className="mt-2 text-xs leading-5 text-amber-200">{selected.note}</p>}
      {storageFailed && <p role="status" className="mt-2 text-xs text-amber-200">Recent selections could not be saved on this device.</p>}
    </div>
  )
}
