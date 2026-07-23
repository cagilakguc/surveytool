import { useMemo, useState } from "react"
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
import {
  coordinateSystems,
  getCoordinateSystem,
} from "../lib/nzCoordinates"
import type { CoordinateReferenceSystem } from "../lib/nzCoordinates"
import {
  createGeometryGeoPackage,
  createGeometryShapefileZip,
} from "../lib/gisGeometryExports"
import {
  geometryFeatureCount,
  geometryVertexCount,
  parseSurveyGeometryFile,
  transformSurveyGeometryLayer,
} from "../lib/surveyGeometry"
import type {
  SurveyGeometryLayer,
  SurveyVertex,
} from "../lib/surveyGeometry"

const maximumFileSize = 50 * 1024 * 1024

type GisFormat = "SHAPEFILE" | "GEOPACKAGE"

type PreviewRow = {
  type: "Point" | "Line" | "Polygon"
  id: string
  code: string
  vertices: number
  elevation: string
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
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
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
    })
  })

  layer.lines.slice(0, 5).forEach((line) => {
    rows.push({
      type: "Line",
      id: line.id,
      code: line.code,
      vertices: line.vertices.length,
      elevation: elevationRange(line.vertices),
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
    })
  })

  return rows.slice(0, 12)
}

export default function GisExporter() {
  const [sourceCrs, setSourceCrs] =
    useState<CoordinateReferenceSystem>("EPSG:2105")
  const [targetCrs, setTargetCrs] =
    useState<CoordinateReferenceSystem>("EPSG:2193")
  const [format, setFormat] = useState<GisFormat>("SHAPEFILE")
  const [geometryLayer, setGeometryLayer] =
    useState<SurveyGeometryLayer | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState("")

  const sourceSystem = getCoordinateSystem(sourceCrs)
  const targetSystem = getCoordinateSystem(targetCrs)

  const convertedLayer = useMemo(() => {
    if (!geometryLayer) return null
    try {
      return transformSurveyGeometryLayer(
        geometryLayer,
        sourceCrs,
        targetCrs,
      )
    } catch {
      return null
    }
  }, [geometryLayer, sourceCrs, targetCrs])

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

    if (file.size > maximumFileSize) {
      setGeometryLayer(null)
      setError("Please choose a survey file smaller than 50 MB.")
      return
    }

    setIsReading(true)
    setError("")
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

  async function exportFile() {
    if (!geometryLayer || !convertedLayer) return

    setIsExporting(true)
    setError("")
    const baseName = safeFileName(geometryLayer.name)
    const crsName = targetSystem.shortName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")

    try {
      if (format === "SHAPEFILE") {
        const content = createGeometryShapefileZip(
          convertedLayer,
          targetCrs,
          `${baseName}-${crsName}`,
        )
        downloadBinary(
          content,
          "application/zip",
          `${baseName}-${crsName}-shapefiles.zip`,
        )
      } else {
        const content = await createGeometryGeoPackage(
          convertedLayer,
          targetCrs,
        )
        downloadBinary(
          content,
          "application/geopackage+sqlite3",
          `${baseName}-${crsName}.gpkg`,
        )
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
        description="Convert CSV, TXT or DXF survey geometry into point, line and polygon Shapefiles or GeoPackage. Reproject Mount Eden, NZTM and NZGD2000 coordinates in your browser."
        canonicalUrl="https://www.surveytool.io/tools/gis-export"
      />

      <div className="mx-auto max-w-7xl">
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
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
            <CrsSelect
              label="Input coordinate system"
              value={sourceCrs}
              onChange={setSourceCrs}
            />
            <CrsSelect
              label="GIS output coordinate system"
              value={targetCrs}
              onChange={setTargetCrs}
            />
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

          <p className="mt-4 text-sm text-slate-500">
            CSV and TXT create points. ASCII DXF retains POINT, INSERT, LINE,
            LWPOLYLINE and POLYLINE/VERTEX geometry. Closed polylines become polygons.
          </p>
        </section>

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-rose-200"
          >
            {error}
          </div>
        )}

        {geometryLayer && convertedLayer && (
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
                value={`${sourceSystem.shortName} → ${targetSystem.shortName}`}
              />
            </section>

            {geometryLayer.warnings.length > 0 && (
              <section className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-sm text-amber-200">
                {geometryLayer.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </section>
            )}

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
                        <th className="px-4 py-3">RL range</th>
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
                  selected={format === "SHAPEFILE"}
                  icon={FileArchive}
                  title="Shapefile ZIP"
                  description="Creates separate PointZ, PolyLineZ and PolygonZ datasets inside one ZIP. Each geometry set includes SHP, SHX, DBF, PRJ and UTF-8 CPG files."
                  onSelect={() => setFormat("SHAPEFILE")}
                />
                <FormatCard
                  selected={format === "GEOPACKAGE"}
                  icon={Database}
                  title="GeoPackage"
                  description="Creates one OGC SQLite file with separate survey_points, survey_lines and survey_polygons feature tables plus CRS metadata."
                  onSelect={() => setFormat("GEOPACKAGE")}
                />

                {format === "GEOPACKAGE" && (
                  <p className="rounded-2xl border border-blue-400/20 bg-blue-400/5 p-4 text-xs leading-5 text-blue-200/80">
                    SurveyTool downloads the SQLite WebAssembly runtime when the
                    first GeoPackage is created. Your geometry is not uploaded.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void exportFile()}
                  disabled={isExporting || featureCount === 0}
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
              </div>
            </section>
          </div>
        )}

        <section className="mt-8 rounded-3xl border border-amber-300/20 bg-amber-300/5 p-6 text-sm leading-6 text-amber-100/80">
          <strong className="text-amber-200">Geometry note:</strong>{" "}
          Straight DXF line and polyline segments are retained. Curves, arcs, splines,
          hatches and Civil 3D proxy objects are currently skipped rather than being
          silently converted into inaccurate geometry.
        </section>
      </div>
    </div>
  )
}

function CrsSelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: CoordinateReferenceSystem
  onChange: (value: CoordinateReferenceSystem) => void
}) {
  return (
    <label className="block text-sm text-slate-300">
      <span className="mb-2 block">{label}</span>
      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value as CoordinateReferenceSystem)
        }
        className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-400"
      >
        {coordinateSystems.map((system) => (
          <option key={system.id} value={system.id}>
            {system.name} ({system.id})
          </option>
        ))}
      </select>
    </label>
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
  selected,
  icon: Icon,
  title,
  description,
  onSelect,
}: {
  selected: boolean
  icon: typeof Database
  title: string
  description: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
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
