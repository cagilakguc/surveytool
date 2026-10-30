import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import CrsPicker from "./CrsPicker"
import type { LandXmlDocument } from "../lib/landxml"
import type { SurveyPointLayer } from "../lib/surveyPoints"
import type { SurveyGeometryLayer } from "../lib/surveyGeometry"
import { detectFileCrs, isGeographicCrs, loadCrsCatalogue, localGridCode } from "../lib/mapCoordinates"
import type { MapCrs } from "../lib/mapCoordinates"
import { mapInputUnitError } from "../lib/surfaceMapAnalysis"
import type { SectionLine, SectionSettings } from "../lib/sectionOptions"

const SurveyMap = lazy(() => import("./SurveyMap"))
const googleReady = Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim())
const colours = ["#fb923c", "#e879f9", "#facc15", "#2dd4bf", "#fb7185", "#818cf8"]
export default function CrossSectionWorkspaceMap({ document, pointLayers, settings, onChange, onDraw, sectionLines, fallback }: {
  document: LandXmlDocument; pointLayers: SurveyPointLayer[]; settings: SectionSettings; onChange: (value: Partial<SectionSettings>) => void;
  onDraw: (line: SectionLine) => void; sectionLines: SectionLine[]; fallback: ReactNode
}) {
  const [catalogue, setCatalogue] = useState<MapCrs[]>([]), [error, setError] = useState(""), [retry, setRetry] = useState(0)
  useEffect(() => { let active = true; setError(""); loadCrsCatalogue().then((value) => { if (active) setCatalogue(value) }).catch(() => { if (active) setError("The coordinate-system catalogue could not load.") }); return () => { active = false } }, [retry])
  const code = settings.mapCrs ?? detectFileCrs(document.coordinateSystem, catalogue) ?? ""
  const basemap = settings.mapBasemap ?? (googleReady ? "google" : "aerial")
  const crs = catalogue.find((entry) => entry.code === code)
  const unitError = crs ? isGeographicCrs(crs) ? "Choose the actual projected survey grid to position the section workspace." : mapInputUnitError(document, crs) : ""
  const geometry = useMemo<SurveyGeometryLayer>(() => ({ name: "Selected as-built files", format: "CSV", warnings: [], lines: [], polygons: [], pointColours: Object.fromEntries(pointLayers.map((layer, index) => [layer.name, colours[index % colours.length]])),
    points: pointLayers.flatMap((layer) => layer.points.map((point) => ({ ...point, id: `${point.id}${point.code ? ` · ${point.code}` : ""}`, code: layer.name }))),
  }), [pointLayers])
  return <div className="mt-5 space-y-4">
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <CrsPicker label="Cross-section workspace" value={code} onChange={(mapCrs) => onChange({ mapCrs })} catalogue={catalogue} loading={!catalogue.length && !error} note="Choose the actual common grid used by the XML and measured files. This positions the map and drawn lines; it does not convert the input files." />
      <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
        <label className="block text-sm text-slate-300">Map background<select aria-label="Cross-section map background" value={basemap} onChange={(event) => onChange({ mapBasemap: event.target.value as SectionSettings["mapBasemap"] })} className="mt-2 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-3 text-sm">
          <option value="google" disabled={!googleReady}>Google satellite{googleReady ? "" : " — setup needed"}</option><option value="aerial">Aerial / satellite (Esri)</option><option value="street">Street map</option><option value="none">Source-grid plan (drag a line)</option>
        </select></label>
        {!googleReady&&<p className="text-xs leading-5 text-amber-200">Google imagery needs a configured Google Maps API key. Other backgrounds and section generation are available now.</p>}
        <label className="block text-xs text-slate-300">Survey overlay opacity · {settings.mapOpacity ?? 90}%<input aria-label="Cross-section overlay opacity" type="range" min="0" max="100" value={settings.mapOpacity ?? 90} onChange={(event) => onChange({ mapOpacity: Number(event.target.value) })} className="mt-3 w-full accent-cyan-400" /></label>
        <p className="text-xs leading-5 text-slate-400">On the interactive map, choose Draw section line, then click its two endpoints. In the source-grid plan, drag across the survey. Map previews are sampled; section calculations use every selected measured point.</p>
      </div>
    </div>
    {error&&<p role="alert" className="text-sm text-amber-200">{error} <button type="button" onClick={()=>setRetry((value)=>value+1)} className="underline">Retry</button></p>}
    {basemap!=="none"&&crs&&!unitError ? <Suspense fallback={fallback}><SurveyMap document={document} geometry={geometry.points.length?geometry:undefined} geometryContext="survey" crs={crs} basemap={basemap} opacity={settings.mapOpacity ?? 90} onSectionDraw={onDraw} sectionLine={settings.line} sectionLines={sectionLines} fallback={fallback} /></Suspense> : <>{basemap!=="none"&&<p role="status" className="text-sm text-amber-200">{unitError || (code===localGridCode ? "This local grid is not georeferenced. Draw sections in the plan below." : "Choose the actual survey coordinate system to display a background map. You can draw in the source-grid plan below.")}</p>}{fallback}</>}
  </div>
}
