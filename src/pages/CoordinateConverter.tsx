import ProjectPanel from "../components/ProjectPanel"
import { assertPointLayer } from "../lib/projectWorkspace"
import {
  useEffect,
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
import CrsPicker from "../components/CrsPicker"
import { crsUnitScale, isGeographicCrs, loadCrsCatalogue } from "../lib/mapCoordinates"
import type { MapCrs } from "../lib/mapCoordinates"
import { createGlobalCoordinateTransform } from "../lib/globalGis"
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
  if (!value.trim()) return null
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
  const [sourceCrs, setSourceCrs] = useState("")
  const [targetCrs, setTargetCrs] = useState("EPSG:4326")
  const [firstCoordinate, setFirstCoordinate] = useState("")
  const [secondCoordinate, setSecondCoordinate] = useState("")
  const [singleError, setSingleError] = useState("")
  const [pointLayer, setPointLayer] = useState<SurveyPointLayer | null>(null)
  const [fileError, setFileError] = useState("")
  const [isReading, setIsReading] = useState(false)
  const [outputFormat, setOutputFormat] = useState<SurveyOutputFormat>("CSV")
  const [catalogue, setCatalogue] = useState<MapCrs[]>([])
  const [catalogueError, setCatalogueError] = useState("")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setCatalogueError("")
    loadCrsCatalogue().then((entries) => { if (active) setCatalogue(entries) })
      .catch((error) => { if (active) setCatalogueError(error instanceof Error ? error.message : "Coordinate systems could not be loaded.") })
    return () => { active = false }
  }, [attempt])
  const catalogueLoading = !catalogue.length && !catalogueError
  const sourceDefinition = catalogue.find((entry) => entry.code === sourceCrs)
  const targetDefinition = catalogue.find((entry) => entry.code === targetCrs)
  const labels = (crs?: MapCrs) => crs && isGeographicCrs(crs)
    ? ["Longitude (X)", "Latitude (Y)"] : ["Easting (X)", "Northing (Y)"]
  const sourceSystem = { shortName: sourceDefinition?.code ?? "Unassigned", coordinateLabels: labels(sourceDefinition) }
  const targetSystem = { shortName: targetDefinition?.code ?? "Unassigned", coordinateLabels: labels(targetDefinition) }
  const singleDigits = targetDefinition && isGeographicCrs(targetDefinition) ? 9 : 4

  const singleConversion = useMemo(() => {
    const first = parseNumber(firstCoordinate)
    const second = parseNumber(secondCoordinate)
    if (!sourceDefinition || !targetDefinition || first === null || second === null) return { point: null, error: "" }
    try {
      const result = createGlobalCoordinateTransform(sourceDefinition, targetDefinition)({ easting: first, northing: second, elevation: 0 })
      return { point: { x: result.easting, y: result.northing }, error: "" }
    } catch (error) {
      return { point: null, error: error instanceof Error ? error.message : "The coordinate could not be converted." }
    }
  }, [firstCoordinate, secondCoordinate, sourceDefinition, targetDefinition])
  const singleResult = singleConversion.point
  const displayedSingleError = singleError || singleConversion.error

  const batchConversion = useMemo(() => {
    if (!pointLayer) return { points: [], error: "" }
    if (!sourceDefinition || !targetDefinition) return { points: [], error: "Choose the actual input CRS and an output CRS to convert this file." }
    try { return { points: transformSurveyPoints(pointLayer.points, sourceDefinition, targetDefinition), error: "" } }
    catch (error) { return { points: [], error: error instanceof Error ? error.message : "The points could not be converted." } }
  }, [pointLayer, sourceDefinition, targetDefinition])
  const convertedPoints = batchConversion.points

  function swapCoordinateSystems() {
    setSourceCrs(targetCrs)
    setTargetCrs(sourceCrs)
    if (singleResult) {
      setFirstCoordinate(singleResult.x.toFixed(singleDigits))
      setSecondCoordinate(singleResult.y.toFixed(singleDigits))
    }
    setSingleError("")
    setFileError("")
  }
  function validateSinglePoint() {
    if (!sourceDefinition || !targetDefinition) setSingleError("Choose both coordinate systems first.")
    else if (parseNumber(firstCoordinate) === null || parseNumber(secondCoordinate) === null) setSingleError("Enter two valid coordinate values.")
    else setSingleError(singleConversion.error)
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
    if (!pointLayer || !targetDefinition || convertedPoints.length === 0) {
      return
    }

    try {
      const output = createSurveyOutput(
        convertedPoints,
        targetDefinition,
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

  const preview = convertedPoints.slice(0, 12)

  return (
    <div className="relative z-10 min-h-screen px-6 py-20 md:py-24">
      <PageSeo
        title="Global Coordinate & File Converter | SurveyTool.io"
        description="Choose a country, grid or EPSG code to convert coordinates and survey point files worldwide. Export CSV, TXT, DXF, KML or GeoJSON in your browser."
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
              Global Coordinate & File Converter
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-400">
              Choose a country and coordinate system, or search directly by EPSG
              code. Convert individual coordinates or CSV, TXT and ASCII DXF
              survey points, then export to CAD, spreadsheet or mapping formats.
            </p>
          </div>

          <div className="inline-flex w-fit items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
            <ShieldCheck size={20} />
            Processed privately in your browser
          </div>
        </div>

        <ProjectPanel tool="coordinates" disabled={isReading} state={{sourceCrs,targetCrs,pointLayer,firstCoordinate,secondCoordinate,outputFormat}} onRestore={(state)=>{
          if(state.pointLayer!==null)assertPointLayer(state.pointLayer)
          for(const key of ["sourceCrs","targetCrs"])if(typeof state[key]!=="string"||!/^$|^EPSG:\d{4,6}$/.test(state[key] as string))throw new Error("Invalid saved CRS.")
          if(typeof state.firstCoordinate!=="string"||typeof state.secondCoordinate!=="string"||!["CSV","TXT","DXF","KML","GEOJSON"].includes(String(state.outputFormat)))throw new Error("Invalid saved conversion settings.")
          setSourceCrs(state.sourceCrs as string);setTargetCrs(state.targetCrs as string);setPointLayer(state.pointLayer as SurveyPointLayer|null);setFirstCoordinate(state.firstCoordinate);setSecondCoordinate(state.secondCoordinate);setOutputFormat(state.outputFormat as SurveyOutputFormat);setSingleError("");setFileError("")
        }}/>
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
                Convert between coordinate systems
              </h2>
            </div>
          </div>

          <button type="button" onClick={() => { setSourceCrs("EPSG:2105"); setTargetCrs("EPSG:2193"); setFirstCoordinate("399922.7115"); setSecondCoordinate("803464.5423"); setSingleError(""); setFileError("") }} className="mt-5 rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-cyan-200 hover:bg-white/10">Load NZ example</button>
          {catalogueError && <p role="alert" className="mt-4 text-sm text-amber-200">{catalogueError} <button type="button" onClick={() => setAttempt((value) => value + 1)} className="underline">Retry</button></p>}
          <div className="mt-7 grid gap-5 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
            <CrsPicker label="Input" value={sourceCrs} onChange={(code) => { setSourceCrs(code); setSingleError(""); setFileError("") }} catalogue={catalogue} loading={catalogueLoading} allowLocal={false} showMapNote={false} note="Choose the actual source CRS. X = Easting/Longitude; Y = Northing/Latitude." />

            <button
              type="button"
              onClick={swapCoordinateSystems}
              className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/15 text-cyan-300 transition hover:bg-white/10"
              aria-label="Swap coordinate systems"
            >
              <ArrowRightLeft size={20} />
            </button>

            <CrsPicker label="Output" value={targetCrs} onChange={(code) => { setTargetCrs(code); setSingleError(""); setFileError("") }} catalogue={catalogue} loading={catalogueLoading} allowLocal={false} showMapNote={false} note="Applies to the single-coordinate result and CSV, TXT and DXF file conversion below." />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <CoordinateInput
              label={`${sourceSystem.coordinateLabels[0]}${sourceDefinition ? ` · ${sourceDefinition.unit}` : ""}`}
              value={firstCoordinate}
              onChange={(value) => { setFirstCoordinate(value); setSingleError("") }}
            />
            <CoordinateInput
              label={`${sourceSystem.coordinateLabels[1]}${sourceDefinition ? ` · ${sourceDefinition.unit}` : ""}`}
              value={secondCoordinate}
              onChange={(value) => { setSecondCoordinate(value); setSingleError("") }}
            />
          </div>

          <button
            type="button"
            onClick={validateSinglePoint}
            className="mt-5 rounded-full bg-cyan-400 px-6 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
          >
            Convert coordinate
          </button>

          {displayedSingleError && (
            <p className="mt-4 text-sm text-rose-300">{displayedSingleError}</p>
          )}

          {singleResult && !displayedSingleError && (
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

          {(fileError || batchConversion.error) && (
            <div
              role="alert"
              className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-rose-200"
            >
              {fileError || batchConversion.error}
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
                              {point.easting.toFixed(singleDigits)}
                            </td>
                            <td className="px-4 py-3 text-slate-300">
                              {point.northing.toFixed(singleDigits)}
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
                      KML and GeoJSON are written as WGS 84 longitude and latitude.
                      Elevation is retained as the third coordinate.
                    </p>
                  )}

                  {outputFormat === "DXF" && targetDefinition && (isGeographicCrs(targetDefinition) || crsUnitScale(targetDefinition) !== 1) && <p className="mt-4 text-xs text-amber-200">Choose a projected output CRS in metres for DXF export.</p>}
                  <button
                    type="button"
                    onClick={downloadConvertedFile}
                    disabled={convertedPoints.length === 0 || (outputFormat === "DXF" && (!targetDefinition || isGeographicCrs(targetDefinition) || crsUnitScale(targetDefinition) !== 1))}
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
          Horizontal conversion retains elevation values, height units and the
          original vertical datum. KML and GeoJSON use WGS 84 longitude/latitude.
          Conversions requiring unavailable datum grids are reported. Use current
          geodetic models where a survey requires an epoch-aware transformation.
        </section>
      </div>
    </div>
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
