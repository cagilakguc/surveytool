import {
  useEffect,
  useRef,
  useState,
} from "react"
import type {
  ChangeEvent,
  DragEvent,
} from "react"
import {
  ArrowLeft,
  Eye,
  FilePlus2,
  Layers3,
  Route,
  RotateCcw,
  ShieldCheck,
  Upload,
} from "lucide-react"
import { Link } from "react-router-dom"

import LandXmlCrossSection from "../components/LandXmlCrossSection"
import PageSeo from "../components/PageSeo"
import { parseLandXml } from "../lib/landxml"
import type { LandXmlDocument } from "../lib/landxml"
import {
  countLandXmlGeometry,
  parseLandXmlFile,
} from "../lib/landxmlAsync"

const maximumFileSize = 100 * 1024 * 1024
const automaticWorkspaceFaceLimit = 20_000
const maximumWorkspaceFaceLimit = 300_000

const demoLandXml = `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="2026-07-22">
  <Project name="SurveyTool Cross Section Demo" />
  <Units><Metric linearUnit="meter" /></Units>
  <Surfaces>
    <Surface name="Finished Surface">
      <Definition surfType="TIN"><Pnts>
        <P id="1">5923000 1755000 12.000</P><P id="2">5923000 1755100 12.300</P>
        <P id="3">5923100 1755100 13.100</P><P id="4">5923100 1755000 12.800</P>
        <P id="5">5923050 1755050 12.650</P>
      </Pnts><Faces><F>1 2 5</F><F>2 3 5</F><F>3 4 5</F><F>4 1 5</F></Faces></Definition>
    </Surface>
    <Surface name="Pavement Bottom">
      <Definition surfType="TIN"><Pnts>
        <P id="1">5923000 1755000 11.750</P><P id="2">5923000 1755100 12.050</P>
        <P id="3">5923100 1755100 12.850</P><P id="4">5923100 1755000 12.550</P>
        <P id="5">5923050 1755050 12.400</P>
      </Pnts><Faces><F>1 2 5</F><F>2 3 5</F><F>3 4 5</F><F>4 1 5</F></Faces></Definition>
    </Surface>
  </Surfaces>
  <Alignments>
    <Alignment name="Road Centreline" length="113.137" staStart="1200.000">
      <CoordGeom><Line><Start>5923010 1755010</Start><End>5923090 1755090</End></Line></CoordGeom>
    </Alignment>
  </Alignments>
</LandXML>`

function mergeNamedItems<T extends { name: string }>(existing: T[], incoming: T[]) {
  const merged = new Map(existing.map((item) => [item.name, item]))
  incoming.forEach((item) => merged.set(item.name, item))
  return Array.from(merged.values())
}

function mergeDocuments(
  current: LandXmlDocument | null,
  incoming: LandXmlDocument,
): LandXmlDocument {
  if (!current) return incoming

  const cogoPoints = new Map(
    current.cogoPoints.map((point) => [
      `${point.name}:${point.easting}:${point.northing}`,
      point,
    ]),
  )
  incoming.cogoPoints.forEach((point) => {
    cogoPoints.set(`${point.name}:${point.easting}:${point.northing}`, point)
  })

  return {
    ...current,
    fileName: `${current.fileName} + ${incoming.fileName}`,
    surfaces: mergeNamedItems(current.surfaces, incoming.surfaces),
    alignments: mergeNamedItems(current.alignments, incoming.alignments),
    cogoPoints: Array.from(cogoPoints.values()),
    warnings: Array.from(new Set([...current.warnings, ...incoming.warnings])),
  }
}

export default function CrossSectionTool() {
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const documentRef = useRef<LandXmlDocument | null>(null)
  const [document, setDocument] = useState<LandXmlDocument | null>(null)
  const [loadedFiles, setLoadedFiles] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isReading, setIsReading] = useState(false)
  const [progress, setProgress] = useState({ stage: "", percent: 0 })
  const [error, setError] = useState("")
  const [showWorkspace, setShowWorkspace] = useState(false)

  useEffect(
    () => () => abortRef.current?.abort(),
    [],
  )

  function applyDocument(nextDocument: LandXmlDocument, fileNames: string[]) {
    documentRef.current = nextDocument
    setDocument(nextDocument)
    setLoadedFiles((current) => Array.from(new Set([...current, ...fileNames])))
    const geometry = countLandXmlGeometry(nextDocument)
    setShowWorkspace(geometry.faces <= automaticWorkspaceFaceLimit)
  }

  async function loadFiles(files: File[]) {
    if (files.length === 0) return

    const oversized = files.find((file) => file.size > maximumFileSize)
    if (oversized) {
      setError(`${oversized.name} is larger than the 100 MB browser limit.`)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsReading(true)
    setShowWorkspace(false)
    setError("")
    setProgress({ stage: "Opening files", percent: 2 })

    try {
      let mergedDocument = documentRef.current
      const acceptedNames: string[] = []

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        const parsed = await parseLandXmlFile(file, {
          signal: controller.signal,
          onProgress: (stage, percent) => {
            const overall = Math.round(
              ((index + percent / 100) / files.length) * 100,
            )
            setProgress({
              stage: `${file.name}: ${stage}`,
              percent: overall,
            })
          },
        })
        if (controller.signal.aborted) return
        mergedDocument = mergeDocuments(mergedDocument, parsed)
        acceptedNames.push(file.name)
      }

      if (mergedDocument) applyDocument(mergedDocument, acceptedNames)
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
          : "The selected LandXML files could not be opened.",
      )
    } finally {
      if (!controller.signal.aborted) {
        setIsReading(false)
        setProgress({ stage: "", percent: 0 })
      }
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    void loadFiles(Array.from(event.target.files ?? []))
    event.target.value = ""
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    void loadFiles(Array.from(event.dataTransfer.files ?? []))
  }

  function loadDemo() {
    abortRef.current?.abort()
    const parsed = parseLandXml(demoLandXml, "cross-section-demo.xml")
    documentRef.current = parsed
    setDocument(parsed)
    setLoadedFiles(["cross-section-demo.xml"])
    setShowWorkspace(true)
    setIsReading(false)
    setError("")
  }

  function reset() {
    abortRef.current?.abort()
    documentRef.current = null
    setDocument(null)
    setLoadedFiles([])
    setShowWorkspace(false)
    setIsReading(false)
    setProgress({ stage: "", percent: 0 })
    setError("")
  }

  const geometry = document
    ? countLandXmlGeometry(document)
    : { points: 0, faces: 0 }
  const workspaceIsTooLarge = geometry.faces > maximumWorkspaceFaceLimit

  return (
    <div className="relative z-10 min-h-screen px-6 py-20 md:py-24">
      <PageSeo
        title="LandXML Cross Section and Chainage Tool | SurveyTool.io"
        description="Draw cross sections through LandXML TIN surfaces, choose an alignment and calculate chainage, offset and surface RL profiles in your browser."
        canonicalUrl="https://www.surveytool.io/tools/cross-section"
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
              LandXML Cross Section
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-400">
              Add surface and alignment LandXML files without locking the page,
              then build the cross-section workspace only when the geometry is ready.
            </p>
          </div>

          <div className="inline-flex w-fit items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
            <ShieldCheck size={20} />
            Processed privately in your browser
          </div>
        </div>

        {!document ? (
          <UploadPanel
            isDragging={isDragging}
            isReading={isReading}
            progress={progress}
            setIsDragging={setIsDragging}
            onDrop={handleDrop}
            onChoose={() => inputRef.current?.click()}
            onDemo={loadDemo}
          />
        ) : (
          <div className="mt-10 space-y-8">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm text-slate-400">Loaded LandXML files</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {loadedFiles.map((fileName) => (
                      <span
                        key={fileName}
                        className="rounded-full border border-cyan-400/20 bg-cyan-400/5 px-3 py-1.5 text-sm text-cyan-200"
                      >
                        {fileName}
                      </span>
                    ))}
                  </div>
                  {isReading && (
                    <div className="mt-4 max-w-xl">
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full bg-cyan-400 transition-[width]"
                          style={{ width: `${Math.max(3, progress.percent)}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-slate-500">{progress.stage}</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                  >
                    <FilePlus2 size={17} />
                    {isReading ? "Choose another file" : "Add companion LandXML"}
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold transition hover:bg-white/10"
                  >
                    <RotateCcw size={17} />
                    Start over
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric icon={Layers3} value={document.surfaces.length} label="TIN surfaces" />
                <Metric icon={Route} value={document.alignments.length} label="Alignments" />
                <Metric icon={Layers3} value={geometry.points} label="TIN points" />
                <Metric icon={Layers3} value={geometry.faces} label="TIN faces" />
              </div>
            </section>

            {document.surfaces.length === 0 ? (
              <section className="rounded-3xl border border-amber-400/20 bg-amber-400/5 p-6 text-amber-200">
                <h2 className="font-semibold">No TIN surface loaded yet</h2>
                <p className="mt-2 text-sm text-amber-200/80">
                  The alignment has been kept. Add the LandXML containing the finished surface or pavement TIN.
                </p>
              </section>
            ) : showWorkspace ? (
              <LandXmlCrossSection document={document} />
            ) : (
              <section className="rounded-3xl border border-white/10 bg-white/5 p-7 text-center">
                <Eye size={34} className="mx-auto text-cyan-300" />
                <h2 className="mt-4 text-xl font-semibold">
                  {workspaceIsTooLarge ? "Cross-section workspace safely paused" : "Geometry loaded successfully"}
                </h2>
                <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                  {workspaceIsTooLarge
                    ? `The combined TIN contains ${geometry.faces.toLocaleString("en-NZ")} faces. Building the complete section index could exceed browser memory, so it has not been started.`
                    : `The combined TIN contains ${geometry.faces.toLocaleString("en-NZ")} faces. Start the workspace when you are ready to draw a section.`}
                </p>
                {!workspaceIsTooLarge && (
                  <button
                    type="button"
                    onClick={() => setShowWorkspace(true)}
                    className="mt-5 rounded-full bg-cyan-400 px-6 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
                  >
                    Build cross-section workspace
                  </button>
                )}
              </section>
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-rose-200"
          >
            <strong className="block">Could not add this file</strong>
            <span className="mt-1 block text-sm text-rose-200/80">{error}</span>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".xml,.landxml,text/xml,application/xml"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </div>
  )
}

type UploadPanelProps = {
  isDragging: boolean
  isReading: boolean
  progress: { stage: string; percent: number }
  setIsDragging: (value: boolean) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  onChoose: () => void
  onDemo: () => void
}

function UploadPanel({
  isDragging,
  isReading,
  progress,
  setIsDragging,
  onDrop,
  onChoose,
  onDemo,
}: UploadPanelProps) {
  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      className={`mt-10 rounded-3xl border border-dashed px-8 py-16 text-center transition md:py-20 ${
        isDragging
          ? "border-cyan-300 bg-cyan-400/10"
          : "border-white/20 bg-white/5 hover:border-cyan-400/70"
      }`}
    >
      <Upload size={42} className="mx-auto text-cyan-300" />
      <h2 className="mt-5 text-2xl font-semibold">
        {isReading ? progress.stage || "Reading LandXML…" : "Drop surface and alignment XML files here"}
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-slate-400">
        Select multiple files together, or add the surface and alignment separately. Parsing runs in the background.
      </p>
      {isReading && (
        <div className="mx-auto mt-6 max-w-xl">
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-cyan-400 transition-[width]"
              style={{ width: `${Math.max(3, progress.percent)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">{progress.percent}%</p>
        </div>
      )}
      <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onChoose}
          className="rounded-full bg-cyan-400 px-7 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300"
        >
          {isReading ? "Choose another file" : "Choose LandXML files"}
        </button>
        <button
          type="button"
          disabled={isReading}
          onClick={onDemo}
          className="rounded-full border border-white/15 px-7 py-3 font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
        >
          Load demo
        </button>
      </div>
    </div>
  )
}

type MetricProps = {
  icon: typeof Layers3
  value: number
  label: string
}

function Metric({ icon: Icon, value, label }: MetricProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
      <Icon size={20} className="text-cyan-300" />
      <p className="mt-3 text-2xl font-bold">{value.toLocaleString("en-NZ")}</p>
      <p className="text-sm text-slate-400">{label}</p>
    </div>
  )
}
