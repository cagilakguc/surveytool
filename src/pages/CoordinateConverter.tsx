import {
  useMemo,
  useState,
} from "react"
import type {
  ChangeEvent,
} from "react"
import { Link } from "react-router-dom"
import {
  ArrowLeft,
  ArrowRightLeft,
  Download,
  FileOutput,
  MapPinned,
  ShieldCheck,
  Upload,
} from "lucide-react"

import PageSeo from "../components/PageSeo"
import {
  coordinateSystems,
  getCoordinateSystem,
  transformCoordinate,
} from "../lib/nzCoordinates"
import type {
  CoordinateReferenceSystem,
} from "../lib/nzCoordinates"
import {
  createSurveyOutput,
  transformSurveyPoints,
} from "../lib/surveyFileConversion"
import type {
  SurveyOutputFormat,
} from "../lib/surveyFileConversion"
import {
  parseSurveyPointFile,
} from "../lib/surveyPointFile"
import type {
  SurveyPointLayer,
} from "../lib/surveyPointFile"

const maximumFileSize = 50 * 1024 * 1024

const outputFormats: Array<{
  id: SurveyOutputFormat
  label: string
  description: string
}> = [
  {
    id: "CSV",
    label: "CSV",
    description: "Point ID, coordinates, elevation and code",
  },
  {
    id: "TXT",
    label: "TXT",
    description: "Tab-separated survey point file",
  },
  {
    id: "DXF",
    label: "DXF",
    description: "CAD points with point labels",
  },
  {
    id: "KML",
    label: "KML",
    description: "Google Earth point placemarks",
  },
  {
    id: "GEOJSON",
    label: "GeoJSON",
    description: "GIS-ready point feature collection",
  },
]

function parseNumber(value: string) {
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

function downloadContent(
  content: string,
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

export default function CoordinateConverter() {
  const [sourceCrs, setSourceCrs] =
    useState<CoordinateReferenceSystem>("EPSG:2105")
  const [targetCrs, setTargetCrs] =
    useState<CoordinateReferenceSystem>("EPSG:2193")
  const [firstCoordinate, setFirstCoordinate] = useState("399922.7115")
  const [secondCoordinate, setSecondCoordinate] = useState("803464.5423")
  const [singleError, setSingleError] = useState("")
  const [pointLayer, setPointLayer] =
    useState<SurveyPointLayer | null>(null)
  const [fileError, setFileError] = useState("")
  const [isReading, setIsReading] = useState(false)
  const [outputFormat, setOutputFormat] =
    useState<SurveyOutputFormat>("CSV")

  const sourceSystem = getCoordinateSystem(sourceCrs)
  const targetSystem = getCoordinateSystem(targetCrs)

  const singleResult = useMemo(() => {
    const first = parseNumber(firstCoordinate)
    const second = parseNumber(secondCoordinate)

    if (first === null || second === null) {
      return null
    }

    try {
      return transformCoordinate(
        { x: first, y: second },
        sourceCrs,
        targetCrs,
      )
    } catch {
      return null
    }
  }, [firstCoordinate, secondCoordinate, sourceCrs, targetCrs])

  const convertedPoints = useMemo(() => {
    if (!pointLayer) {
      return []
    }

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

  function swapCoordinateSystems() {
    setSourceCrs(targetCrs)
    setTargetCrs(sourceCrs)

    if (singleResult) {
      setFirstCoordinate(singleResult.x.toFixed(
        targetCrs === "EPSG:4167" ? 9 : 4,
      ))
      setSecondCoordinate(singleResult.y.toFixed(
        targetCrs === "EPSG:4167" ? 9 : 4,
      ))
    }

    setSingleError("")
  }

  function validateSinglePoint() {
    const first = parseNumber(firstCoordinate)
    const second = parseNumber(secondCoordinate)

    if (first === null || second === null) {
      setSingleError("Enter two valid coordinate values.")
      return
    }

    try {
      transformCoordinate(
        { x: first, y: second },
        sourceCrs,
        targetCrs,
      )
      setSingleError("")
    } catch (caughtError) {
      setSingleError(
        caughtError instanceof Error
          ? caughtError.message
          : "The coordinate could not be converted.",
      )
    }
  }

  async function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]
    event.target.value = ""

    if (!file) {
      return
    }

    if (file.size > maximumFileSize) {
      setPointLayer(null)
      setFileError("Please choose a point file smaller than 50 MB.")
      return
    }

    setIsReading(true)
    setFileError("")

    try {
      const parsed = await parseSurveyPointFile(file)
      setPointLayer(parsed)
    } catch (caughtError) {
      setPointLayer(null)
      setFileError(
        caughtError instanceof Error
          ? caughtError.message
          : "The point file could not be read.",
      )
    } finally {
      setIsReading(false)
    }
  }

  function downloadConvertedFile() {
    if (!pointLayer || convertedPoints.length === 0) {
      return
    }

    try {
      const output = createSurveyOutput(
        convertedPoints,
        targetCrs,
        outputFormat,
      )
      const baseName =
        pointLayer.name.replace(/\.[^/.]+$/, "") ||
        "converted-survey-points"
      const crsSuffix =
        outputFormat === "KML" || outputFormat === "GEOJSON"
          ? "geographic"
          : targetSystem.shortName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")

      downloadContent(
        output.content,
        output.mimeType,
        `${baseName}-${crsSuffix}.${output.extension}`,
      )
      setFileError("")
    } catch (caughtError) {
      setFileError(
        caughtError instanceof Error
          ? caughtError.message
          : "The converted file could not be created.",
      )
    }
  }

  const singleDigits = targetCrs === "EPSG:4167" ? 9 : 4
  const preview = convertedPoints.slice(0, 12)

  return (
    <div className="relative z-10 min-h-screen px-6 py-20 md:py-24">
      <PageSeo
        title="Mount Eden to NZTM Coordinate & File Converter | SurveyTool.io"
        description="Convert coordinates and survey point files between Mount Eden 2000 and NZTM2000. Export CSV, TXT, DXF, KML or GeoJSON in your browser."
        canonicalUrl="https://www.surveytool.io/tools/coordinate-converter"
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
              NZ Coordinate & File Converter
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-400">
              Convert Mount Eden 2000, NZTM2000 and NZGD2000 geographic
              coordinates. Batch-convert CSV, TXT and ASCII DXF survey points
              and export them to CAD, spreadsheet, Google Earth or GIS formats.
            </p>
          </div>

          <div className="inline-flex w-fit items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
            <ShieldCheck size={20} />
            Processed privately in your browser
          </div>
        </div>

        <section className="mt-10 rounded-3xl border border-white/10 bg-white/5 p-6 md:p-8">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-cyan-400/10 p-3 text-cyan-300">
              <MapPinned size={27} />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">
                Single coordinate
              </p>
              <h2 className="mt-2 text-2xl font-semibold">
                Mount Eden ↔ NZTM
              </h2>
            </div>
          </div>

          <div className="mt-7 grid gap-5 lg:grid-cols-[1fr_auto_1fr] lg:items-end">
            <CoordinateSystemSelect
              label="Input coordinate system"
              value={sourceCrs}
              onChange={setSourceCrs}
            />

            <button
              type="button"
              onClick={swapCoordinateSystems}
              className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/15 text-cyan-300 transition hover:bg-white/10"
              aria-label="Swap coordinate systems"
            >
              <ArrowRightLeft size={20} />
            </button>

            <CoordinateSystemSelect
              label="Output coordinate system"
              value={targetCrs}
              onChange={setTargetCrs}
            />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <CoordinateInput
              label={sourceSystem.coordinateLabels[0]}
              value={firstCoordinate}
              onChange={setFirstCoordinate}
            />
            <CoordinateInput
              label={sourceSystem.coordinateLabels[1]}
              value={secondCoordinate}
              onChange={setSecondCoordinate}
            />
          </div>

          <button
            type="button"
            onClick={validateSinglePoint}
            className="mt-5 rounded-full bg-cyan-400 px-6 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
          >
            Convert coordinate
          </button>

          {singleError && (
            <p className="mt-4 text-sm text-rose-300">{singleError}</p>
          )}

          {singleResult && !singleError && (
            <div className="mt-6 grid gap-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5 sm:grid-cols-2">
              <ResultValue
                label={targetSystem.coordinateLabels[0]}
                value={singleResult.x.toFixed(singleDigits)}
              />
              <ResultValue
                label={targetSystem.coordinateLabels[1]}
                value={singleResult.y.toFixed(singleDigits)}
              />
            </div>
          )}
        </section>

        <section className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 md:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-violet-400/10 p-3 text-violet-300">
                <FileOutput size={27} />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-violet-300">
                  Batch file conversion
                </p>
                <h2 className="mt-2 text-2xl font-semibold">
                  Survey point conversion hub
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                  Input CSV, TXT or ASCII DXF. Reproject the points and export
                  CSV, TXT, DXF, KML or GeoJSON. DXF input extracts POINT,
                  INSERT, VERTEX, LINE and LWPOLYLINE coordinates.
                </p>
              </div>
            </div>

            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-violet-300 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-violet-200">
              <Upload size={17} />
              {isReading ? "Reading file…" : "Choose point file"}
              <input
                type="file"
                accept=".csv,.txt,.dxf,text/csv,text/plain,application/dxf"
                className="hidden"
                disabled={isReading}
                onChange={handleFileChange}
              />
            </label>
          </div>

          {fileError && (
            <div
              role="alert"
              className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-rose-200"
            >
              {fileError}
            </div>
          )}

          {pointLayer && (
            <div className="mt-7 space-y-7">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <BatchMetric label="File" value={pointLayer.name} />
                <BatchMetric label="Input format" value={pointLayer.format} />
                <BatchMetric
                  label="Valid points"
                  value={pointLayer.points.length.toLocaleString("en-NZ")}
                />
                <BatchMetric
                  label="Conversion"
                  value={`${sourceSystem.shortName} → ${targetSystem.shortName}`}
                />
              </div>

              {pointLayer.warnings.length > 0 && (
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-sm text-amber-200">
                  {pointLayer.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              )}

              <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
                <div className="overflow-hidden rounded-2xl border border-white/10">
                  <div className="border-b border-white/10 bg-slate-950/60 px-5 py-4">
                    <h3 className="font-semibold">Converted preview</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-white/5 text-slate-400">
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
                            <td className="px-4 py-3 font-medium text-white">
                              {point.id}
                            </td>
                            <td className="px-4 py-3 text-slate-300">
                              {point.easting.toFixed(targetCrs === "EPSG:4167" ? 9 : 4)}
                            </td>
                            <td className="px-4 py-3 text-slate-300">
                              {point.northing.toFixed(targetCrs === "EPSG:4167" ? 9 : 4)}
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

                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
                  <h3 className="font-semibold">Download format</h3>
                  <div className="mt-4 space-y-2">
                    {outputFormats.map((format) => (
                      <label
                        key={format.id}
                        className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                          outputFormat === format.id
                            ? "border-cyan-400/50 bg-cyan-400/10"
                            : "border-white/10 hover:bg-white/5"
                        }`}
                      >
                        <input
                          type="radio"
                          name="output-format"
                          value={format.id}
                          checked={outputFormat === format.id}
                          onChange={() => setOutputFormat(format.id)}
                          className="mt-1 accent-cyan-400"
                        />
                        <span>
                          <strong className="block text-sm text-white">
                            {format.label}
                          </strong>
                          <span className="mt-1 block text-xs leading-5 text-slate-400">
                            {format.description}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>

                  {(outputFormat === "KML" ||
                    outputFormat === "GEOJSON") && (
                    <p className="mt-4 text-xs leading-5 text-amber-200/80">
                      Mapping exports are written as longitude and latitude.
                      Elevation is retained as the third coordinate.
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={downloadConvertedFile}
                    disabled={convertedPoints.length === 0}
                    className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download size={18} />
                    Download {outputFormat === "GEOJSON" ? "GeoJSON" : outputFormat}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="mt-8 rounded-3xl border border-amber-300/20 bg-amber-300/5 p-6 text-sm leading-6 text-amber-100/80">
          <strong className="text-amber-200">Survey note:</strong>{" "}
          Mount Eden 2000 and NZTM2000 are both NZGD2000 projections, so
          elevations are carried through unchanged. KML and GeoJSON are mapping
          exports; use official geodetic software and current deformation models
          where centimetre-level WGS84 epoch transformation is required.
        </section>
      </div>
    </div>
  )
}

type CoordinateSystemSelectProps = {
  label: string
  value: CoordinateReferenceSystem
  onChange: (value: CoordinateReferenceSystem) => void
}

function CoordinateSystemSelect({
  label,
  value,
  onChange,
}: CoordinateSystemSelectProps) {
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

function CoordinateInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-sm text-slate-300">
      <span className="mb-2 block">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 font-mono text-white outline-none focus:border-cyan-400"
      />
    </label>
  )
}

function ResultValue({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 break-all font-mono text-xl font-semibold text-white">
        {value}
      </p>
    </div>
  )
}

function BatchMetric({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 truncate font-semibold text-white" title={value}>
        {value}
      </p>
    </div>
  )
}
