import ProjectPanel from "../components/ProjectPanel"
import { assertGeometryLayer, record } from "../lib/projectWorkspace"
import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import type { ChangeEvent } from "react"
import { Link } from "react-router-dom"
import {
  ArrowLeft,
  Database,
  Download,
  FileArchive,
  ShieldCheck,
  Upload,
} from "lucide-react"

import PageSeo from "../components/PageSeo"
import CrsPicker from "../components/CrsPicker"
import { isGeographicCrs, loadCrsCatalogue } from "../lib/mapCoordinates"
import type { MapCrs, Basemap } from "../lib/mapCoordinates"
import { loadGisCrsDefinition } from "../lib/gisCrs"
import { readGisPreferences, saveGisPreferences, transformGlobalSurveyGeometry } from "../lib/globalGis"
import {
  createGeometryGeoPackage,
  createGeometryShapefileZip,
} from "../lib/gisGeometryExports"
import {
  geometryFeatureCount,
  geometryVertexCount,
  parseSurveyGeometryFile,
} from "../lib/surveyGeometry"
import type {
  SurveyGeometryLayer,
  SurveyVertex,
} from "../lib/surveyGeometry"

const SurveyMap = lazy(() => import("../components/SurveyMap"))

const maximumFileSize = 50 * 1024 * 1024

type GisFormat = "SHAPEFILE" | "GEOPACKAGE"

type PreviewRow = {
  type: "Point" | "Line" | "Polygon"
  id: string
  code: string
  vertices: number
  elevation: string
  x: number | null
  y: number | null
}

function downloadBinary(
  content: ArrayBuffer,
  mimeType: string,
  fileName: string,
) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  return { url, fileName }
}

function safeFileName(value: string) {
  return value
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "survey-geometry"
}

function elevationRange(vertices: SurveyVertex[]) {
  if (vertices.length === 0) return "—"
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  vertices.forEach((vertex) => {
    minimum = Math.min(minimum, vertex.elevation)
    maximum = Math.max(maximum, vertex.elevation)
  })
  return Math.abs(maximum - minimum) < 0.00005
    ? minimum.toFixed(4)
    : `${minimum.toFixed(4)}–${maximum.toFixed(4)}`
}

function createPreviewRows(layer: SurveyGeometryLayer) {
  const rows: PreviewRow[] = []

  layer.points.slice(0, 5).forEach((point) => {
    rows.push({
      type: "Point",
      id: point.id,
      code: point.code,
      vertices: 1,
      elevation: point.elevation.toFixed(4),
      x: point.easting, y: point.northing,
    })
  })

  layer.lines.slice(0, 5).forEach((line) => {
    rows.push({
      type: "Line",
      id: line.id,
      code: line.code,
      vertices: line.vertices.length,
      elevation: elevationRange(line.vertices),
      x: line.vertices[0]?.easting ?? null, y: line.vertices[0]?.northing ?? null,
    })
  })

  layer.polygons.slice(0, 5).forEach((polygon) => {
    const vertices = polygon.rings.flat()
    rows.push({
      type: "Polygon",
      id: polygon.id,
      code: polygon.code,
      vertices: vertices.length,
      elevation: elevationRange(vertices),
      x: vertices[0]?.easting ?? null, y: vertices[0]?.northing ?? null,
    })
  })

  return rows.slice(0, 12)
}

export default function GisExporter() {
  const [preferences, setPreferences] = useState(readGisPreferences)
  const { source: sourceCrs, target: targetCrs, format } = preferences
  const setSourceCrs = (source: string) => setPreferences((previous) => ({ ...previous, source }))
  const setTargetCrs = (target: string) => setPreferences((previous) => ({ ...previous, target }))
  const setFormat = (format: GisFormat) => setPreferences((previous) => ({ ...previous, format }))
  const [catalogue, setCatalogue] = useState<MapCrs[]>([])
  const [catalogueError, setCatalogueError] = useState("")
  const [catalogueAttempt, setCatalogueAttempt] = useState(0)
  const [storageFailed, setStorageFailed] = useState(false)
  useEffect(() => { setStorageFailed(!saveGisPreferences(preferences)) }, [preferences])
  useEffect(() => {
    let active = true
    setCatalogueError("")
    loadCrsCatalogue().then((entries) => { if (active) setCatalogue(entries) }).catch((error) => {
      if (active) setCatalogueError(error instanceof Error ? error.message : "Coordinate systems could not be loaded.")
    })
    return () => { active = false }
  }, [catalogueAttempt])
  const [geometryLayer, setGeometryLayer] =
    useState<SurveyGeometryLayer | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState("")
  const [preparedDownload, setPreparedDownload] = useState<{ url: string; fileName: string } | null>(null)
  useEffect(() => {
    setPreparedDownload(null)
  }, [geometryLayer, sourceCrs, targetCrs, format])
  useEffect(() => { setError("") }, [sourceCrs, targetCrs, format])
  useEffect(() => () => {
    if (preparedDownload) URL.revokeObjectURL(preparedDownload.url)
  }, [preparedDownload])

  const sourceSystem = catalogue.find((entry) => entry.code === sourceCrs)
  const targetSystem = catalogue.find((entry) => entry.code === targetCrs)
  const catalogueLoading = catalogue.length === 0 && !catalogueError
  const conversion = useMemo(() => {
    if (!geometryLayer || !sourceSystem || !targetSystem) return { layer: null, error: "" }
    try { return { layer: transformGlobalSurveyGeometry(geometryLayer, sourceSystem, targetSystem), error: "" } }
    catch (error) { return { layer: null, error: error instanceof Error ? error.message : "The selected coordinate conversion could not be completed." } }
  }, [geometryLayer, sourceSystem, targetSystem])
  const convertedLayer = conversion.layer
  const visibleError = error || catalogueError || conversion.error
  const coordinateDecimals = targetSystem && isGeographicCrs(targetSystem) ? 9 : 4

  const preview = useMemo(
    () => convertedLayer ? createPreviewRows(convertedLayer) : [],
    [convertedLayer],
  )

  async function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    await readSurveyFile(file)
  }

  async function readSurveyFile(file: File) {
    if (file.size > maximumFileSize) {
      setGeometryLayer(null)
      setError("Please choose a survey file smaller than 50 MB.")
      return
    }

    setIsReading(true)
    setError("")
    setGeometryLayer(null)
    try {
      setGeometryLayer(await parseSurveyGeometryFile(file))
    } catch (caughtError) {
      setGeometryLayer(null)
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The survey geometry file could not be opened.",
      )
    } finally {
      setIsReading(false)
    }
  }

  async function loadDemo() {
    setIsReading(true)
    setError("")
    setGeometryLayer(null)
    try {
      const response = await fetch("/examples/gis-mixed.dxf")
      if (!response.ok) throw new Error("The demo file could not be loaded. Please try again.")
      const file = new File([await response.text()], "SurveyTool-GIS-demo.dxf", { type: "application/dxf" })
      setSourceCrs("EPSG:2193")
      setTargetCrs("EPSG:2193")
      await readSurveyFile(file)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "The demo could not be opened.")
    } finally {
      setIsReading(false)
    }
  }

  async function exportFile() {
    if (!geometryLayer || !convertedLayer || !targetSystem) return

    setIsExporting(true)
    setError("")
    const baseName = safeFileName(geometryLayer.name)
    const crsName = targetSystem.code.toLowerCase().replace(":", "-")

    try {
      const outputDefinition = await loadGisCrsDefinition(targetSystem)
      if (format === "SHAPEFILE") {
        const content = createGeometryShapefileZip(
          convertedLayer,
          outputDefinition,
          `${baseName}-${crsName}`,
        )
        setPreparedDownload(downloadBinary(
          content,
          "application/zip",
          `${baseName}-${crsName}-shapefiles.zip`,
        ))
      } else {
        const content = await createGeometryGeoPackage(
          convertedLayer,
          outputDefinition,
        )
        setPreparedDownload(downloadBinary(
          content,
          "application/geopackage+sqlite3",
          `${baseName}-${crsName}.gpkg`,
        ))
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The GIS file could not be created.",
      )
    } finally {
      setIsExporting(false)
    }
  }

  const featureCount = convertedLayer
    ? geometryFeatureCount(convertedLayer)
    : 0
  const vertexCount = convertedLayer
    ? geometryVertexCount(convertedLayer)
    : 0

  return (
    <div className="relative z-10 min-h-screen px-6 py-20 md:py-24">
      <PageSeo
        title="Survey DXF to Shapefile & GeoPackage Export | SurveyTool.io"
        description="Convert CSV, TXT and DXF points, lines and polygons into Shapefile or GeoPackage. Search global EPSG coordinate systems and reproject GIS geometry in your browser."
        canonicalUrl="https://www.surveytool.io/tools/gis-export"
      />

      <div className="mx-auto max-w-7xl">
        <ProjectPanel tool="gis" disabled={isReading||isExporting} state={{geometryLayer,preferences}} onRestore={(state)=>{
          if(state.geometryLayer!==null)assertGeometryLayer(state.geometryLayer)
          const prefs=record(state.preferences)
          for(const key of ["source","target"])if(typeof prefs[key]!=="string"||!/^$|^EPSG:\d{4,6}$/.test(prefs[key] as string))throw new Error("Invalid saved CRS.")
          setGeometryLayer(state.geometryLayer as SurveyGeometryLayer|null);setPreferences(readGisPreferences({getItem:()=>JSON.stringify(prefs)}));setError("");setPreparedDownload(null)
        }}/>

        <Link
          to="/"
          className="mb-10 inline-flex items-center gap-2 text-sm font-semibold text-slate-400 transition hover:text-cyan-300"
        >
          <ArrowLeft size={18} />
          Back to home
        </Link>

        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">
              SurveyTool
            </p>
            <h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl">
              Point, Line & Polygon GIS Export
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-400">
              Convert CSV, TXT or ASCII DXF into proper GIS datasets. DXF points,
              open polylines and closed boundaries remain separate geometry instead
              of being flattened into disconnected vertices.
            </p>
          </div>

          <div className="inline-flex w-fit items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
            <ShieldCheck size={20} />
            Survey geometry stays in your browser
          </div>
        </div>

        <section className="mt-10 rounded-3xl border border-white/10 bg-white/5 p-6 md:p-8">
          <div className="grid gap-5 lg:grid-cols-2">
            <CrsPicker label="Input" value={sourceCrs} onChange={setSourceCrs} catalogue={catalogue} loading={catalogueLoading} disabled={isReading || isExporting} allowLocal={false} showMapNote={false} note="Choose the CRS used in the file. X = Easting/Longitude; Y = Northing/Latitude." />
            <CrsPicker label="GIS output" value={targetCrs} onChange={setTargetCrs} catalogue={catalogue} loading={catalogueLoading} disabled={isReading || isExporting} allowLocal={false} showMapNote={false} note="Geometry is reprojected to this CRS and its definition is included in the export." />
            <div className="flex flex-wrap gap-3 lg:col-span-2">
              <button type="button" disabled={!sourceSystem || isReading || isExporting} onClick={() => setTargetCrs(sourceCrs)} className="rounded-full border border-white/15 px-5 py-3 text-sm font-semibold hover:bg-white/10 disabled:opacity-40">Use input CRS for output</button>

            <button
              type="button"
              disabled={isReading || isExporting}
              onClick={() => void loadDemo()}
              className="rounded-full border border-cyan-400/30 px-5 py-3 font-semibold text-cyan-200 transition hover:bg-cyan-400/10 disabled:opacity-50"
            >
              Load demo
            </button>
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300">
              <Upload size={18} />
              {isReading ? "Reading geometry…" : "Choose survey file"}
              <input
                type="file"
                accept=".csv,.txt,.dxf,text/csv,text/plain,application/dxf"
                className="hidden"
                disabled={isReading || isExporting}
                onChange={handleFileChange}
              />
            </label>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-500">
            CSV and TXT create points. ASCII DXF retains POINT, INSERT, LINE,
            LWPOLYLINE and POLYLINE/VERTEX geometry. Closed polylines become polygons.
            Z values, height units and the vertical datum are preserved. Only X/Y coordinates are reprojected.
          </p>
        </section>

        <p className="mt-3 text-xs text-slate-500">{storageFailed ? "Preferences could not be saved on this device." : "CRS and export preferences are saved on this device. Confirm the input CRS for each new file."}</p>

        {visibleError && (
          <div
            role="alert"
            className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-rose-200"
          >
            {visibleError}
            {catalogueError && <button type="button" className="ml-3 underline" onClick={() => setCatalogueAttempt((value) => value + 1)}>Retry catalogue</button>}
          </div>
        )}

        {geometryLayer && !convertedLayer && <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-slate-300">Loaded {geometryLayer.name}: {geometryLayer.points.length} points, {geometryLayer.lines.length} lines and {geometryLayer.polygons.length} polygons. Select valid input and output coordinate systems to preview and export.</section>}

        {geometryLayer && convertedLayer && sourceSystem && targetSystem && (
          <div className="mt-8 space-y-8">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              <Metric label="File" value={geometryLayer.name} />
              <Metric
                label="Points"
                value={convertedLayer.points.length.toLocaleString("en-NZ")}
              />
              <Metric
                label="Lines"
                value={convertedLayer.lines.length.toLocaleString("en-NZ")}
              />
              <Metric
                label="Polygons"
                value={convertedLayer.polygons.length.toLocaleString("en-NZ")}
              />
              <Metric
                label="Total vertices"
                value={vertexCount.toLocaleString("en-NZ")}
              />
              <Metric
                label="Transformation"
                value={`${sourceSystem.code} → ${targetSystem.code}`}
              />
            </section>

            {geometryLayer.warnings.length > 0 && (
              <section className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-sm text-amber-200">
                {geometryLayer.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </section>
            )}

            <section className="space-y-4" aria-label="GIS map preview">
              <div className="flex flex-wrap items-end justify-between gap-5 rounded-2xl border border-white/10 bg-white/5 p-5">
                <div><h2 className="text-lg font-semibold">Geometry on the map</h2><p className="mt-1 text-xs text-slate-400">Preview in {targetSystem.code}. All geometry is included in the export.</p></div>
                <div className="flex flex-wrap items-center gap-5">
                  <label className="text-xs text-slate-300">Background<select aria-label="Background" value={preferences.basemap} onChange={(event) => setPreferences((previous) => ({ ...previous, basemap: event.target.value as Basemap }))} className="ml-3 rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-sm"><option value="street">Street map</option><option value="aerial">Aerial / satellite</option><option value="none">No background</option></select></label>
                  <label className="text-xs text-slate-300">Overlay opacity · {preferences.opacity}%<input aria-label="Overlay opacity" type="range" min="0" max="100" value={preferences.opacity} onChange={(event) => setPreferences((previous) => ({ ...previous, opacity: Number(event.target.value) }))} className="mt-2 block w-40 accent-cyan-400" /></label>
                </div>
              </div>
              <Suspense fallback={<p role="status" className="p-6 text-sm text-slate-400">Loading geometry map…</p>}><SurveyMap geometry={convertedLayer} crs={targetSystem} basemap={preferences.basemap} opacity={preferences.opacity} heightUnitLabel="source height units" /></Suspense>
            </section>

            <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
              <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                <div className="border-b border-white/10 px-6 py-5">
                  <h2 className="text-xl font-semibold">Retained geometry preview</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {featureCount.toLocaleString("en-NZ")} feature{featureCount === 1 ? "" : "s"} in {targetSystem.name}.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-950/60 text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Geometry</th>
                        <th className="px-4 py-3">ID</th>
                        <th className="px-4 py-3">Code / layer</th>
                        <th className="px-4 py-3">Vertices</th>
                        <th className="px-4 py-3">First X{isGeographicCrs(targetSystem) ? " / Longitude" : " / Easting"}</th>
                        <th className="px-4 py-3">First Y{isGeographicCrs(targetSystem) ? " / Latitude" : " / Northing"}</th>
                        <th className="px-4 py-3">Z (unchanged)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, index) => (
                        <tr
                          key={`${row.type}-${row.id}-${index}`}
                          className="border-t border-white/5"
                        >
                          <td className="px-4 py-3 font-medium text-cyan-200">
                            {row.type}
                          </td>
                          <td className="px-4 py-3 font-medium text-white">
                            {row.id}
                          </td>
                          <td className="px-4 py-3 text-slate-400">
                            {row.code || "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-300">
                            {row.vertices.toLocaleString("en-NZ")}
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-300">
                            {row.x?.toFixed(coordinateDecimals) ?? "—"}
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-300">{row.y?.toFixed(coordinateDecimals) ?? "—"}</td>
                          <td className="px-4 py-3 font-mono text-slate-300">
                            {row.elevation}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-4">
                <FormatCard
                  disabled={isReading || isExporting}
                  selected={format === "SHAPEFILE"}
                  icon={FileArchive}
                  title="Shapefile ZIP"
                  description="Creates separate PointZ, PolyLineZ and PolygonZ datasets inside one ZIP. Each geometry set includes SHP, SHX, DBF, PRJ and UTF-8 CPG files."
                  onSelect={() => setFormat("SHAPEFILE")}
                />
                <FormatCard
                  disabled={isReading || isExporting}
                  selected={format === "GEOPACKAGE"}
                  icon={Database}
                  title="GeoPackage"
                  description="Creates one OGC SQLite file with separate survey_points, survey_lines and survey_polygons feature tables plus CRS metadata."
                  onSelect={() => setFormat("GEOPACKAGE")}
                />

                {format === "GEOPACKAGE" && (
                  <p className="rounded-2xl border border-blue-400/20 bg-blue-400/5 p-4 text-xs leading-5 text-blue-200/80">
                    An internet connection is needed for the first GeoPackage
                    export. Your survey data stays in your browser.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void exportFile()}
                  disabled={isReading || isExporting || featureCount === 0}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download size={18} />
                  {isExporting
                    ? format === "GEOPACKAGE"
                      ? "Building geometry GeoPackage…"
                      : "Building geometry Shapefiles…"
                    : format === "GEOPACKAGE"
                      ? "Download GeoPackage"
                      : "Download Shapefile ZIP"}
                </button>
                {preparedDownload && <div role="status" className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-100"><p className="font-semibold">Your GIS file is ready</p><a href={preparedDownload.url} download={preparedDownload.fileName} className="mt-2 block break-all underline">Download {preparedDownload.fileName}</a></div>}
              </div>
            </section>
          </div>
        )}

        <section className="mt-8 rounded-3xl border border-amber-300/20 bg-amber-300/5 p-6 text-sm leading-6 text-amber-100/80">
          <strong className="text-amber-200">Geometry note:</strong>{" "}
          Model-space points and straight linework are retained with their heights.
          Block references become insertion points. Curves, arcs, splines,
          hatches and Civil 3D proxy objects are currently skipped rather than being
          silently converted into inaccurate geometry.
        </section>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 truncate font-semibold text-white" title={value}>{value}</p>
    </div>
  )
}

function FormatCard({
  disabled,
  selected,
  icon: Icon,
  title,
  description,
  onSelect,
}: {
  disabled?: boolean
  selected: boolean
  icon: typeof Database
  title: string
  description: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`w-full rounded-2xl border p-5 text-left transition ${
        selected
          ? "border-cyan-400/50 bg-cyan-400/10"
          : "border-white/10 bg-white/5 hover:bg-white/10"
      }`}
    >
      <Icon size={24} className={selected ? "text-cyan-300" : "text-slate-400"} />
      <h3 className="mt-4 font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
    </button>
  )
}
