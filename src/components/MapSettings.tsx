import CrsPicker from "./CrsPicker"
import { Globe2 } from "lucide-react"
import type { Basemap } from "../lib/mapCoordinates"
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
      <p className="mt-5 text-sm leading-6 text-slate-400">Choose a country, then the coordinate system used in each file. Search by grid name, zone or EPSG code at any time. Country filters never change a file's assigned CRS. Local grids remain available in the plan view.</p>
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
