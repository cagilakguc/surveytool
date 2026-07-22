import { useRef, useState } from "react"
import type { ChangeEvent, DragEvent } from "react"
import { ArrowLeft, FilePlus2, Layers3, Route, RotateCcw, ShieldCheck, Upload } from "lucide-react"
import { Link } from "react-router-dom"

import LandXmlCrossSection from "../components/LandXmlCrossSection"
import PageSeo from "../components/PageSeo"
import { parseLandXml } from "../lib/landxml"
import type { LandXmlDocument } from "../lib/landxml"

const maximumFileSize = 100 * 1024 * 1024

const demoLandXml = `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="2026-07-22">
  <Project name="SurveyTool Cross Section Demo" />
  <Units><Metric linearUnit="meter" /></Units>
  <Surfaces>
    <Surface name="Finished Surface">
      <Definition surfType="TIN">
        <Pnts>
          <P id="1">5923000 1755000 12.000</P>
          <P id="2">5923000 1755100 12.300</P>
          <P id="3">5923100 1755100 13.100</P>
          <P id="4">5923100 1755000 12.800</P>
          <P id="5">5923050 1755050 12.650</P>
        </Pnts>
        <Faces><F>1 2 5</F><F>2 3 5</F><F>3 4 5</F><F>4 1 5</F></Faces>
      </Definition>
    </Surface>
    <Surface name="Pavement Bottom">
      <Definition surfType="TIN">
        <Pnts>
          <P id="1">5923000 1755000 11.750</P>
          <P id="2">5923000 1755100 12.050</P>
          <P id="3">5923100 1755100 12.850</P>
          <P id="4">5923100 1755000 12.550</P>
          <P id="5">5923050 1755050 12.400</P>
        </Pnts>
        <Faces><F>1 2 5</F><F>2 3 5</F><F>3 4 5</F><F>4 1 5</F></Faces>
      </Definition>
    </Surface>
  </Surfaces>
  <Alignments>
    <Alignment name="Road Centreline" length="113.137" staStart="1200.000">
      <CoordGeom>
        <Line><Start>5923010 1755010</Start><End>5923090 1755090</End></Line>
      </CoordGeom>
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
  const [document, setDocument] = useState<LandXmlDocument | null>(null)
  const [loadedFiles, setLoadedFiles] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isReading, setIsReading] = useState(false)
  const [error, setError] = useState("")

  async function loadFiles(files: File[]) {
    if (files.length === 0) return

    setIsReading(true)
    setError("")

    try {
      let mergedDocument = document
      const acceptedNames: string[] = []

      for (const file of files) {
        if (file.size > maximumFileSize) {
          throw new Error(`${file.name} is larger than the 100 MB browser limit.`)
        }

        const parsed = parseLandXml(await file.text(), file.name)
        mergedDocument = mergeDocuments(mergedDocument, parsed)
        acceptedNames.push(file.name)

        await new Promise<void>((resolve) =>
          window.requestAnimationFrame(() => resolve()),
        )
      }

      setDocument(mergedDocument)
      setLoadedFiles((current) =>
        Array.from(new Set([...current, ...acceptedNames])),
      )
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The selected LandXML files could not be opened.",
      )
    } finally {
      setIsReading(false)
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
    setDocument(parseLandXml(demoLandXml, "cross-section-demo.xml"))
    setLoadedFiles(["cross-section-demo.xml"])
    setError("")
  }

  function reset() {
    setDocument(null)
    setLoadedFiles([])
    setError("")
  }

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
              Load one or more LandXML files, select the road alignment, drag a
              visible section line across the TIN and inspect chainage and RL
              profiles in a centred result window.
            </p>
          </div>

          <div className="inline-flex w-fit items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
            <ShieldCheck size={20} />
            Processed privately in your browser
          </div>
        </div>

        {!document ? (
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
              {isReading ? "Reading LandXML…" : "Drop surface and alignment XML files here"}
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-400">
              Select multiple files together, or load the surface first and add
              the alignment LandXML later. Files with matching surface or
              alignment names use the most recently added version.
            </p>

            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                disabled={isReading}
                onClick={() => inputRef.current?.click()}
                className="rounded-full bg-cyan-400 px-7 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-wait disabled:opacity-60"
              >
                Choose LandXML files
              </button>
              <button
                type="button"
                disabled={isReading}
                onClick={loadDemo}
                className="rounded-full border border-white/15 px-7 py-3 font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
              >
                Load demo
              </button>
            </div>
          </div>
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
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    disabled={isReading}
                    onClick={() => inputRef.current?.click()}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60"
                  >
                    <FilePlus2 size={17} />
                    {isReading ? "Adding files…" : "Add companion LandXML"}
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

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <Layers3 size={20} className="text-cyan-300" />
                  <p className="mt-3 text-2xl font-bold">{document.surfaces.length}</p>
                  <p className="text-sm text-slate-400">TIN surfaces</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <Route size={20} className="text-amber-300" />
                  <p className="mt-3 text-2xl font-bold">{document.alignments.length}</p>
                  <p className="text-sm text-slate-400">Selectable alignments</p>
                </div>
              </div>
            </section>

            {document.surfaces.length > 0 ? (
              <LandXmlCrossSection document={document} />
            ) : (
              <section className="rounded-3xl border border-amber-400/20 bg-amber-400/5 p-6 text-amber-200">
                <h2 className="font-semibold">No TIN surface loaded yet</h2>
                <p className="mt-2 text-sm text-amber-200/80">
                  The alignment has been kept. Add the LandXML containing the
                  finished surface or pavement TIN to begin drawing sections.
                </p>
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
