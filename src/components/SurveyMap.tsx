import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Maximize2 } from "lucide-react"
import Map from "ol/Map.js"
import View from "ol/View.js"
import TileLayer from "ol/layer/Tile.js"
import LayerGroup from "ol/layer/Group.js"
import VectorLayer from "ol/layer/Vector.js"
import VectorSource from "ol/source/Vector.js"
import XYZ from "ol/source/XYZ.js"
import Google from "ol/source/Google.js"
import Draw from "ol/interaction/Draw.js"
import Feature from "ol/Feature.js"
import LineString from "ol/geom/LineString.js"
import { extend } from "ol/extent.js"
import { defaults as defaultControls, ScaleLine } from "ol/control.js"
import { Fill, Stroke, Style, Circle as CircleStyle } from "ol/style.js"
import type { FeatureLike } from "ol/Feature.js"
import type { LandXmlDocument } from "../lib/landxml"
import type { SurfaceComparison } from "../lib/surfaceCompare"
import type { Basemap, MapCrs } from "../lib/mapCoordinates"
import { buildSurveyMapData, mapCoordinateToSource, createMapTransform } from "../lib/surveyMapGeometry"
import { buildGisMapData } from "../lib/gisMapGeometry"
import type { SurveyGeometryLayer } from "../lib/surveyGeometry"
import type { SectionLine } from "../lib/sectionOptions"
import "ol/ol.css"
import "./SurveyMap.css"

type SurveyMapProps = { crs: MapCrs; basemap: Basemap | "google"; opacity: number; document?: LandXmlDocument; comparison?: SurfaceComparison; geometry?: SurveyGeometryLayer; geometryContext?: "survey" | "export"; heightUnitLabel?: string; fallback?: ReactNode; onSectionDraw?: (line: SectionLine) => void; sectionLine?: SectionLine | null; sectionLines?: SectionLine[] }
type Hover = { name: string; easting?: number; northing?: number; elevation?: number; difference?: number; coordinateLabel?: string }

function featureStyle(feature: FeatureLike, cache: globalThis.Map<string, Style>) {
  const group = feature.get("group") as string
  const colour = feature.get("colour") as string ?? "#22d3ee"
  const difference = feature.get("difference") as number | undefined
  const intensity = feature.get("intensity") as number ?? 0
  const key = difference === undefined ? `${group}-${feature.getGeometry()?.getType()}` : `${difference < 0 ? "cut" : "fill"}-${intensity}`
  let style = cache.get(key)
  if (!style) {
    const fill = difference === undefined ? `${colour}35` : `rgba(${difference < 0 ? "251,113,133" : "34,211,238"},${0.25 + intensity / 30 * 0.75})`
    style = new Style({
      fill: new Fill({ color: fill }),
      stroke: new Stroke({ color: difference === undefined ? colour : fill, width: group === "alignments" || group === "gis-lines" ? 3 : 1 }),
      image: new CircleStyle({ radius: 4, fill: new Fill({ color: colour }), stroke: new Stroke({ color: "#07111f", width: 1.5 }) }),
    })
    cache.set(key, style)
  }
  return style
}

export default function SurveyMap({ crs, basemap, opacity, document, comparison, geometry, geometryContext = "export", heightUnitLabel, fallback, onSectionDraw, sectionLine, sectionLines }: SurveyMapProps) {
  const target = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const vectorRef = useRef<VectorLayer | null>(null)
  const backgroundRef = useRef<LayerGroup | null>(null)
  const sectionSourceRef = useRef<VectorSource | null>(null)
  const sectionDrawRef = useRef(onSectionDraw)
  sectionDrawRef.current = onSectionDraw
  const [drawActive, setDrawActive] = useState(false)
  const drawActiveRef = useRef(false)
  drawActiveRef.current = drawActive
  const [drawError, setDrawError] = useState("")
  const [backgroundError, setBackgroundError] = useState("")
  const hiddenGroups = useRef(new Set<string>())
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<Hover | null>(null)
  const [tileError, setTileError] = useState(false)
  const [initialisationError, setInitialisationError] = useState("")
  const data = useMemo(() => {
    try {
      const points = geometry?.points.length || geometry?.lines.length || geometry?.polygons.length ? buildGisMapData(crs, geometry) : null
      const surfaces = document || comparison ? buildSurveyMapData(crs, document, comparison) : null
      if (surfaces && points) return { value: { features: [...surfaces.features, ...points.features], extent: extend(surfaces.extent.slice(), points.extent), groups: [...surfaces.groups, ...points.groups], note: [surfaces.note, points.note.replace("Export retains every feature and vertex.", "Calculations and reports retain every measured point.")].filter(Boolean).join(" ") }, error: "" }
      if (points || surfaces) return { value: points ?? surfaces, error: "" }
      throw new Error("There is no survey geometry to display.")
    }
    catch (error) { return { value: null, error: error instanceof Error ? error.message : "This coordinate system could not be used for the map." } }
  }, [crs, document, comparison, geometry])
  const canRender = data.value !== null
  const isComparison = comparison !== undefined

  useEffect(() => {
    if (!target.current || !canRender) return
    try {
      const cache = new globalThis.Map<string, Style>()
      const vector = new VectorLayer({ source: new VectorSource(), style: (feature) => hiddenGroups.current.has(feature.get("group")) ? undefined : featureStyle(feature, cache) })
      const background = new LayerGroup()
      const sections = new VectorSource()
      const sectionLayer = new VectorLayer({ source: sections, style: (feature) => new Style({ stroke: new Stroke({ color: feature.get("active") ? "#fb7185" : "#fbbf24", width: feature.get("active") ? 4 : 1.5, lineDash: feature.get("active") ? [10, 6] : undefined }) }) })
      const map = new Map({
        target: target.current, layers: [background, vector, sectionLayer],
        controls: defaultControls({ attributionOptions: { collapsible: false } }).extend([new ScaleLine()]),
        view: new View({ projection: "EPSG:3857", center: [0, 0], zoom: 2, minZoom: 1, maxZoom: 24 }),
      })
      mapRef.current = map
      vectorRef.current = vector
      backgroundRef.current = background
      sectionSourceRef.current = sections
      map.on("pointermove", (event) => {
        if (event.dragging) return
        const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate, { hitTolerance: 3 })
        setHover(feature ? { name: feature.get("name") ?? "Survey geometry", easting: feature.get("easting"), northing: feature.get("northing"), elevation: feature.get("elevation"), difference: feature.get("difference"), coordinateLabel: feature.get("coordinateLabel") ?? (isComparison ? "Cell centre" : "Point") } : null)
        if (target.current) target.current.style.cursor = drawActiveRef.current || feature ? "crosshair" : "grab"
      })
      const observer = new ResizeObserver(() => map.updateSize())
      observer.observe(target.current)
      setInitialisationError("")
      return () => {
        observer.disconnect()
        map.setTarget(undefined)
        map.dispose()
        mapRef.current = null
        vectorRef.current = null
        backgroundRef.current = null
        sectionSourceRef.current = null
      }
    } catch {
      setInitialisationError("The interactive map could not start in this browser. Use the plan view or try another browser.")
    }
  }, [canRender, isComparison])

  useEffect(() => {
    if (!data.value || !mapRef.current) return
    const source = vectorRef.current?.getSource()
    source?.clear()
    source?.addFeatures(data.value.features)
    hiddenGroups.current = new Set()
    setHidden(new Set())
    setHover(null)
    mapRef.current.getView().fit(data.value.extent, { padding: [45, 45, 45, 45], maxZoom: 20, duration: 0 })
  }, [data])

  useEffect(() => { vectorRef.current?.setOpacity(opacity / 100) }, [opacity, data])

  useEffect(() => {
    const source = sectionSourceRef.current
    if (!source || !canRender) return
    source.clear()
    try {
      const project = createMapTransform(crs)
      for (const line of sectionLines ?? []) source.addFeature(new Feature({ geometry: new LineString([project(line.start.easting, line.start.northing), project(line.end.easting, line.end.northing)]), active: false }))
      if (sectionLine) source.addFeature(new Feature({ geometry: new LineString([project(sectionLine.start.easting, sectionLine.start.northing), project(sectionLine.end.easting, sectionLine.end.northing)]), active: true }))
      setDrawError("")
    } catch { setDrawError("The section lines could not be positioned on this map. They remain available in the source-grid plan.") }
  }, [crs, sectionLine, sectionLines, canRender])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !drawActive || !sectionDrawRef.current) return
    const draw = new Draw({ type: "LineString", maxPoints: 2, stopClick: true })
    draw.on("drawend", (event) => {
      try {
        const coordinates = (event.feature.getGeometry() as LineString).getCoordinates()
        const line = { start: mapCoordinateToSource(crs, coordinates[0]), end: mapCoordinateToSource(crs, coordinates[coordinates.length - 1]) }
        if (Math.hypot(line.end.easting-line.start.easting,line.end.northing-line.start.northing) < 0.05) throw new Error("Choose two different points for the section line.")
        sectionDrawRef.current?.(line); setDrawError("")
      } catch (error) { setDrawError(error instanceof Error ? error.message : "The section could not be drawn.") }
      setDrawActive(false)
    })
    map.addInteraction(draw)
    return () => { map.removeInteraction(draw); draw.dispose() }
  }, [drawActive, canRender, crs])

  useEffect(() => {
    const background = backgroundRef.current
    if (!background) return
    let active = true
    setTileError(false)
    setBackgroundError("")
    background.setVisible(basemap !== "none")
    if (basemap === "street") {
      void import("ol-mapbox-style").then(({ MapboxVectorLayer }) => {
        if (!active) return
        const street = new MapboxVectorLayer({ styleUrl: "https://tiles.openfreemap.org/styles/liberty" })
        street.on("error", () => { if (active) setTileError(true) })
        background.getLayers().push(street)
      }).catch(() => { if (active) setTileError(true) })
    } else if (basemap === "google") {
      const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
      if (!key) setBackgroundError("Google satellite imagery is not configured yet. Choose Street map or Aerial / satellite to continue.")
      else {
        const source = new Google({ key, mapType: "satellite", language: "en", region: "NZ", highDpi: true })
        source.on("change", () => { if (active && source.getState() === "error") setBackgroundError("Google satellite imagery could not load. Choose another background while its configuration is checked.") })
        source.on("tileloaderror", () => { if (active) setTileError(true) })
        source.on("tileloadend", () => { if (active) setTileError(false) })
        background.getLayers().push(new TileLayer({ source }))
      }
    } else if (basemap === "aerial") {
      const source = new XYZ({
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        maxZoom: 19, crossOrigin: "anonymous",
        attributions: 'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      })
      let errors = 0
      source.on("tileloaderror", () => { if (active && ++errors >= 3) setTileError(true) })
      source.on("tileloadend", () => { if (active) setTileError(false) })
      background.getLayers().push(new TileLayer({ source }))
    }
    return () => {
      active = false
      const layers = background.getLayers().getArray().slice()
      background.getLayers().clear()
      layers.forEach((layer) => { if (layer instanceof TileLayer) layer.getSource()?.dispose(); layer.dispose() })
    }
  }, [basemap, canRender])

  if (data.error || initialisationError) return <div className="min-w-0 space-y-3"><div role="alert" className="rounded-3xl border border-amber-400/20 bg-amber-400/5 p-6 text-sm leading-6 text-amber-100">{data.error || initialisationError} {geometry && geometryContext === "export" ? "Your source geometry and GIS export remain available." : "Your source coordinates and calculation results are retained."}</div>{fallback}</div>

  return (
    <div className="survey-map overflow-hidden rounded-3xl border border-white/10 bg-slate-950">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <p className="min-w-0 text-xs text-slate-300"><strong className="text-white">{comparison ? "Surface difference" : "Survey map"}</strong> · {crs.code} · {basemap === "google" ? "Google satellite" : basemap === "aerial" ? "Aerial / satellite" : basemap === "street" ? "Street map" : "No background"}</p>
        {onSectionDraw&&<button type="button" onClick={()=>{setDrawActive((value)=>!value);setDrawError("")}} className="rounded-full border border-rose-300/40 bg-rose-300/10 px-3 py-1.5 text-xs font-semibold text-rose-100">{drawActive?"Cancel drawing":"Draw section line"}</button>}
        <button type="button" onClick={() => data.value && mapRef.current?.getView().fit(data.value.extent, { padding: [45, 45, 45, 45], maxZoom: 20, duration: 200 })} className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/10"><Maximize2 size={14} />{geometry ? "Fit to points" : "Fit to surface"}</button>
      </div>
      <div className="relative">
        {drawActive&&<p role="status" className="pointer-events-none absolute left-3 right-3 top-3 z-10 rounded-xl bg-slate-950/95 p-3 text-xs text-rose-100">Click the start and end of the section line on the map.</p>}
        <div ref={target} className="h-[440px] w-full outline-none sm:h-[540px]" tabIndex={0} role="region" aria-label="Interactive survey background map. Drag to pan and use the zoom buttons to zoom." onPointerLeave={() => setHover(null)} />
        {tileError && <p role="status" className="pointer-events-none absolute left-3 right-3 top-3 rounded-xl bg-slate-950/95 p-3 text-xs leading-5 text-amber-200">Background tiles could not load. Try another background, or choose No background to keep inspecting the overlay.</p>}
        {basemap==="google"&&<span className="pointer-events-none absolute bottom-2 left-3 rounded bg-white/95 px-2 py-1 text-sm font-medium text-slate-800">Google Maps</span>}
        {hover && <div className="pointer-events-none absolute bottom-10 left-3 max-w-[calc(100%-1.5rem)] rounded-xl border border-white/15 bg-slate-950/95 px-3 py-2 text-xs leading-5 text-white"><p className="font-semibold">{hover.name}</p>{Number.isFinite(hover.difference) && <p>Thickness Δ {hover.difference!.toFixed(3)} m</p>}{Number.isFinite(hover.easting) && Number.isFinite(hover.northing) && <p>{hover.coordinateLabel} · E {hover.easting!.toFixed(3)} · N {hover.northing!.toFixed(3)}</p>}{Number.isFinite(hover.elevation) && <p>{hover.coordinateLabel === "Face centre" ? "Mean face RL" : "RL"} {hover.elevation!.toFixed(3)} {document?.units ?? heightUnitLabel}</p>}</div>}
      </div>
      <div className="space-y-3 px-4 py-3 text-xs text-slate-400">
        {(backgroundError||drawError)&&<p role="alert" className="text-amber-200">{backgroundError||drawError}</p>}
        {comparison ? <div className="flex flex-wrap justify-between gap-2"><span className="text-rose-300">Rose: cut / design lower</span><span>Hover cells for thickness</span><span className="text-cyan-300">Cyan: fill / design higher</span></div> : <div className="flex flex-wrap gap-x-5 gap-y-3">{data.value?.groups.map((group) => <label key={group.id} className="flex min-w-0 items-center gap-2"><input type="checkbox" checked={!hidden.has(group.id)} onChange={(event) => {
          const next = new Set(hidden)
          if (event.target.checked) next.delete(group.id); else next.add(group.id)
          hiddenGroups.current = next
          setHidden(next)
          vectorRef.current?.changed()
        }} className="accent-cyan-400" /><span style={{ color: group.colour }}>{group.label}</span></label>)}</div>}
        {data.value?.note && <p>{data.value.note}</p>}
        {crs.note && <p className="text-amber-200">{crs.note}</p>}
        {basemap === "street" && <p><a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer" className="underline">OpenFreeMap</a> · © <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer" className="underline">OpenMapTiles</a> · Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">OpenStreetMap</a></p>}
        <p>{geometry && geometryContext === "export" ? "Map preview uses the output coordinate system. Export retains all features and vertices." : "Background imagery provides location context. Survey measurements use the source grid."}</p>
      </div>
    </div>
  )
}
