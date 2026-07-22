import {
  useMemo,
  useRef,
  useState,
} from "react"
import type { ChangeEvent } from "react"
import { Link } from "react-router-dom"
import {
  ArrowLeft,
  FileUp,
  Layers3,
  Play,
  Scale,
  ShieldCheck,
} from "lucide-react"

import PageSeo from "../components/PageSeo"
import { parseLandXml } from "../lib/landxml"
import type { LandXmlDocument } from "../lib/landxml"
import { parseLandXmlFile } from "../lib/landxmlAsync"
import { compareSurfaces } from "../lib/surfaceCompare"
import type { SurfaceComparison } from "../lib/surfaceCompare"

const maximumFileSize = 100 * 1024 * 1024

function demoXml(name: string, offset: number) {
  return `<?xml version="1.0"?><LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2"><Project name="Surface Compare Demo"/><Units><Metric linearUnit="meter"/></Units><Surfaces><Surface name="${name}"><Definition surfType="TIN"><Pnts><P id="1">5923000 1755000 ${12.1 + offset}</P><P id="2">5923000 1755100 ${12.8 + offset * 0.4}</P><P id="3">5923100 1755100 ${13.6 + offset}</P><P id="4">5923100 1755000 ${12.9 - offset * 0.3}</P><P id="5">5923050 1755050 ${13.15 + offset * 0.7}</P></Pnts><Faces><F>1 2 5</F><F>2 3 5</F><F>3 4 5</F><F>4 1 5</F></Faces></Definition></Surface></Surfaces></LandXML>`
}

function format(value: number, digits = 2) {
  return new Intl.NumberFormat("en-NZ", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
}

type FilePanelProps = {
  label: string
  document: LandXmlDocument | null
  isLoading: boolean
  progress: { stage: string; percent: number }
  onFile: (file: File) => void
}

function FilePanel({
  label,
  document,
  isLoading,
  progress,
  onFile,
}: FilePanelProps) {
  const input = useRef<HTMLInputElement>(null)

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">
        {label}
      </p>
      <div className="mt-5 flex items-center gap-4">
        <div className="rounded-2xl bg-cyan-400/10 p-3 text-cyan-300">
          <FileUp size={25} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {isLoading
              ? progress.stage || "Reading LandXML…"
              : document?.fileName ?? "Choose a LandXML file"}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {document
              ? `${document.surfaces.length} surface${document.surfaces.length === 1 ? "" : "s"}`
              : "XML or LandXML · up to 100 MB"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/10"
        >
          {isLoading ? "Replace" : "Browse"}
        </button>
      </div>

      {isLoading && (
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-cyan-400 transition-[width]"
              style={{ width: `${Math.max(3, progress.percent)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">{progress.percent}%</p>
        </div>
      )}

      <input
        ref={input}
        className="hidden"
        type="file"
        accept=".xml,.landxml,text/xml,application/xml"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0]
          if (file) onFile(file)
          event.target.value = ""
        }}
      />
    </section>
  )
}

type SurfaceSelectProps = {
  label: string
  document: LandXmlDocument
  value: number
  onChange: (value: number) => void
}

function SurfaceSelect({
  label,
  document,
  value,
  onChange,
}: SurfaceSelectProps) {
  return (
    <label className="block text-sm font-medium text-slate-300">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white"
      >
        {document.surfaces.map((surface, index) => (
          <option key={`${surface.name}-${index}`} value={index}>
            {surface.name} · {surface.faces.length.toLocaleString("en-NZ")} faces
          </option>
        ))}
      </select>
    </label>
  )
}

function DifferenceMap({ comparison }: { comparison: SurfaceComparison }) {
  const width = 900
  const height = 520
  const spanE = Math.max(comparison.bounds.maxE - comparison.bounds.minE, 0.001)
  const spanN = Math.max(comparison.bounds.maxN - comparison.bounds.minN, 0.001)
  const maximum = Math.max(
    Math.abs(comparison.minDifference),
    Math.abs(comparison.maxDifference),
    0.001,
  )
  const cellWidth = (comparison.cellSize / spanE) * width + 0.6
  const cellHeight = (comparison.cellSize / spanN) * height + 0.6

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950 p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Cut and fill difference map"
      >
        <rect width={width} height={height} fill="#07111f" />
        {comparison.cells.map((cell, index) => {
          const intensity = Math.min(1, Math.abs(cell.difference) / maximum)
          const fill = cell.difference < 0
            ? `rgba(251,113,133,${0.2 + intensity * 0.8})`
            : `rgba(34,211,238,${0.2 + intensity * 0.8})`
          const x = ((cell.easting - comparison.bounds.minE) / spanE) * width
          const y = height - ((cell.northing - comparison.bounds.minN) / spanN) * height

          return (
            <rect
              key={index}
              x={x - cellWidth / 2}
              y={y - cellHeight / 2}
              width={cellWidth}
              height={cellHeight}
              fill={fill}
            >
              <title>
                {`E ${cell.easting.toFixed(3)} · N ${cell.northing.toFixed(3)} · Δ ${cell.difference.toFixed(3)}`}
              </title>
            </rect>
          )
        })}
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-3 text-xs text-slate-400">
        <span>Rose: cut / design lower</span>
        <span>Hover cells for thickness</span>
        <span>Cyan: fill / design higher</span>
      </div>
    </div>
  )
}

export default function SurfaceCompare() {
  const abortRef = useRef<AbortController | null>(null)
  const [existing, setExisting] = useState<LandXmlDocument | null>(null)
  const [design, setDesign] = useState<LandXmlDocument | null>(null)
  const [existingIndex, setExistingIndex] = useState(0)
  const [designIndex, setDesignIndex] = useState(0)
  const [resolution, setResolution] = useState(90)
  const [analysisVersion, setAnalysisVersion] = useState(0)
  const [loadingTarget, setLoadingTarget] = useState<"existing" | "design" | null>(null)
  const [progress, setProgress] = useState({ stage: "", percent: 0 })
  const [error, setError] = useState("")

  async function load(file: File, target: "existing" | "design") {
    if (file.size > maximumFileSize) {
      setError("Please choose a LandXML file smaller than 100 MB.")
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoadingTarget(target)
    setProgress({ stage: "Opening file", percent: 2 })
    setAnalysisVersion(0)
    setError("")

    try {
      const parsed = await parseLandXmlFile(file, {
        signal: controller.signal,
        onProgress: (stage, percent) => setProgress({ stage, percent }),
      })
      if (!parsed.surfaces.length) {
        throw new Error("No surfaces were found in this file.")
      }
      if (target === "existing") {
        setExisting(parsed)
        setExistingIndex(0)
      } else {
        setDesign(parsed)
        setDesignIndex(0)
      }
    } catch (caughtError) {
      if (
        caughtError instanceof DOMException &&
        caughtError.name === "AbortError"
      ) {
        return
      }
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The LandXML file could not be read.",
      )
    } finally {
      if (!controller.signal.aborted) {
        setLoadingTarget(null)
        setProgress({ stage: "", percent: 0 })
      }
    }
  }

  const comparisonResult = useMemo(() => {
    if (!existing || !design || analysisVersion === 0) {
      return { comparison: null, message: "" }
    }

    try {
      return {
        comparison: compareSurfaces(
          existing.surfaces[existingIndex],
          design.surfaces[designIndex],
          resolution,
        ),
        message: "",
      }
    } catch (caughtError) {
      return {
        comparison: null,
        message:
          caughtError instanceof Error
            ? caughtError.message
            : "The surfaces could not be compared.",
      }
    }
  }, [analysisVersion, design, designIndex, existing, existingIndex, resolution])

  const comparison = comparisonResult.comparison
  const visibleError = error || comparisonResult.message

  function loadDemo() {
    abortRef.current?.abort()
    setExisting(parseLandXml(demoXml("Existing Ground", 0), "demo-existing.xml"))
    setDesign(parseLandXml(demoXml("Design Surface", 0.65), "demo-design.xml"))
    setExistingIndex(0)
    setDesignIndex(0)
    setAnalysisVersion(1)
    setLoadingTarget(null)
    setError("")
  }

  return (
    <div className="relative z-10 min-h-screen px-6 py-20 md:py-24">
      <PageSeo
        title="LandXML Surface Compare & Cut Fill Calculator | SurveyTool.io"
        description="Compare two LandXML TIN surfaces online. Calculate cut and fill volumes, net volume, thickness statistics and inspect a visual difference map."
        canonicalUrl="https://www.surveytool.io/tools/surface-compare"
      />
      <div className="mx-auto max-w-7xl">
        <Link
          to="/"
          className="mb-10 inline-flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-cyan-300"
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
              LandXML Surface Compare
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-400">
              Load both TINs in the background, choose the surfaces and start the comparison when ready.
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
            <ShieldCheck size={20} />
            Processed privately in your browser
          </div>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <FilePanel
            label="1 · Existing surface file"
            document={existing}
            isLoading={loadingTarget === "existing"}
            progress={progress}
            onFile={(file) => void load(file, "existing")}
          />
          <FilePanel
            label="2 · Design surface file"
            document={design}
            isLoading={loadingTarget === "design"}
            progress={progress}
            onFile={(file) => void load(file, "design")}
          />
        </div>

        <div className="mt-5 flex justify-center">
          <button
            type="button"
            disabled={loadingTarget !== null}
            onClick={loadDemo}
            className="rounded-full border border-white/15 px-6 py-2.5 text-sm font-semibold hover:bg-white/10 disabled:opacity-50"
          >
            Load comparison demo
          </button>
        </div>

        {visibleError && (
          <div
            role="alert"
            className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-rose-200"
          >
            {visibleError}
          </div>
        )}

        {existing && design && (
          <div className="mt-8 space-y-8">
            <section className="grid gap-5 rounded-3xl border border-white/10 bg-white/5 p-6 lg:grid-cols-[1fr_1fr_260px]">
              <SurfaceSelect
                label="Existing TIN"
                document={existing}
                value={existingIndex}
                onChange={(value) => {
                  setExistingIndex(value)
                  setAnalysisVersion(0)
                }}
              />
              <SurfaceSelect
                label="Design TIN"
                document={design}
                value={designIndex}
                onChange={(value) => {
                  setDesignIndex(value)
                  setAnalysisVersion(0)
                }}
              />
              <label className="block text-sm font-medium text-slate-300">
                Analysis resolution
                <input
                  type="range"
                  min="30"
                  max="160"
                  step="10"
                  value={resolution}
                  onChange={(event) => {
                    setResolution(Number(event.target.value))
                    setAnalysisVersion(0)
                  }}
                  className="mt-4 w-full accent-cyan-400"
                />
                <span className="mt-2 block text-xs text-slate-400">
                  {resolution} cells across longest side
                </span>
              </label>
            </section>

            {analysisVersion === 0 && (
              <section className="rounded-3xl border border-cyan-400/20 bg-cyan-400/5 p-7 text-center">
                <Play size={34} className="mx-auto text-cyan-300" />
                <h2 className="mt-4 text-xl font-semibold">Surfaces are ready</h2>
                <p className="mt-2 text-sm text-slate-400">
                  The analysis starts only when you press the button, preventing the second upload from locking the page.
                </p>
                <button
                  type="button"
                  onClick={() => setAnalysisVersion((value) => value + 1)}
                  className="mt-5 rounded-full bg-cyan-400 px-7 py-3 font-semibold text-slate-950 hover:bg-cyan-300"
                >
                  Run surface comparison
                </button>
              </section>
            )}

            {comparison && (
              <>
                <section>
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
                        Results
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold">Cut, fill and thickness</h2>
                    </div>
                    <span className="hidden items-center gap-2 text-sm text-slate-400 sm:flex">
                      <Scale size={18} />
                      {format(comparison.comparedArea)} m² compared
                    </span>
                  </div>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <ResultCard label="Cut volume" value={`${format(comparison.cutVolume)} m³`} tone="rose" />
                    <ResultCard label="Fill volume" value={`${format(comparison.fillVolume)} m³`} tone="cyan" />
                    <ResultCard label="Net volume" value={`${comparison.netVolume >= 0 ? "+" : ""}${format(comparison.netVolume)} m³`} tone="white" />
                    <ResultCard label="Average thickness" value={`${comparison.averageDifference >= 0 ? "+" : ""}${format(comparison.averageDifference, 3)} m`} tone="white" />
                  </div>
                </section>

                <section className="grid gap-6 xl:grid-cols-[1fr_310px]">
                  <DifferenceMap comparison={comparison} />
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                    <Layers3 className="text-cyan-300" />
                    <h3 className="mt-4 text-lg font-semibold">Thickness check</h3>
                    <dl className="mt-5 space-y-3 text-sm">
                      <Stat label="Minimum" value={`${format(comparison.minDifference, 3)} m`} />
                      <Stat label="Maximum" value={`${format(comparison.maxDifference, 3)} m`} />
                      <Stat label="Grid size" value={`${format(comparison.cellSize, 2)} m`} />
                      <Stat label="Valid samples" value={comparison.sampleCount.toLocaleString("en-NZ")} />
                    </dl>
                    <button
                      type="button"
                      onClick={() => setAnalysisVersion(0)}
                      className="mt-6 w-full rounded-full border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/10"
                    >
                      Change settings
                    </button>
                  </div>
                </section>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ResultCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "rose" | "cyan" | "white"
}) {
  const colour = tone === "rose"
    ? "text-rose-300"
    : tone === "cyan"
      ? "text-cyan-300"
      : "text-white"

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${colour}`}>{value}</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-semibold text-white">{value}</dd>
    </div>
  )
}
