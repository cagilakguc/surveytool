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
  createGeoPackage,
  createShapefileZip,
} from "../lib/gisExports"
import { transformSurveyPoints } from "../lib/surveyFileConversion"
import { parseSurveyPointFile } from "../lib/surveyPointFile"
import type { SurveyPointLayer } from "../lib/surveyPointFile"

const maximumFileSize = 50 * 1024 * 1024

type GisFormat = "SHAPEFILE" | "GEOPACKAGE"

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
    .replace(/^-+|-+$/g, "") || "survey-points"
}

export default function GisExporter() {
  const [sourceCrs, setSourceCrs] =
    useState<CoordinateReferenceSystem>("EPSG:2105")
  const [targetCrs, setTargetCrs] =
    useState<CoordinateReferenceSystem>("EPSG:2193")
  const [format, setFormat] = useState<GisFormat>("SHAPEFILE")
  const [pointLayer, setPointLayer] =
    useState<SurveyPointLayer | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState("")

  const sourceSystem = getCoordinateSystem(sourceCrs)
  const targetSystem = getCoordinateSystem(targetCrs)

  const convertedPoints = useMemo(() => {
    if (!pointLayer) return []
    try {
      return transformSurveyPoints(
        pointLayer.points,
        sourceCrs,
        targetCrs,
      )
    } catch {
      return []
    }
  }, [pointLayer, sourceCrs, targetCrs])

  async function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    if (file.size > maximumFileSize) {
      setPointLayer(null)
      setError("Please choose a point file smaller than 50 MB.")
      return
    }

    setIsReading(true)
    setError("")
    try {
      setPointLayer(await parseSurveyPointFile(file))
    } catch (caughtError) {
      setPointLayer(null)
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The survey point file could not be opened.",
      )
    } finally {
      setIsReading(false)
    }
  }

  async function exportFile() {
    if (!pointLayer || convertedPoints.length === 0) return

    setIsExporting(true)
    setError("")
    const baseName = safeFileName(pointLayer.name)
    const crsName = targetSystem.shortName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")

    try {
      if (format === "SHAPEFILE") {
        const content = createShapefileZip(
          convertedPoints,
          targetCrs,
          `${baseName}-${crsName}`,
        )
        downloadBinary(
          content,
          "application/zip",
          `${baseName}-${crsName}-shapefile.zip`,
        )
      } else {
        const content = await createGeoPackage(
          convertedPoints,
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

  const preview = convertedPoints.slice(0, 12)
  const coordinateDigits = targetCrs === "EPSG:4167" ? 9 : 4

  return (
    <div className="relative z-10 min-h-screen px-6 py-20 md:py-24">
      <PageSeo
        title="Survey Point Shapefile & GeoPackage Export | SurveyTool.io"
        description="Convert CSV, TXT or DXF survey points into Shapefile ZIP or GeoPackage. Reproject Mount Eden, NZTM and NZGD2000 coordinates in your browser."
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
              Shapefile & GeoPackage Export
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-400">
              Turn CSV, TXT or ASCII DXF survey points into proper GIS datasets.
              Transform Mount Eden, NZTM or NZGD2000 coordinates and retain point
              IDs, RLs and feature codes.
            </p>
          </div>

          <div className="inline-flex w-fit items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
            <ShieldCheck size={20} />
            Point data stays in your browser
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
              {isReading ? "Reading file…" : "Choose point file"}
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
            Supported input: CSV, TXT and ASCII DXF. CSV/TXT may include Point ID,
            Easting, Northing, Elevation/RL and Code columns.
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

        {pointLayer && (
          <div className="mt-8 space-y-8">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="File" value={pointLayer.name} />
              <Metric label="Input format" value={pointLayer.format} />
              <Metric
                label="Survey points"
                value={pointLayer.points.length.toLocaleString("en-NZ")}
              />
              <Metric
                label="Transformation"
                value={`${sourceSystem.shortName} → ${targetSystem.shortName}`}
              />
            </section>

            {pointLayer.warnings.length > 0 && (
              <section className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-sm text-amber-200">
                {pointLayer.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </section>
            )}

            <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
              <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                <div className="border-b border-white/10 px-6 py-5">
                  <h2 className="text-xl font-semibold">Transformed preview</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    First {preview.length.toLocaleString("en-NZ")} points in {targetSystem.name}.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-950/60 text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Point</th>
                        <th className="px-4 py-3">{targetSystem.coordinateLabels[0]}</th>
                        <th className="px-4 py-3">{targetSystem.coordinateLabels[1]}</th>
                        <th className="px-4 py-3">RL</th>
                        <th className="px-4 py-3">Code</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((point, index) => (
                        <tr
                          key={`${point.id}-${index}`}
                          className="border-t border-white/5"
                        >
                          <td className="px-4 py-3 font-medium text-white">{point.id}</td>
                          <td className="px-4 py-3 font-mono text-slate-300">
                            {point.easting.toFixed(coordinateDigits)}
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-300">
                            {point.northing.toFixed(coordinateDigits)}
                          </td>
                          <td className="px-4 py-3 text-slate-300">
                            {point.elevation.toFixed(4)}
                          </td>
                          <td className="px-4 py-3 text-slate-400">
                            {point.code || "—"}
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
                  description="PointZ geometry with SHP, SHX, DBF, PRJ and UTF-8 CPG components. Best for legacy GIS and client handover requirements."
                  onSelect={() => setFormat("SHAPEFILE")}
                />
                <FormatCard
                  selected={format === "GEOPACKAGE"}
                  icon={Database}
                  title="GeoPackage"
                  description="A single OGC SQLite file with a 3D point feature table, CRS metadata and unrestricted attribute names. Best for QGIS and modern GIS workflows."
                  onSelect={() => setFormat("GEOPACKAGE")}
                />

                {format === "GEOPACKAGE" && (
                  <p className="rounded-2xl border border-blue-400/20 bg-blue-400/5 p-4 text-xs leading-5 text-blue-200/80">
                    SurveyTool downloads the SQLite WebAssembly runtime when the
                    first GeoPackage is created. Your survey points are not uploaded.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void exportFile()}
                  disabled={isExporting || convertedPoints.length === 0}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download size={18} />
                  {isExporting
                    ? format === "GEOPACKAGE"
                      ? "Building GeoPackage…"
                      : "Building Shapefile…"
                    : format === "GEOPACKAGE"
                      ? "Download GeoPackage"
                      : "Download Shapefile ZIP"}
                </button>
              </div>
            </section>
          </div>
        )}

        <section className="mt-8 rounded-3xl border border-amber-300/20 bg-amber-300/5 p-6 text-sm leading-6 text-amber-100/80">
          <strong className="text-amber-200">Format note:</strong>{" "}
          Shapefile attribute names and text widths are restricted by the legacy
          dBASE format. GeoPackage is the preferred modern handover format when
          the receiving software supports it.
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
