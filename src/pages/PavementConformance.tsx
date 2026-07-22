import {
  useMemo,
  useRef,
  useState,
} from "react"
import type {
  ChangeEvent,
  DragEvent,
  ReactNode,
} from "react"
import { Link } from "react-router-dom"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  RotateCcw,
  ShieldCheck,
  Upload,
} from "lucide-react"

import PageSeo from "../components/PageSeo"

type SurveyPoint = {
  id: string
  easting: number
  northing: number
  elevation: number
  code: string
}

type ParsedSurveyFile = {
  name: string
  points: SurveyPoint[]
  warnings: string[]
}

type MatchMode = "auto" | "point-id" | "coordinate"

type ConformanceResult = {
  id: string
  easting: number
  northing: number
  bottomElevation: number
  topElevation: number
  thicknessMm: number
  deviationMm: number
  status: "pass" | "fail"
  matchMethod: "point-id" | "coordinate"
  horizontalDifference: number
  code: string
}

type MatchSummary = {
  results: ConformanceResult[]
  unmatchedBottom: number
  unmatchedTop: number
}

const maximumFileSize = 50 * 1024 * 1024
const maximumRows = 250000

const demoBottom = `Point ID,Easting,Northing,Elevation,Code
BC001,1755000.000,5923000.000,11.750,BASE
BC002,1755010.000,5923000.000,11.780,BASE
BC003,1755020.000,5923000.000,11.810,BASE
BC004,1755030.000,5923000.000,11.840,BASE
BC005,1755040.000,5923000.000,11.870,BASE
BC006,1755050.000,5923000.000,11.900,BASE`

const demoTop = `Point ID,Easting,Northing,Elevation,Code
BC001,1755000.008,5923000.004,12.002,AC20
BC002,1755010.004,5923000.009,12.025,AC20
BC003,1755019.995,5923000.006,12.048,AC20
BC004,1755030.006,5922999.996,12.115,AC20
BC005,1755040.009,5923000.003,12.087,AC20
BC006,1755050.003,5923000.007,12.160,AC20`

const headerAliases = {
  id: [
    "id",
    "pointid",
    "point",
    "pointno",
    "pointnumber",
    "ptno",
    "number",
    "name",
  ],
  easting: [
    "easting",
    "east",
    "x",
    "coordx",
    "xcoordinate",
  ],
  northing: [
    "northing",
    "north",
    "y",
    "coordy",
    "ycoordinate",
  ],
  elevation: [
    "elevation",
    "level",
    "rl",
    "z",
    "height",
    "reducedlevel",
  ],
  code: [
    "code",
    "featurecode",
    "description",
    "desc",
    "layer",
  ],
}

function normaliseHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function parseDelimitedLine(line: string, delimiter: string) {
  if (delimiter === "whitespace") {
    return line.trim().split(/\s+/)
  }

  const values: string[] = []
  let value = ""
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }

    if (character === delimiter && !quoted) {
      values.push(value.trim())
      value = ""
      continue
    }

    value += character
  }

  values.push(value.trim())
  return values
}

function detectDelimiter(line: string) {
  const candidates = [",", "\t", ";"]
  const best = candidates
    .map((delimiter) => ({
      delimiter,
      columns: parseDelimitedLine(line, delimiter).length,
    }))
    .sort((a, b) => b.columns - a.columns)[0]

  return best && best.columns > 1
    ? best.delimiter
    : "whitespace"
}

function findHeaderIndex(headers: string[], aliases: string[]) {
  return headers.findIndex((header) => aliases.includes(header))
}

function parseSurveyText(
  text: string,
  fileName: string,
): ParsedSurveyFile {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("#") &&
        !line.startsWith("//"),
    )

  if (lines.length === 0) {
    throw new Error(`${fileName} does not contain any readable rows.`)
  }

  const delimiter = detectDelimiter(lines[0])
  const rows = lines.slice(0, maximumRows + 1).map((line) =>
    parseDelimitedLine(line, delimiter),
  )
  const firstHeaders = rows[0].map(normaliseHeader)
  const headerIndexes = {
    id: findHeaderIndex(firstHeaders, headerAliases.id),
    easting: findHeaderIndex(
      firstHeaders,
      headerAliases.easting,
    ),
    northing: findHeaderIndex(
      firstHeaders,
      headerAliases.northing,
    ),
    elevation: findHeaderIndex(
      firstHeaders,
      headerAliases.elevation,
    ),
    code: findHeaderIndex(firstHeaders, headerAliases.code),
  }
  const hasHeader =
    headerIndexes.easting >= 0 &&
    headerIndexes.northing >= 0 &&
    headerIndexes.elevation >= 0
  const dataRows = hasHeader ? rows.slice(1) : rows
  const inferredIndexes = hasHeader
    ? headerIndexes
    : dataRows[0]?.length >= 4
      ? {
          id: 0,
          easting: 1,
          northing: 2,
          elevation: 3,
          code: 4,
        }
      : {
          id: -1,
          easting: 0,
          northing: 1,
          elevation: 2,
          code: 3,
        }
  const warnings: string[] = []
  const points: SurveyPoint[] = []
  let skippedRows = 0

  dataRows.forEach((row, index) => {
    const easting = Number(row[inferredIndexes.easting])
    const northing = Number(row[inferredIndexes.northing])
    const elevation = Number(row[inferredIndexes.elevation])

    if (
      !Number.isFinite(easting) ||
      !Number.isFinite(northing) ||
      !Number.isFinite(elevation)
    ) {
      skippedRows += 1
      return
    }

    const rawId =
      inferredIndexes.id >= 0
        ? row[inferredIndexes.id]?.trim()
        : ""

    points.push({
      id: rawId || String(index + 1),
      easting,
      northing,
      elevation,
      code:
        inferredIndexes.code >= 0
          ? row[inferredIndexes.code]?.trim() ?? ""
          : "",
    })
  })

  if (points.length === 0) {
    throw new Error(
      `${fileName} needs readable Easting, Northing and Elevation columns.`,
    )
  }

  if (!hasHeader) {
    warnings.push(
      "No recognised header row was found. Column order was inferred as Point ID, Easting, Northing, Elevation and Code.",
    )
  }

  if (skippedRows > 0) {
    warnings.push(
      `${skippedRows.toLocaleString("en-NZ")} row(s) were skipped because their coordinates or elevation were invalid.`,
    )
  }

  if (lines.length > maximumRows + 1) {
    warnings.push(
      `Only the first ${maximumRows.toLocaleString("en-NZ")} rows were processed.`,
    )
  }

  return {
    name: fileName,
    points,
    warnings,
  }
}

function pointKey(point: SurveyPoint, cellSize: number) {
  return `${Math.floor(point.easting / cellSize)}:${Math.floor(
    point.northing / cellSize,
  )}`
}

function matchSurveyPoints(
  bottom: SurveyPoint[],
  top: SurveyPoint[],
  targetThicknessMm: number,
  toleranceMm: number,
  coordinateTolerance: number,
  mode: MatchMode,
): MatchSummary {
  const safeCoordinateTolerance = Math.max(
    coordinateTolerance,
    0.0001,
  )
  const bottomById = new Map<string, number[]>()
  const coordinateGrid = new Map<string, number[]>()

  bottom.forEach((point, index) => {
    const normalisedId = point.id.trim().toLowerCase()
    const existingIds = bottomById.get(normalisedId)

    if (existingIds) {
      existingIds.push(index)
    } else {
      bottomById.set(normalisedId, [index])
    }

    const key = pointKey(point, safeCoordinateTolerance)
    const existingCell = coordinateGrid.get(key)

    if (existingCell) {
      existingCell.push(index)
    } else {
      coordinateGrid.set(key, [index])
    }
  })

  const usedBottom = new Set<number>()
  const results: ConformanceResult[] = []
  let unmatchedTop = 0

  function nearestCoordinateMatch(point: SurveyPoint) {
    const cellX = Math.floor(
      point.easting / safeCoordinateTolerance,
    )
    const cellY = Math.floor(
      point.northing / safeCoordinateTolerance,
    )
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY

    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const candidates =
          coordinateGrid.get(
            `${cellX + offsetX}:${cellY + offsetY}`,
          ) ?? []

        candidates.forEach((candidateIndex) => {
          if (usedBottom.has(candidateIndex)) {
            return
          }

          const candidate = bottom[candidateIndex]
          const distance = Math.hypot(
            point.easting - candidate.easting,
            point.northing - candidate.northing,
          )

          if (
            distance <= safeCoordinateTolerance &&
            distance < bestDistance
          ) {
            bestDistance = distance
            bestIndex = candidateIndex
          }
        })
      }
    }

    return bestIndex >= 0
      ? {
          index: bestIndex,
          distance: bestDistance,
          method: "coordinate" as const,
        }
      : null
  }

  top.forEach((topPoint) => {
    let match: {
      index: number
      distance: number
      method: "point-id" | "coordinate"
    } | null = null

    if (mode !== "coordinate") {
      const idCandidates =
        bottomById.get(topPoint.id.trim().toLowerCase()) ?? []
      const availableIdIndex = idCandidates.find(
        (candidateIndex) => !usedBottom.has(candidateIndex),
      )

      if (availableIdIndex !== undefined) {
        const candidate = bottom[availableIdIndex]
        match = {
          index: availableIdIndex,
          distance: Math.hypot(
            topPoint.easting - candidate.easting,
            topPoint.northing - candidate.northing,
          ),
          method: "point-id",
        }
      }
    }

    if (!match && mode !== "point-id") {
      match = nearestCoordinateMatch(topPoint)
    }

    if (!match) {
      unmatchedTop += 1
      return
    }

    usedBottom.add(match.index)
    const bottomPoint = bottom[match.index]
    const thicknessMm =
      (topPoint.elevation - bottomPoint.elevation) * 1000
    const deviationMm = thicknessMm - targetThicknessMm
    const status =
      Math.abs(deviationMm) <= toleranceMm
        ? "pass"
        : "fail"

    results.push({
      id: topPoint.id || bottomPoint.id,
      easting: topPoint.easting,
      northing: topPoint.northing,
      bottomElevation: bottomPoint.elevation,
      topElevation: topPoint.elevation,
      thicknessMm,
      deviationMm,
      status,
      matchMethod: match.method,
      horizontalDifference: match.distance,
      code: topPoint.code || bottomPoint.code,
    })
  })

  return {
    results,
    unmatchedBottom: bottom.length - usedBottom.size,
    unmatchedTop,
  }
}

function escapeCsv(value: string | number) {
  const text = String(value)
  return /[",\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text
}

function downloadText(
  content: string,
  fileName: string,
  mimeType: string,
) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = window.document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function formatLevel(value: number) {
  return value.toFixed(3)
}

function formatMillimetres(value: number) {
  return value.toFixed(0)
}

export default function PavementConformance() {
  const bottomInputRef = useRef<HTMLInputElement>(null)
  const topInputRef = useRef<HTMLInputElement>(null)
  const [bottomFile, setBottomFile] =
    useState<ParsedSurveyFile | null>(null)
  const [topFile, setTopFile] =
    useState<ParsedSurveyFile | null>(null)
  const [targetThicknessMm, setTargetThicknessMm] =
    useState(250)
  const [toleranceMm, setToleranceMm] = useState(20)
  const [coordinateTolerance, setCoordinateTolerance] =
    useState(0.05)
  const [matchMode, setMatchMode] =
    useState<MatchMode>("auto")
  const [error, setError] = useState("")

  const comparison = useMemo(() => {
    if (!bottomFile || !topFile) {
      return null
    }

    return matchSurveyPoints(
      bottomFile.points,
      topFile.points,
      targetThicknessMm,
      Math.max(toleranceMm, 0),
      Math.max(coordinateTolerance, 0.0001),
      matchMode,
    )
  }, [
    bottomFile,
    coordinateTolerance,
    matchMode,
    targetThicknessMm,
    toleranceMm,
    topFile,
  ])

  const statistics = useMemo(() => {
    const results = comparison?.results ?? []

    if (results.length === 0) {
      return null
    }

    const thicknesses = results.map(
      (result) => result.thicknessMm,
    )
    const passed = results.filter(
      (result) => result.status === "pass",
    ).length

    return {
      minimum: Math.min(...thicknesses),
      maximum: Math.max(...thicknesses),
      average:
        thicknesses.reduce((sum, value) => sum + value, 0) /
        thicknesses.length,
      passed,
      failed: results.length - passed,
      compliance: (passed / results.length) * 100,
    }
  }, [comparison])

  async function readFile(
    file: File,
    role: "bottom" | "top",
  ) {
    if (file.size > maximumFileSize) {
      setError(`${file.name} is larger than 50 MB.`)
      return
    }

    try {
      const parsed = parseSurveyText(await file.text(), file.name)

      if (role === "bottom") {
        setBottomFile(parsed)
      } else {
        setTopFile(parsed)
      }
      setError("")
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The selected survey file could not be read.",
      )
    }
  }

  function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
    role: "bottom" | "top",
  ) {
    const file = event.target.files?.[0]
    if (file) {
      void readFile(file, role)
    }
    event.target.value = ""
  }

  function handleDrop(
    event: DragEvent<HTMLDivElement>,
    role: "bottom" | "top",
  ) {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file) {
      void readFile(file, role)
    }
  }

  function loadDemo() {
    setBottomFile(
      parseSurveyText(demoBottom, "demo-bottom-base.csv"),
    )
    setTopFile(
      parseSurveyText(demoTop, "demo-top-ac20.csv"),
    )
    setTargetThicknessMm(250)
    setToleranceMm(20)
    setCoordinateTolerance(0.05)
    setMatchMode("auto")
    setError("")
  }

  function reset() {
    setBottomFile(null)
    setTopFile(null)
    setError("")
  }

  function exportReport() {
    if (!comparison || comparison.results.length === 0) {
      return
    }

    const metadata = [
      ["SurveyTool Pavement Conformance Report"],
      ["Bottom file", bottomFile?.name ?? ""],
      ["Top file", topFile?.name ?? ""],
      ["Target thickness (mm)", targetThicknessMm],
      ["Tolerance (mm)", toleranceMm],
      ["Coordinate match tolerance (m)", coordinateTolerance],
      ["Match mode", matchMode],
      ["Matched points", comparison.results.length],
      ["Unmatched bottom points", comparison.unmatchedBottom],
      ["Unmatched top points", comparison.unmatchedTop],
      [],
    ]
    const headers = [
      "Point ID",
      "Easting",
      "Northing",
      "Bottom RL",
      "Top RL",
      "Thickness mm",
      "Deviation mm",
      "Status",
      "Match method",
      "Horizontal difference m",
      "Code",
    ]
    const rows = comparison.results.map((result) => [
      result.id,
      result.easting.toFixed(3),
      result.northing.toFixed(3),
      result.bottomElevation.toFixed(3),
      result.topElevation.toFixed(3),
      result.thicknessMm.toFixed(1),
      result.deviationMm.toFixed(1),
      result.status.toUpperCase(),
      result.matchMethod,
      result.horizontalDifference.toFixed(3),
      result.code,
    ])
    const csv = [...metadata, headers, ...rows]
      .map((row) => row.map(escapeCsv).join(","))
      .join("\n")

    downloadText(
      csv,
      `pavement-conformance-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`,
      "text/csv;charset=utf-8",
    )
  }

  return (
    <div className="relative z-10 min-h-screen px-6 py-20 md:py-24">
      <PageSeo
        title="Pavement Thickness Conformance Report | SurveyTool.io"
        description="Compare bottom and top pavement survey CSV or TXT files, calculate layer thickness, apply tolerances and export a conformance report online."
        canonicalUrl="https://www.surveytool.io/tools/pavement-conformance"
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
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              Pavement Conformance Report
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-400">
              Upload the bottom and top survey point files, match common
              locations, calculate constructed thickness and instantly identify
              points outside tolerance.
            </p>
          </div>

          <div className="inline-flex w-fit items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
            <ShieldCheck size={20} />
            Files stay inside your browser
          </div>
        </div>

        <section className="mt-10 grid gap-5 lg:grid-cols-2">
          <UploadCard
            title="1. Bottom layer survey"
            description="Subgrade, subbase, basecourse or lower pavement points."
            file={bottomFile}
            onChoose={() => bottomInputRef.current?.click()}
            onDrop={(event) => handleDrop(event, "bottom")}
          />
          <UploadCard
            title="2. Top layer survey"
            description="Upper pavement or finished surface points measured at matching locations."
            file={topFile}
            onChoose={() => topInputRef.current?.click()}
            onDrop={(event) => handleDrop(event, "top")}
          />
        </section>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={loadDemo}
            className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold transition hover:bg-white/10"
          >
            Load demo data
          </button>
          {(bottomFile || topFile) && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold transition hover:bg-white/10"
            >
              <RotateCcw size={16} />
              Start over
            </button>
          )}
        </div>

        <input
          ref={bottomInputRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          onChange={(event) =>
            handleFileChange(event, "bottom")
          }
          className="hidden"
        />
        <input
          ref={topInputRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          onChange={(event) => handleFileChange(event, "top")}
          className="hidden"
        />

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-rose-200"
          >
            <strong className="block">Could not read this file</strong>
            <span className="mt-1 block text-sm text-rose-200/80">
              {error}
            </span>
          </div>
        )}

        {(bottomFile?.warnings.length || topFile?.warnings.length) ? (
          <section className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-sm text-amber-200">
            <h2 className="font-semibold">File notes</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-200/80">
              {[
                ...(bottomFile?.warnings ?? []),
                ...(topFile?.warnings ?? []),
              ].map((warning, index) => (
                <li key={`${warning}-${index}`}>{warning}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {bottomFile && topFile && (
          <div className="mt-8 space-y-8">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
                    Conformance settings
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold">
                    Thickness and matching tolerances
                  </h2>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <NumberControl
                    label="Target thickness (mm)"
                    value={targetThicknessMm}
                    minimum={0}
                    step={1}
                    onChange={setTargetThicknessMm}
                  />
                  <NumberControl
                    label="Allowed ± (mm)"
                    value={toleranceMm}
                    minimum={0}
                    step={1}
                    onChange={setToleranceMm}
                  />
                  <NumberControl
                    label="XY tolerance (m)"
                    value={coordinateTolerance}
                    minimum={0.001}
                    step={0.01}
                    onChange={setCoordinateTolerance}
                  />
                  <label className="text-sm text-slate-300">
                    <span className="mb-2 block">Match points by</span>
                    <select
                      value={matchMode}
                      onChange={(event) =>
                        setMatchMode(event.target.value as MatchMode)
                      }
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-cyan-400"
                    >
                      <option value="auto">ID, then coordinates</option>
                      <option value="point-id">Point ID only</option>
                      <option value="coordinate">Coordinates only</option>
                    </select>
                  </label>
                </div>
              </div>
            </section>

            {comparison && statistics ? (
              <>
                <section>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h2 className="text-2xl font-semibold">
                        Conformance summary
                      </h2>
                      <p className="mt-2 text-sm text-slate-400">
                        Acceptable range {Math.max(0, targetThicknessMm - toleranceMm).toFixed(0)}–
                        {(targetThicknessMm + toleranceMm).toFixed(0)} mm
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={exportReport}
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                    >
                      <Download size={17} />
                      Download CSV report
                    </button>
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
                    <SummaryCard
                      label="Matched"
                      value={comparison.results.length.toLocaleString("en-NZ")}
                    />
                    <SummaryCard
                      label="Passed"
                      value={statistics.passed.toLocaleString("en-NZ")}
                      tone="pass"
                    />
                    <SummaryCard
                      label="Failed"
                      value={statistics.failed.toLocaleString("en-NZ")}
                      tone="fail"
                    />
                    <SummaryCard
                      label="Compliance"
                      value={`${statistics.compliance.toFixed(1)}%`}
                      tone={statistics.failed === 0 ? "pass" : "neutral"}
                    />
                    <SummaryCard
                      label="Average"
                      value={`${statistics.average.toFixed(0)} mm`}
                    />
                    <SummaryCard
                      label="Range"
                      value={`${statistics.minimum.toFixed(0)}–${statistics.maximum.toFixed(0)} mm`}
                    />
                  </div>

                  {(comparison.unmatchedBottom > 0 ||
                    comparison.unmatchedTop > 0) && (
                    <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-200">
                      <AlertTriangle size={19} className="mt-0.5 shrink-0" />
                      <span>
                        {comparison.unmatchedBottom.toLocaleString("en-NZ")} bottom and {" "}
                        {comparison.unmatchedTop.toLocaleString("en-NZ")} top point(s) were not matched. Adjust the matching method or XY tolerance if required.
                      </span>
                    </div>
                  )}
                </section>

                <ConformanceMap results={comparison.results} />
                <ResultsTable results={comparison.results} />
              </>
            ) : (
              <section className="rounded-3xl border border-amber-400/20 bg-amber-400/5 p-6 text-amber-200">
                <h2 className="font-semibold">No matched points</h2>
                <p className="mt-2 text-sm text-amber-200/80">
                  Increase the XY tolerance or switch the matching method. Point ID matching requires the same IDs in both files.
                </p>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

type UploadCardProps = {
  title: string
  description: string
  file: ParsedSurveyFile | null
  onChoose: () => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
}

function UploadCard({
  title,
  description,
  file,
  onChoose,
  onDrop,
}: UploadCardProps) {
  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className="rounded-3xl border border-dashed border-white/20 bg-white/5 p-7 transition hover:border-cyan-400/60"
    >
      <div className="flex items-start gap-4">
        <div className="rounded-2xl bg-cyan-400/10 p-3 text-cyan-300">
          {file ? <FileSpreadsheet size={27} /> : <Upload size={27} />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {description}
          </p>

          {file && (
            <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4">
              <p className="truncate font-semibold text-emerald-200">
                {file.name}
              </p>
              <p className="mt-1 text-sm text-emerald-200/70">
                {file.points.length.toLocaleString("en-NZ")} readable points
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={onChoose}
            className="mt-5 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
          >
            {file ? "Replace file" : "Choose CSV or TXT"}
          </button>
        </div>
      </div>
    </div>
  )
}

type NumberControlProps = {
  label: string
  value: number
  minimum: number
  step: number
  onChange: (value: number) => void
}

function NumberControl({
  label,
  value,
  minimum,
  step,
  onChange,
}: NumberControlProps) {
  return (
    <label className="text-sm text-slate-300">
      <span className="mb-2 block">{label}</span>
      <input
        type="number"
        value={value}
        min={minimum}
        step={step}
        onChange={(event) => {
          const nextValue = Number(event.target.value)
          if (Number.isFinite(nextValue)) {
            onChange(nextValue)
          }
        }}
        className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-cyan-400"
      />
    </label>
  )
}

function SummaryCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string
  value: string
  tone?: "neutral" | "pass" | "fail"
}) {
  const toneClasses = {
    neutral: "border-white/10 bg-white/5 text-white",
    pass: "border-emerald-400/20 bg-emerald-400/5 text-emerald-200",
    fail: "border-rose-400/20 bg-rose-400/5 text-rose-200",
  }

  return (
    <div className={`rounded-2xl border p-5 ${toneClasses[tone]}`}>
      <p className="text-xs uppercase tracking-[0.18em] opacity-60">
        {label}
      </p>
      <p className="mt-3 text-2xl font-bold">{value}</p>
    </div>
  )
}

function ConformanceMap({
  results,
}: {
  results: ConformanceResult[]
}) {
  const width = 1000
  const height = 520
  const padding = 35

  if (results.length === 0) {
    return null
  }

  const minEasting = Math.min(...results.map((result) => result.easting))
  const maxEasting = Math.max(...results.map((result) => result.easting))
  const minNorthing = Math.min(...results.map((result) => result.northing))
  const maxNorthing = Math.max(...results.map((result) => result.northing))
  const eastingRange = Math.max(maxEasting - minEasting, 1)
  const northingRange = Math.max(maxNorthing - minNorthing, 1)
  const scale = Math.min(
    (width - padding * 2) / eastingRange,
    (height - padding * 2) / northingRange,
  )
  const renderedWidth = eastingRange * scale
  const renderedHeight = northingRange * scale
  const offsetX = (width - renderedWidth) / 2
  const offsetY = (height - renderedHeight) / 2
  const pointStep = Math.max(1, Math.ceil(results.length / 12000))

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
            Spatial preview
          </p>
          <h2 className="mt-2 text-2xl font-semibold">
            Thickness pass / fail map
          </h2>
        </div>
        <div className="flex gap-4 text-sm text-slate-300">
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-emerald-400" />
            Pass
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-rose-400" />
            Fail
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-5 block aspect-[1000/520] w-full rounded-2xl border border-white/10 bg-slate-950"
        role="img"
        aria-label="Plan preview of pavement thickness conformance points"
      >
        {results
          .filter((_, index) => index % pointStep === 0)
          .map((result, index) => {
            const x =
              offsetX +
              (result.easting - minEasting) * scale
            const y =
              offsetY +
              (maxNorthing - result.northing) * scale

            return (
              <circle
                key={`${result.id}-${index}`}
                cx={x}
                cy={y}
                r={result.status === "pass" ? 5 : 6.5}
                fill={
                  result.status === "pass"
                    ? "#34d399"
                    : "#fb7185"
                }
                stroke="#f8fafc"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              >
                <title>
                  {`${result.id} · ${result.thicknessMm.toFixed(0)} mm · ${result.status.toUpperCase()}`}
                </title>
              </circle>
            )
          })}
      </svg>

      {pointStep > 1 && (
        <p className="mt-3 text-xs text-amber-300">
          Preview simplified to every {pointStep}th point. The report and statistics still use every matched point.
        </p>
      )}
    </section>
  )
}

function ResultsTable({
  results,
}: {
  results: ConformanceResult[]
}) {
  const displayedResults = results.slice(0, 500)

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
          Point results
        </p>
        <h2 className="mt-2 text-2xl font-semibold">
          Matched pavement points
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Showing {displayedResults.length.toLocaleString("en-NZ")} of {" "}
          {results.length.toLocaleString("en-NZ")} matched points. The CSV export includes all results.
        </p>
      </div>

      <div className="mt-5 overflow-x-auto rounded-2xl border border-white/10">
        <table className="min-w-full divide-y divide-white/10 text-left text-sm">
          <thead className="bg-slate-950/80 text-xs uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <TableHeader>Point</TableHeader>
              <TableHeader>Easting</TableHeader>
              <TableHeader>Northing</TableHeader>
              <TableHeader>Bottom RL</TableHeader>
              <TableHeader>Top RL</TableHeader>
              <TableHeader>Thickness</TableHeader>
              <TableHeader>Deviation</TableHeader>
              <TableHeader>Status</TableHeader>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {displayedResults.map((result, index) => (
              <tr
                key={`${result.id}-${index}`}
                className="bg-white/[0.02] text-slate-300"
              >
                <TableCell>
                  <div className="font-semibold text-white">
                    {result.id}
                  </div>
                  {result.code && (
                    <div className="mt-1 text-xs text-slate-500">
                      {result.code}
                    </div>
                  )}
                </TableCell>
                <TableCell>{result.easting.toFixed(3)}</TableCell>
                <TableCell>{result.northing.toFixed(3)}</TableCell>
                <TableCell>{formatLevel(result.bottomElevation)}</TableCell>
                <TableCell>{formatLevel(result.topElevation)}</TableCell>
                <TableCell>
                  {formatMillimetres(result.thicknessMm)} mm
                </TableCell>
                <TableCell>
                  {result.deviationMm >= 0 ? "+" : ""}
                  {formatMillimetres(result.deviationMm)} mm
                </TableCell>
                <TableCell>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      result.status === "pass"
                        ? "bg-emerald-400/10 text-emerald-200"
                        : "bg-rose-400/10 text-rose-200"
                    }`}
                  >
                    {result.status === "pass" ? (
                      <CheckCircle2 size={14} />
                    ) : (
                      <AlertTriangle size={14} />
                    )}
                    {result.status.toUpperCase()}
                  </span>
                </TableCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function TableHeader({ children }: { children: ReactNode }) {
  return <th className="px-4 py-3 font-semibold">{children}</th>
}

function TableCell({ children }: { children: ReactNode }) {
  return <td className="whitespace-nowrap px-4 py-3">{children}</td>
}
