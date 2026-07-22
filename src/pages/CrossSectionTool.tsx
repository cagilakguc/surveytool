import { useEffect, useRef, useState } from "react"
import type { ChangeEvent, DragEvent } from "react"
import {
  ArrowLeft,
  Eye,
  FilePlus2,
  FileSpreadsheet,
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
import { countLandXmlGeometry, parseLandXmlFile } from "../lib/landxmlAsync"
import { parseSurveyPointFile } from "../lib/surveyPoints"
import type { SurveyPointLayer } from "../lib/surveyPoints"

const maximumFileSize = 100 * 1024 * 1024
const automaticWorkspaceFaceLimit = 20_000
const maximumWorkspaceFaceLimit = 300_000
const supportedExtensions = ["xml", "landxml", "csv", "txt", "dxf"]

const demoLandXml = `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="2026-07-22">
  <Project name="SurveyTool Cross Section Demo" />
  <Units><Metric linearUnit="meter" /></Units>
  <Surfaces>
    <Surface name="Finished Surface"><Definition surfType="TIN"><Pnts>
      <P id="1">5923000 1755000 12.000</P><P id="2">5923000 1755100 12.300</P>
      <P id="3">5923100 1755100 13.100</P><P id="4">5923100 1755000 12.800</P>
      <P id="5">5923050 1755050 12.650</P>
    </Pnts><Faces><F>1 2 5</F><F>2 3 5</F><F>3 4 5</F><F>4 1 5</F></Faces></Definition></Surface>
    <Surface name="Pavement Bottom"><Definition surfType="TIN"><Pnts>
      <P id="1">5923000 1755000 11.750</P><P id="2">5923000 1755100 12.050</P>
      <P id="3">5923100 1755100 12.850</P><P id="4">5923100 1755000 12.550</P>
      <P id="5">5923050 1755050 12.400</P>
    </Pnts><Faces><F>1 2 5</F><F>2 3 5</F><F>3 4 5</F><F>4 1 5</F></Faces></Definition></Surface>
  </Surfaces>
  <Alignments><Alignment name="Road Centreline" length="113.137" staStart="1200.000">
    <CoordGeom><Line><Start>5923010 1755010</Start><End>5923090 1755090</End></Line></CoordGeom>
  </Alignment></Alignments>
</LandXML>`

const demoAsbuilt: SurveyPointLayer = {
  name: "demo-asbuilt.csv",
  format: "CSV",
  warnings: [],
  points: [
    { id: "AB01", easting: 1755020, northing: 5923080, elevation: 12.208, code: "AC20" },
    { id: "AB02", easting: 1755032, northing: 5923068, elevation: 12.321, code: "AC20" },
    { id: "AB03", easting: 1755044, northing: 5923056, elevation: 12.438, code: "AC20" },
    { id: "AB04", easting: 1755056, northing: 5923044, elevation: 12.557, code: "AC20" },
    { id: "AB05", easting: 1755068, northing: 5923032, elevation: 12.672, code: "AC20" },
    { id: "AB06", easting: 1755080, northing: 5923020, elevation: 12.791, code: "AC20" },
  ],
}

function extensionOf(fileName: string) {
  return fileName.toLowerCase().split(".").pop() ?? ""
}

function isLandXml(file: File) {
  return ["xml", "landxml"].includes(extensionOf(file.name))
}

function mergeNamedItems<T extends { name: string }>(existing: T[], incoming: T[]) {
  const merged = new Map(existing.map((item) => [item.name, item]))
  incoming.forEach((item) => merged.set(item.name, item))
  return Array.from(merged.values())
}

function mergeDocuments(current: LandXmlDocument | null, incoming: LandXmlDocument): LandXmlDocument {
  if (!current) return incoming

  const cogoPoints = new Map(
    current.cogoPoints.map((point) => [`${point.name}:${point.easting}:${point.northing}`, point]),
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
  const pointLayersRef = useRef<SurveyPointLayer[]>([])
  const [document, setDocument] = useState<LandXmlDocument | null>(null)
  const [pointLayers, setPointLayers] = useState<SurveyPointLayer[]>([])
  const [xmlFiles, setXmlFiles] = useState<string[]>([])
  const [pointFiles, setPointFiles] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isReading, setIsReading] = useState(false)
  const [progress, setProgress] = useState({ stage: "", percent: 0 })
  const [error, setError] = useState("")
  const [showWorkspace, setShowWorkspace] = useState(false)

  useEffect(() => () => abortRef.current?.abort(), [])

  async function loadFiles(files: File[]) {
    if (files.length === 0) return

    const unsupported = files.find((file) => !supportedExtensions.includes(extensionOf(file.name)))
    if (unsupported) {
      setError(`${unsupported.name} is not supported. Use LandXML/XML, CSV, TXT or ASCII DXF.`)
      return
    }

    const oversized = files.find((file) => file.size > maximumFileSize)
    if (oversized) {
      setError(`${oversized.name} is larger than the 100 MB browser limit.`)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsReading(true)
    setError("")
    setProgress({ stage: "Opening files", percent: 2 })

    const containsXml = files.some(isLandXml)
    if (containsXml) setShowWorkspace(false)

    try {
      let mergedDocument = documentRef.current
      let mergedPointLayers = [...pointLayersRef.current]
      const acceptedXml: string[] = []
      const acceptedPoints: string[] = []

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        const basePercent = (index / files.length) * 100
        const fileShare = 100 / files.length

        if (isLandXml(file)) {
          const parsed = await parseLandXmlFile(file, {
            signal: controller.signal,
            onProgress: (stage, percent) => {
              setProgress({
                stage: `${file.name}: ${stage}`,
                percent: Math.round(basePercent + (percent / 100) * fileShare),
              })
            },
          })
          if (controller.signal.aborted) return
          mergedDocument = mergeDocuments(mergedDocument, parsed)
          acceptedXml.push(file.name)
        } else {
          setProgress({ stage: `${file.name}: reading survey points`, percent: Math.round(basePercent + fileShare * 0.4) })
          const layer = await parseSurveyPointFile(file)
          const layersByName = new Map(mergedPointLayers.map((item) => [item.name, item]))
          layersByName.set(layer.name, layer)
          mergedPointLayers = Array.from(layersByName.values())
          acceptedPoints.push(file.name)
          setProgress({ stage: `${file.name}: ${layer.points.length.toLocaleString("en-NZ")} points`, percent: Math.round(basePercent + fileShare) })
        }
      }

      documentRef.current = mergedDocument
      pointLayersRef.current = mergedPointLayers
      setDocument(mergedDocument)
      setPointLayers(mergedPointLayers)
      setXmlFiles((current) => Array.from(new Set([...current, ...acceptedXml])))
      setPointFiles((current) => Array.from(new Set([...current, ...acceptedPoints])))

      if (containsXml && mergedDocument) {
        const geometry = countLandXmlGeometry(mergedDocument)
        setShowWorkspace(geometry.faces <= automaticWorkspaceFaceLimit)
      } else if (mergedDocument?.surfaces.length && mergedPointLayers.length > 0) {
        setShowWorkspace((current) => current || countLandXmlGeometry(mergedDocument).faces <= automaticWorkspaceFaceLimit)
      }
    } catch (caughtError) {
      if (caughtError instanceof DOMException && caughtError.name === "AbortError") return
      setError(caughtError instanceof Error ? caughtError.message : "The selected files could not be opened.")
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
    pointLayersRef.current = [demoAsbuilt]
    setDocument(parsed)
    setPointLayers([demoAsbuilt])
    setXmlFiles(["cross-section-demo.xml"])
    setPointFiles(["demo-asbuilt.csv"])
    setShowWorkspace(true)
    setIsReading(false)
    setError("")
  }

  function reset() {
    abortRef.current?.abort()
    documentRef.current = null
    pointLayersRef.current = []
    setDocument(null)
    setPointLayers([])
    setXmlFiles([])
    setPointFiles([])
    setShowWorkspace(false)
    setIsReading(false)
    setProgress({ stage: "", percent: 0 })
    setError("")
  }

  const hasFiles = Boolean(document) || pointLayers.length > 0
  const geometry = document ? countLandXmlGeometry(document) : { points: 0, faces: 0 }
  const asbuiltPointCount = pointLayers.reduce((sum, layer) => sum + layer.points.length, 0)
  const workspaceIsTooLarge = geometry.faces > maximumWorkspaceFaceLimit

  return (
    <div className="relative z-10 min-h-screen px-6 py-20 md:py-24">
      <PageSeo
        title="Cross Sections from LandXML, CSV, TXT and DXF | SurveyTool.io"
        description="Combine LandXML surfaces and alignments with CSV, TXT or DXF as-built survey points, then draw cross sections and compare measured levels against TIN surfaces."
        canonicalUrl="https://www.surveytool.io/tools/cross-section"
      />

      <div className="mx-auto max-w-7xl">
        <Link to="/" className="mb-10 inline-flex items-center gap-2 text-sm font-semibold text-slate-400 transition hover:text-cyan-300">
          <ArrowLeft size={18} /> Back to home
        </Link>

        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-300">SurveyTool</p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Mixed-format Cross Section</h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-400">
              Use LandXML for design surfaces and alignments, then add one or more CSV, TXT or DXF as-built files to plot measured points and level differences in the same section.
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
            <ShieldCheck size={20} /> Processed privately in your browser
          </div>
        </div>

        {!hasFiles ? (
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
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-5">
                  <FileList label="LandXML surfaces and alignments" files={xmlFiles} empty="No LandXML loaded" tone="cyan" />
                  <FileList label="As-built point files" files={pointFiles} empty="No CSV, TXT or DXF loaded" tone="violet" />
                  {isReading && (
                    <div className="max-w-xl">
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full bg-cyan-400 transition-[width]" style={{ width: `${Math.max(3, progress.percent)}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-slate-500">{progress.stage}</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">
                    <FilePlus2 size={17} /> {isReading ? "Choose more files" : "Add source files"}
                  </button>
                  <button type="button" onClick={reset} className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold transition hover:bg-white/10">
                    <RotateCcw size={17} /> Start over
                  </button>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Metric icon={Layers3} value={document?.surfaces.length ?? 0} label="TIN surfaces" />
                <Metric icon={Route} value={document?.alignments.length ?? 0} label="Alignments" />
                <Metric icon={Layers3} value={geometry.faces} label="TIN faces" />
                <Metric icon={FileSpreadsheet} value={pointLayers.length} label="As-built layers" />
                <Metric icon={FileSpreadsheet} value={asbuiltPointCount} label="As-built points" />
              </div>
            </section>

            {!document?.surfaces.length ? (
              <section className="rounded-3xl border border-amber-400/20 bg-amber-400/5 p-6 text-amber-200">
                <h2 className="font-semibold">Add a LandXML TIN surface</h2>
                <p className="mt-2 text-sm text-amber-200/80">Your as-built points have been kept. Add the XML containing the design or pavement surface; an alignment XML is optional but required for chainage.</p>
              </section>
            ) : showWorkspace ? (
              <LandXmlCrossSection document={document} pointLayers={pointLayers} />
            ) : (
              <section className="rounded-3xl border border-white/10 bg-white/5 p-7 text-center">
                <Eye size={34} className="mx-auto text-cyan-300" />
                <h2 className="mt-4 text-xl font-semibold">{workspaceIsTooLarge ? "Cross-section workspace safely paused" : "Geometry loaded successfully"}</h2>
                <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                  {workspaceIsTooLarge
                    ? `The combined TIN contains ${geometry.faces.toLocaleString("en-NZ")} faces. Building the complete section index could exceed browser memory.`
                    : `The TIN contains ${geometry.faces.toLocaleString("en-NZ")} faces and ${asbuiltPointCount.toLocaleString("en-NZ")} measured points. Start the workspace when ready.`}
                </p>
                {!workspaceIsTooLarge && (
                  <button type="button" onClick={() => setShowWorkspace(true)} className="mt-5 rounded-full bg-cyan-400 px-6 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300">Build cross-section workspace</button>
                )}
              </section>
            )}
          </div>
        )}

        {error && (
          <div role="alert" className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-rose-200">
            <strong className="block">Could not add this file</strong>
            <span className="mt-1 block text-sm text-rose-200/80">{error}</span>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".xml,.landxml,.csv,.txt,.dxf,text/xml,application/xml,text/csv,text/plain,application/dxf"
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

function UploadPanel({ isDragging, isReading, progress, setIsDragging, onDrop, onChoose, onDemo }: UploadPanelProps) {
  return (
    <div
      onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }}
      onDragOver={(event) => { event.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      className={`mt-10 rounded-3xl border border-dashed px-8 py-16 text-center transition md:py-20 ${isDragging ? "border-cyan-300 bg-cyan-400/10" : "border-white/20 bg-white/5 hover:border-cyan-400/70"}`}
    >
      <Upload size={42} className="mx-auto text-cyan-300" />
      <h2 className="mt-5 text-2xl font-semibold">{isReading ? progress.stage || "Reading files…" : "Drop XML, CSV, TXT and DXF files here"}</h2>
      <p className="mx-auto mt-3 max-w-2xl text-slate-400">Select multiple files together or add them later. LandXML supplies surfaces and alignments; CSV, TXT and ASCII DXF supply measured as-built points.</p>
      {isReading && (
        <div className="mx-auto mt-6 max-w-xl">
          <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-cyan-400 transition-[width]" style={{ width: `${Math.max(3, progress.percent)}%` }} /></div>
          <p className="mt-2 text-xs text-slate-500">{progress.percent}%</p>
        </div>
      )}
      <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button type="button" onClick={onChoose} className="rounded-full bg-cyan-400 px-7 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300">{isReading ? "Choose more files" : "Choose source files"}</button>
        <button type="button" disabled={isReading} onClick={onDemo} className="rounded-full border border-white/15 px-7 py-3 font-semibold text-white transition hover:bg-white/10 disabled:opacity-50">Load mixed-format demo</button>
      </div>
    </div>
  )
}

function FileList({ label, files, empty, tone }: { label: string; files: string[]; empty: string; tone: "cyan" | "violet" }) {
  const classes = tone === "cyan" ? "border-cyan-400/20 bg-cyan-400/5 text-cyan-200" : "border-violet-400/20 bg-violet-400/5 text-violet-200"
  return (
    <div>
      <p className="text-sm text-slate-400">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {files.length ? files.map((file) => <span key={file} className={`rounded-full border px-3 py-1.5 text-sm ${classes}`}>{file}</span>) : <span className="text-sm text-slate-600">{empty}</span>}
      </div>
    </div>
  )
}

type MetricProps = { icon: typeof Layers3; value: number; label: string }

function Metric({ icon: Icon, value, label }: MetricProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
      <Icon size={20} className="text-cyan-300" />
      <p className="mt-3 text-2xl font-bold">{value.toLocaleString("en-NZ")}</p>
      <p className="text-sm text-slate-400">{label}</p>
    </div>
  )
}
