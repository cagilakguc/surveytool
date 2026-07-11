import {
  useRef,
  useState,
} from "react"
import type {
  ChangeEvent,
  DragEvent,
} from "react"
import { Link } from "react-router-dom"
import {
  ArrowLeft,
  FileCode2,
  Layers3,
  MapPin,
  Mountain,
  Route,
  ShieldCheck,
  Upload,
} from "lucide-react"

import LandXmlPreview from "../components/LandXmlPreview"
import PageSeo from "../components/PageSeo"
import {
  parseLandXml,
} from "../lib/landxml"
import type {
  LandXmlDocument,
} from "../lib/landxml"

const maximumFileSize = 100 * 1024 * 1024

const demoLandXml = `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="2026-07-10">
  <Project name="SurveyTool Demo Project" />
  <Application name="SurveyTool.io" manufacturer="SurveyTool" />
  <Units>
    <Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter" />
  </Units>
  <CgPoints>
    <CgPoint name="BM01">5923006 1755006 12.450</CgPoint>
    <CgPoint name="BM02">5923088 1755092 13.180</CgPoint>
  </CgPoints>
  <Surfaces>
    <Surface name="Demo Existing Surface">
      <Definition surfType="TIN">
        <Pnts>
          <P id="1">5923000 1755000 12.100</P>
          <P id="2">5923000 1755100 12.800</P>
          <P id="3">5923100 1755100 13.600</P>
          <P id="4">5923100 1755000 12.900</P>
          <P id="5">5923050 1755050 13.150</P>
        </Pnts>
        <Faces>
          <F>1 2 5</F>
          <F>2 3 5</F>
          <F>3 4 5</F>
          <F>4 1 5</F>
        </Faces>
      </Definition>
    </Surface>
  </Surfaces>
  <Alignments>
    <Alignment name="Demo Centreline" length="141.421" staStart="0.000">
      <CoordGeom>
        <Line>
          <Start>5923010 1755010</Start>
          <End>5923050 1755050</End>
        </Line>
        <Line>
          <Start>5923050 1755050</Start>
          <End>5923090 1755090</End>
        </Line>
      </CoordGeom>
    </Alignment>
  </Alignments>
</LandXML>`

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-NZ").format(value)
}

function formatLevel(value: number | null) {
  return value === null ? "—" : value.toFixed(3)
}

export default function LandXmlViewer() {
  const inputRef = useRef<HTMLInputElement>(null)
  const loadIdRef = useRef(0)
  const [document, setDocument] =
    useState<LandXmlDocument | null>(null)
  const [error, setError] = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const [isReading, setIsReading] = useState(false)

  function readXml(xmlText: string, fileName: string) {
    try {
      const parsedDocument = parseLandXml(xmlText, fileName)
      setDocument(parsedDocument)
      setError("")
    } catch (caughtError) {
      setDocument(null)
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The LandXML file could not be read.",
      )
    }
  }

  async function loadFile(file: File) {
    const loadId = ++loadIdRef.current

    if (file.size > maximumFileSize) {
      setDocument(null)
      setError("Please choose a LandXML file smaller than 100 MB.")
      return
    }

    setIsReading(true)
    setError("")
    // Unmount the previous SVG/TIN index before reading another large file.
    // Without this yield, React keeps the old geometry in memory while the
    // synchronous XML parser builds the new document, which can stall the tab.
    setDocument(null)

    try {
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      )
      const xmlText = await file.text()
      if (loadId !== loadIdRef.current) return

      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      )
      readXml(xmlText, file.name)
    } catch {
      if (loadId !== loadIdRef.current) return
      setDocument(null)
      setError("The selected file could not be opened.")
    } finally {
      if (loadId === loadIdRef.current) setIsReading(false)
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) {
      void loadFile(file)
    }
    event.target.value = ""
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)

    const file = event.dataTransfer.files?.[0]
    if (file) {
      void loadFile(file)
    }
  }

  const totalTinPoints =
    document?.surfaces.reduce(
      (sum, surface) =>
        sum + Object.keys(surface.points).length,
      0,
    ) ?? 0
  const totalFaces =
    document?.surfaces.reduce(
      (sum, surface) => sum + surface.faces.length,
      0,
    ) ?? 0

  return (
    <div className="relative z-10 min-h-screen px-6 py-20 md:py-24">
      <PageSeo
        title="LandXML Viewer Online for Surveyors | SurveyTool.io"
        description="Open LandXML files online and inspect survey surfaces, TIN faces, alignments and COGO points in a private browser-based plan viewer."
        canonicalUrl="https://www.surveytool.io/tools/landxml-viewer"
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
              LandXML Viewer
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-400">
              Open a LandXML file, inspect its survey data and preview
              surfaces, alignments and points without desktop software.
            </p>
          </div>

          <div className="inline-flex w-fit items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
            <ShieldCheck size={20} />
            Processed privately in your browser
          </div>
        </div>

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
          onDrop={handleDrop}
          className={`mt-10 rounded-3xl border border-dashed px-8 py-16 text-center transition md:py-20 ${
            isDragging
              ? "border-cyan-300 bg-cyan-400/10"
              : "border-white/20 bg-white/5 hover:border-cyan-400/70"
          }`}
        >
          <Upload size={42} className="mx-auto text-cyan-300" />
          <h2 className="mt-5 text-2xl font-semibold">
            {isReading ? "Reading LandXML…" : "Drop your LandXML file here"}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-slate-400">
            Supports standard .xml and .landxml files up to 100 MB.
            Nothing is uploaded to a server.
          </p>

          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              disabled={isReading}
              onClick={() => inputRef.current?.click()}
              className="rounded-full bg-cyan-400 px-7 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-wait disabled:opacity-60"
            >
              Choose LandXML file
            </button>
            <button
              type="button"
              disabled={isReading}
              onClick={() => readXml(demoLandXml, "surveytool-demo.xml")}
              className="rounded-full border border-white/15 px-7 py-3 font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
            >
              Load demo
            </button>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".xml,.landxml,text/xml,application/xml"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-5 text-rose-200"
          >
            <strong className="block">Could not open this file</strong>
            <span className="mt-1 block text-sm text-rose-200/80">
              {error}
            </span>
          </div>
        )}

        {document && (
          <div className="mt-8 space-y-8">
            <section className="rounded-3xl border border-cyan-400/20 bg-cyan-400/5 p-6">
              <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-cyan-400/10 p-3 text-cyan-300">
                    <FileCode2 size={28} />
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">Loaded file</p>
                    <h2 className="mt-1 break-all text-xl font-semibold">
                      {document.fileName}
                    </h2>
                    <p className="mt-1 text-sm text-slate-400">
                      {document.projectName} · LandXML {document.version} · {" "}
                      {document.units}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold transition hover:bg-white/10"
                >
                  Open another file
                </button>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold">File summary</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <SummaryCard
                  icon={Mountain}
                  value={document.surfaces.length}
                  label="Surfaces"
                />
                <SummaryCard
                  icon={Layers3}
                  value={totalTinPoints}
                  label="TIN points"
                />
                <SummaryCard
                  icon={Layers3}
                  value={totalFaces}
                  label="TIN faces"
                />
                <SummaryCard
                  icon={Route}
                  value={document.alignments.length}
                  label="Alignments"
                />
                <SummaryCard
                  icon={MapPin}
                  value={document.cogoPoints.length}
                  label="COGO points"
                />
              </div>
            </section>

            {document.warnings.length > 0 && (
              <section className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-sm text-amber-200">
                <h2 className="font-semibold">File notes</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-200/80">
                  {document.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </section>
            )}

            <LandXmlPreview document={document} />

            <section className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <h2 className="text-xl font-semibold">Surfaces</h2>
                {document.surfaces.length > 0 ? (
                  <div className="mt-5 space-y-3">
                    {document.surfaces.map((surface) => (
                      <div
                        key={surface.name}
                        className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"
                      >
                        <h3 className="font-semibold">{surface.name}</h3>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-400">
                          <span>
                            {formatNumber(Object.keys(surface.points).length)} points
                          </span>
                          <span>
                            {formatNumber(surface.faces.length)} faces
                          </span>
                          <span>Min RL {formatLevel(surface.minElevation)}</span>
                          <span>Max RL {formatLevel(surface.maxElevation)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-slate-400">
                    No surfaces found in this file.
                  </p>
                )}
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <h2 className="text-xl font-semibold">Alignments</h2>
                {document.alignments.length > 0 ? (
                  <div className="mt-5 space-y-3">
                    {document.alignments.map((alignment) => (
                      <div
                        key={alignment.name}
                        className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"
                      >
                        <h3 className="font-semibold">{alignment.name}</h3>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-400">
                          <span>
                            Length {alignment.length?.toFixed(3) ?? "—"}
                          </span>
                          <span>
                            Start CH {alignment.startStation?.toFixed(3) ?? "—"}
                          </span>
                          <span className="col-span-2">
                            {formatNumber(alignment.points.length)} preview vertices
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-slate-400">
                    No alignments found in this file.
                  </p>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

type SummaryCardProps = {
  icon: typeof Mountain
  value: number
  label: string
}

function SummaryCard({
  icon: Icon,
  value,
  label,
}: SummaryCardProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <Icon size={23} className="text-cyan-300" />
      <div className="mt-4 text-3xl font-bold">
        {formatNumber(value)}
      </div>
      <div className="mt-1 text-sm text-slate-400">{label}</div>
    </div>
  )
}
