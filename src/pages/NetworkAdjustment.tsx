import { useState } from "react"
import type { ChangeEvent } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, Download, Sigma, Upload } from "lucide-react"

import PageSeo from "../components/PageSeo"
import { adjustNetwork } from "../lib/networkAdjustment"
import type { InstrumentPrecision, NetworkAdjustmentResult } from "../lib/networkAdjustment"
import {
  buildClosureInput,
  buildNetworkInput,
  parseAliases,
  parseCoordinateTable,
} from "../lib/networkFromRaw"
import type { BuiltNetwork } from "../lib/networkFromRaw"
import { parseStarnetRaw } from "../lib/starnetRaw"
import type { RawTraverse } from "../lib/starnetRaw"
import { parseRawCsv, pairsToCsv, readingsToCsv } from "../lib/rawCsv"
import { checkTraverseClosure } from "../lib/traverseClosure"
import type { TraverseClosureResult } from "../lib/traverseClosure"

type Language = "en" | "tr"

const copy = {
  en: {
    back: "Back to tools",
    title: "Network Adjustment (3D)",
    intro:
      "Adjust a total-station network from a Leica or Trimble raw traverse file. Heights are included. Calculations run in your browser; no data is uploaded.",
    disclaimer:
      "Results are for checking and must be reviewed by a qualified surveyor before use in design or construction decisions.",
    language: "Language",
    rawFile: "Raw traverse file (.txt Starnet or .csv)",
    csvHint:
      "CSV columns: setup, target, hz, vz, sd, hi, ht (required); face, ppm (optional). Angles in gon, distances in metres. Comma or semicolon separated.",
    downloadReadings: "Download readings (CSV)",
    downloadPairs: "Download averaged pairs (CSV)",
    orPaste: "or paste the raw text",
    loaded: "Loaded",
    coordinates: "Coordinates (id, easting, northing, elevation, fixed)",
    coordinatesHint: "Fixed: XYZ, XY, Z, or blank for free. Header line is optional.",
    aliases: "Name aliases (RAW = NAME, one per line)",
    aliasesHint: "Use this when the same physical point is written under two names.",
    excluded: "Excluded setups (comma separated)",
    instrument: "Instrument",
    angleSigma: "Angle σ (arc-seconds)",
    distanceConstant: "Distance constant (mm)",
    distancePpm: "Distance ppm",
    zenithNote: "Zenith angles use the same angle σ.",
    outlier: "Outlier threshold (|w|)",
    precisionMin: "Minimum traverse precision (1 : n)",
    traverse: "Traverse closure check",
    traverseEnabled: "Run traverse closure",
    sequence: "Station sequence: start, intermediate stations, end",
    startBack: "Start backsight point",
    endBack: "End backsight point",
    run: "Run adjustment",
    summary: "Summary",
    observations: "Observations",
    unknowns: "Unknowns",
    dof: "Degrees of freedom",
    sigma0: "A-posteriori σ0",
    flagged: "Flagged observations",
    points: "Adjusted points",
    point: "Point",
    easting: "Easting (m)",
    northing: "Northing (m)",
    elevation: "Elevation (m)",
    sE: "σE (m)",
    sN: "σN (m)",
    sH: "σH (m)",
    observationTable: "Observation residuals",
    index: "#",
    kind: "Type",
    residual: "Residual",
    stdDev: "σ",
    standardized: "w",
    redundancy: "r",
    flag: "Flag",
    yes: "Check",
    closure: "Traverse closure",
    linear: "Linear misclosure (m)",
    perimeter: "Perimeter (m)",
    precision: "Precision",
    angular: "Angular misclosure (arc-sec)",
    tolerance: "Tolerance (arc-sec)",
    ok: "OK",
    warn: "Check",
    qc: "Data checks",
    dropped: "Dropped from adjustment",
    headerAnomalies: "Header lines with a 1.00 correction",
    unpaired: "Setups with unequal face counts",
    skipped: "Unrecognised lines",
    download: "Download adjusted points (CSV)",
    errorTitle: "Could not run",
    warningsTitle: "Warnings",
    showingFirst: "Showing the first 300 observations.",
    none: "None",
  },
  tr: {
    back: "Araçlara dön",
    title: "Ağ Dengelemesi (3B)",
    intro:
      "Leica veya Trimble ham poligon dosyasından total station ağını dengeleyin. Yükseklikler dahildir. Hesaplar tarayıcınızda yapılır, veri yüklenmez.",
    disclaimer:
      "Sonuçlar kontrol amaçlıdır. Tasarım veya inşaat kararlarında kullanmadan önce yetkili bir surveyor tarafından incelenmelidir.",
    language: "Dil",
    rawFile: "Ham poligon dosyası (.txt Starnet veya .csv)",
    csvHint:
      "CSV sütunları: setup (istasyon), target (hedef), hz, vz, sd, hi, ht zorunlu; face (yüz), ppm isteğe bağlı. Açılar gon, mesafeler metre. Virgül veya noktalı virgülle ayrılabilir.",
    downloadReadings: "Ölçüleri indir (CSV)",
    downloadPairs: "Ortalama ölçüleri indir (CSV)",
    orPaste: "veya ham metni yapıştırın",
    loaded: "Yüklendi",
    coordinates: "Koordinatlar (id, doğu, kuzey, yükseklik, sabit)",
    coordinatesHint: "Sabit: XYZ, XY, Z; serbest için boş bırakın. Başlık satırı isteğe bağlıdır.",
    aliases: "Nokta adı eşlemesi (HAM = AD, her satırda bir tane)",
    aliasesHint: "Aynı noktanın iki farklı adla yazıldığı durumlarda kullanın.",
    excluded: "Dışlanacak kurulumlar (virgülle ayırın)",
    instrument: "Cihaz",
    angleSigma: "Açı σ (saniye)",
    distanceConstant: "Mesafe sabiti (mm)",
    distancePpm: "Mesafe ppm",
    zenithNote: "Zenit açıları da aynı açı σ değerini kullanır.",
    outlier: "Kaba hata eşiği (|w|)",
    precisionMin: "Minimum poligon hassasiyeti (1 : n)",
    traverse: "Poligon kapanış kontrolü",
    traverseEnabled: "Poligon kapanışını çalıştır",
    sequence: "İstasyon sırası: başlangıç, ara istasyonlar, bitiş",
    startBack: "Başlangıç geri nişan noktası",
    endBack: "Bitiş geri nişan noktası",
    run: "Dengelemeyi çalıştır",
    summary: "Özet",
    observations: "Gözlemler",
    unknowns: "Bilinmeyenler",
    dof: "Serbestlik derecesi",
    sigma0: "Sonsal σ0",
    flagged: "İşaretlenen gözlemler",
    points: "Dengelenmiş noktalar",
    point: "Nokta",
    easting: "Doğu (m)",
    northing: "Kuzey (m)",
    elevation: "Yükseklik (m)",
    sE: "σD (m)",
    sN: "σK (m)",
    sH: "σY (m)",
    observationTable: "Gözlem artıkları",
    index: "#",
    kind: "Tür",
    residual: "Artık",
    stdDev: "σ",
    standardized: "w",
    redundancy: "r",
    flag: "Durum",
    yes: "Kontrol",
    closure: "Poligon kapanışı",
    linear: "Doğrusal kapanma (m)",
    perimeter: "Çevre (m)",
    precision: "Hassasiyet",
    angular: "Açısal kapanma (saniye)",
    tolerance: "Tolerans (saniye)",
    ok: "Uygun",
    warn: "Kontrol",
    qc: "Veri kontrolleri",
    dropped: "Dengelemeden çıkarılanlar",
    headerAnomalies: "1.00 düzeltmesi içeren başlık satırları",
    unpaired: "Yüz sayıları eşit olmayan kurulumlar",
    skipped: "Tanınmayan satırlar",
    download: "Dengelenmiş noktaları indir (CSV)",
    errorTitle: "Çalıştırılamadı",
    warningsTitle: "Uyarılar",
    showingFirst: "İlk 300 gözlem gösteriliyor.",
    none: "Yok",
  },
} as const

type Copy = Record<keyof (typeof copy)["en"], string>

type Preset = {
  label: string
  angleSigma: number
  distanceConstant: number
  distancePpm: number
}

const presets: Record<string, Preset> = {
  ts16: { label: 'Leica TS16 1" (ISO 1σ)', angleSigma: 1, distanceConstant: 1, distancePpm: 1.5 },
  s7Iso: { label: 'Trimble S7 1" (ISO 1σ)', angleSigma: 1, distanceConstant: 1, distancePpm: 2 },
  s7Rmse: { label: 'Trimble S7 1" (RMSE, conservative)', angleSigma: 1, distanceConstant: 2, distancePpm: 2 },
  custom: { label: "Custom", angleSigma: 1, distanceConstant: 1, distancePpm: 2 },
}

type Run = {
  raw: RawTraverse
  built: BuiltNetwork
  adjustment: NetworkAdjustmentResult
  closure: TraverseClosureResult | null
  closureError: string | null
}

/** CSV when the file name ends in .csv, or when the first data line is a comma/semicolon header and not a Starnet line. */
function looksLikeCsv(text: string, fileName: string) {
  if (fileName.toLowerCase().endsWith(".csv")) return true;
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith("#"));
  return firstLine !== undefined && /[,;]/.test(firstLine) && !/^\s*(DB|DM)\s/.test(firstLine);
}

function saveCsv(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function formatNumber(value: number, digits: number) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—"
}

export default function NetworkAdjustment() {
  const [language, setLanguage] = useState<Language>("en")
  const t: Copy = copy[language]

  const [rawText, setRawText] = useState("")
  const [fileName, setFileName] = useState("")
  const [coordinatesText, setCoordinatesText] = useState("")
  const [aliasText, setAliasText] = useState("")
  const [excludedText, setExcludedText] = useState("")

  const [presetKey, setPresetKey] = useState("ts16")
  const [angleSigma, setAngleSigma] = useState(presets.ts16.angleSigma)
  const [distanceConstant, setDistanceConstant] = useState(presets.ts16.distanceConstant)
  const [distancePpm, setDistancePpm] = useState(presets.ts16.distancePpm)
  const [outlierThreshold, setOutlierThreshold] = useState(3)
  const [minimumPrecision, setMinimumPrecision] = useState(5000)

  const [traverseEnabled, setTraverseEnabled] = useState(false)
  const [sequenceText, setSequenceText] = useState("")
  const [startBacksight, setStartBacksight] = useState("")
  const [endBacksight, setEndBacksight] = useState("")

  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState<string | null>(null)

  const applyPreset = (key: string) => {
    setPresetKey(key)
    const preset = presets[key]
    setAngleSigma(preset.angleSigma)
    setDistanceConstant(preset.distanceConstant)
    setDistancePpm(preset.distancePpm)
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setRawText(await file.text())
  }

  const precision: InstrumentPrecision = {
    distanceConstantM: distanceConstant / 1000,
    distancePpm,
    angleStdDevSec: angleSigma,
    zenithStdDevSec: angleSigma,
  }

  const runAdjustment = () => {
    setError(null)
    setRun(null)
    try {
      if (!rawText.trim()) throw new Error("Load or paste a raw traverse file first.")
      const raw = looksLikeCsv(rawText, fileName) ? parseRawCsv(rawText) : parseStarnetRaw(rawText)
      const coordinates = parseCoordinateTable(coordinatesText)
      const aliases = parseAliases(aliasText)
      const excludedSetups = new Set(
        excludedText.split(",").map((s) => s.trim()).filter(Boolean),
      )
      const options = { aliases, excludedSetups, coordinates, precision }
      const built = buildNetworkInput(raw, options)
      const adjustment = adjustNetwork(built.points, built.observations, precision, {
        outlierThreshold,
      })

      let closure: TraverseClosureResult | null = null
      let closureError: string | null = null
      if (traverseEnabled) {
        try {
          const sequence = sequenceText.split(",").map((s) => s.trim()).filter(Boolean)
          const closureOptions = buildClosureInput(raw, options, {
            sequence,
            startBacksight: startBacksight.trim(),
            endBacksight: endBacksight.trim(),
            angleStdDevSec: angleSigma,
            minimumPrecisionDenominator: minimumPrecision,
          })
          closure = checkTraverseClosure(closureOptions)
        } catch (closureFailure) {
          closureError = closureFailure instanceof Error ? closureFailure.message : String(closureFailure)
        }
      }
      setRun({ raw, built, adjustment, closure, closureError })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const downloadCsv = () => {
    if (!run) return
    const rows = [
      ["id", "easting", "northing", "elevation", "sigma_e", "sigma_n", "sigma_h", "fixed"],
      ...run.adjustment.points.map((p) => [
        p.id,
        p.easting.toFixed(4),
        p.northing.toFixed(4),
        p.elevation.toFixed(4),
        p.eastingStdDev.toFixed(4),
        p.northingStdDev.toFixed(4),
        p.elevationStdDev.toFixed(4),
        `${p.fixedHorizontal ? "XY" : ""}${p.fixedHeight ? "Z" : ""}`,
      ]),
    ]
    const csv = rows.map((row) => row.join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "adjusted-points.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  const downloadReadings = () => {
    if (run) saveCsv("measurements-readings.csv", readingsToCsv(run.raw.readings))
  }

  const downloadPairs = () => {
    if (run) saveCsv("measurements-averaged-pairs.csv", pairsToCsv(run.raw.pairs))
  }

  const input =
    "w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none"
  const label = "block text-xs font-medium uppercase tracking-wide text-slate-400"
  const card = "rounded-2xl border border-white/10 bg-white/5 p-5"

  return (
    <div className="relative z-10 mx-auto max-w-6xl px-6 py-12 text-slate-100">
      <PageSeo
        title="Network Adjustment (3D) | Survey Tool"
        description="Least-squares adjustment of total-station networks with heights, traverse closure and Starnet raw file import."
        canonicalUrl="https://www.surveytool.io/tools/network-adjustment"
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
          <ArrowLeft size={16} /> {t.back}
        </Link>
        <div className="inline-flex rounded-xl border border-white/10 p-1 text-sm">
          {(["en", "tr"] as const).map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={language === code}
              onClick={() => setLanguage(code)}
              className={`rounded-lg px-3 py-1 ${language === code ? "bg-cyan-400/20 text-cyan-100" : "text-slate-400 hover:text-white"}`}
            >
              {code === "en" ? "English" : "Türkçe"}
            </button>
          ))}
        </div>
      </div>

      <header className="mt-8 flex items-start gap-4">
        <Sigma className="mt-1 text-cyan-300" size={28} />
        <div>
          <h1 className="text-3xl font-semibold">{t.title}</h1>
          <p className="mt-2 max-w-3xl text-slate-300">{t.intro}</p>
          <p className="mt-3 rounded-xl border border-orange-300/30 bg-orange-300/10 px-4 py-2 text-sm text-orange-100">
            {t.disclaimer}
          </p>
        </div>
      </header>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className={card}>
          <label className={label}>{t.rawFile}</label>
          <label className="mt-2 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-white/20 px-4 py-3 text-sm text-slate-300 hover:border-cyan-300/50">
            <Upload size={16} />
            <span>{fileName ? `${t.loaded}: ${fileName}` : t.rawFile}</span>
            <input type="file" accept=".txt,.csv" className="sr-only" onChange={onFile} />
          </label>
          <p className="mt-4 text-xs text-slate-500">{t.orPaste}</p>
          <p className="mt-1 text-xs text-slate-500">{t.csvHint}</p>
          <textarea
            className={`${input} mt-2 h-32 font-mono text-xs`}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="# Starnet Traverse ..."
          />
        </div>

        <div className={card}>
          <label className={label}>{t.coordinates}</label>
          <p className="mt-1 text-xs text-slate-500">{t.coordinatesHint}</p>
          <textarea
            className={`${input} mt-2 h-32 font-mono text-xs`}
            value={coordinatesText}
            onChange={(e) => setCoordinatesText(e.target.value)}
            placeholder={"id,easting,northing,elevation,fixed\nMPS7T,1000.000,2000.000,10.000,XYZ\nTRAV01,1005.000,2003.000,10.200,"}
          />
          <label className={`${label} mt-4 block`}>{t.aliases}</label>
          <p className="mt-1 text-xs text-slate-500">{t.aliasesHint}</p>
          <textarea
            className={`${input} mt-2 h-20 font-mono text-xs`}
            value={aliasText}
            onChange={(e) => setAliasText(e.target.value)}
            placeholder="TRAV69A = TRAV69"
          />
          <label className={`${label} mt-4 block`}>{t.excluded}</label>
          <input className={`${input} mt-2`} value={excludedText} onChange={(e) => setExcludedText(e.target.value)} />
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className={card}>
          <h2 className="text-lg font-semibold">{t.instrument}</h2>
          <select
            className={`${input} mt-3`}
            value={presetKey}
            onChange={(e) => applyPreset(e.target.value)}
          >
            {Object.entries(presets).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
          </select>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>{t.angleSigma}</label>
              <input type="number" step="0.1" min="0" className={`${input} mt-2`} value={angleSigma} onChange={(e) => { setPresetKey("custom"); setAngleSigma(Number(e.target.value)) }} />
            </div>
            <div>
              <label className={label}>{t.distanceConstant}</label>
              <input type="number" step="0.1" min="0" className={`${input} mt-2`} value={distanceConstant} onChange={(e) => { setPresetKey("custom"); setDistanceConstant(Number(e.target.value)) }} />
            </div>
            <div>
              <label className={label}>{t.distancePpm}</label>
              <input type="number" step="0.1" min="0" className={`${input} mt-2`} value={distancePpm} onChange={(e) => { setPresetKey("custom"); setDistancePpm(Number(e.target.value)) }} />
            </div>
            <div>
              <label className={label}>{t.outlier}</label>
              <input type="number" step="0.5" min="1" className={`${input} mt-2`} value={outlierThreshold} onChange={(e) => setOutlierThreshold(Number(e.target.value))} />
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">{t.zenithNote}</p>
        </div>

        <div className={card}>
          <label className="flex items-center gap-2 text-lg font-semibold">
            <input type="checkbox" checked={traverseEnabled} onChange={(e) => setTraverseEnabled(e.target.checked)} />
            {t.traverse}
          </label>
          <div className="mt-4 space-y-4">
            <div>
              <label className={label}>{t.sequence}</label>
              <input className={`${input} mt-2`} value={sequenceText} onChange={(e) => setSequenceText(e.target.value)} placeholder="A, D, E, B" disabled={!traverseEnabled} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={label}>{t.startBack}</label>
                <input className={`${input} mt-2`} value={startBacksight} onChange={(e) => setStartBacksight(e.target.value)} disabled={!traverseEnabled} />
              </div>
              <div>
                <label className={label}>{t.endBack}</label>
                <input className={`${input} mt-2`} value={endBacksight} onChange={(e) => setEndBacksight(e.target.value)} disabled={!traverseEnabled} />
              </div>
            </div>
            <div>
              <label className={label}>{t.precisionMin}</label>
              <input type="number" min="1" className={`${input} mt-2`} value={minimumPrecision} onChange={(e) => setMinimumPrecision(Number(e.target.value))} disabled={!traverseEnabled} />
            </div>
          </div>
        </div>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={runAdjustment}
          className="rounded-xl bg-cyan-400 px-6 py-3 font-semibold text-slate-950 hover:bg-cyan-300"
        >
          {t.run}
        </button>
        {run && (
          <button type="button" onClick={downloadCsv} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm hover:border-cyan-300/50">
            <Download size={16} /> {t.download}
          </button>
        )}
        {run && (
          <>
            <button type="button" onClick={downloadReadings} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm hover:border-cyan-300/50">
              <Download size={16} /> {t.downloadReadings}
            </button>
            <button type="button" onClick={downloadPairs} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm hover:border-cyan-300/50">
              <Download size={16} /> {t.downloadPairs}
            </button>
          </>
        )}
      </div>

      {error && (
        <div role="alert" className="mt-6 rounded-xl border border-rose-400/40 bg-rose-400/10 p-4 text-rose-100">
          <p className="font-semibold">{t.errorTitle}</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      )}

      {run && <Results run={run} t={t} card={card} />}
    </div>
  )
}

function Results({ run, t, card }: { run: Run; t: Copy; card: string }) {
  const { adjustment, closure, closureError, built, raw } = run
  const warnings = [...adjustment.warnings, ...(closure?.warnings ?? [])]
  const shownObservations = adjustment.observations.slice(0, 300)
  const dropped = built.dropped
  const headerAnomalies = raw.qc.headerCorrectionAnomalies.length
  const unpaired = raw.qc.unpairedFaces
  const skipped = raw.qc.skippedLines.length

  return (
    <div className="mt-10 space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          [t.observations, adjustment.observationCount],
          [t.unknowns, adjustment.unknownCount],
          [t.dof, adjustment.degreesOfFreedom],
          [t.sigma0, formatNumber(adjustment.sigma0, 3)],
          [t.flagged, adjustment.flaggedCount],
        ].map(([name, value]) => (
          <div key={String(name)} className={card}>
            <p className="text-xs uppercase tracking-wide text-slate-400">{name}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </section>

      {warnings.length > 0 && (
        <section className="rounded-xl border border-orange-300/30 bg-orange-300/10 p-4 text-sm text-orange-100">
          <p className="font-semibold">{t.warningsTitle}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </section>
      )}

      {closureError && (
        <section className="rounded-xl border border-rose-400/40 bg-rose-400/10 p-4 text-sm text-rose-100">
          {t.closure}: {closureError}
        </section>
      )}

      {closure && (
        <section className={card}>
          <h2 className="text-lg font-semibold">{t.closure}</h2>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-slate-400">{t.linear}</dt><dd className="mt-1 font-mono">{formatNumber(closure.linearMisclosure, 4)}</dd></div>
            <div><dt className="text-slate-400">{t.perimeter}</dt><dd className="mt-1 font-mono">{formatNumber(closure.perimeter, 2)}</dd></div>
            <div><dt className="text-slate-400">{t.precision}</dt><dd className="mt-1 font-mono">{Number.isFinite(closure.precisionDenominator) ? `1 : ${Math.round(closure.precisionDenominator)}` : "1 : ∞"}</dd></div>
            <div><dt className="text-slate-400">{t.angular}</dt><dd className="mt-1 font-mono">{formatNumber(closure.angularMisclosureSec, 1)} ({closure.angularWarning || closure.precisionWarning ? t.warn : t.ok})</dd></div>
            <div><dt className="text-slate-400">{t.tolerance}</dt><dd className="mt-1 font-mono">{formatNumber(closure.angularToleranceSec, 1)}</dd></div>
          </dl>
        </section>
      )}

      <section className={card}>
        <h2 className="text-lg font-semibold">{t.points}</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                {[t.point, t.easting, t.northing, t.elevation, t.sE, t.sN, t.sH].map((h) => (
                  <th key={h} className="whitespace-nowrap py-2 pr-4 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {adjustment.points.map((p) => (
                <tr key={p.id} className="border-t border-white/5">
                  <td className="py-2 pr-4 font-mono">{p.id}</td>
                  <td className="py-2 pr-4 font-mono">{formatNumber(p.easting, 4)}</td>
                  <td className="py-2 pr-4 font-mono">{formatNumber(p.northing, 4)}</td>
                  <td className="py-2 pr-4 font-mono">{formatNumber(p.elevation, 4)}</td>
                  <td className="py-2 pr-4 font-mono">{formatNumber(p.eastingStdDev, 4)}</td>
                  <td className="py-2 pr-4 font-mono">{formatNumber(p.northingStdDev, 4)}</td>
                  <td className="py-2 pr-4 font-mono">{formatNumber(p.elevationStdDev, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">{t.observationTable}</h2>
        <p className="mt-1 text-xs text-slate-500">{adjustment.observations.length > 300 ? t.showingFirst : ""}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="uppercase tracking-wide text-slate-400">
              <tr>
                {[t.index, t.kind, t.residual, t.stdDev, t.standardized, t.redundancy, t.flag].map((h) => (
                  <th key={h} className="whitespace-nowrap py-2 pr-4 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownObservations.map((o) => (
                <tr key={o.index} className={`border-t border-white/5 ${o.flagged ? "bg-orange-300/10 text-orange-100" : "text-slate-300"}`}>
                  <td className="py-1.5 pr-4 font-mono">{o.index + 1}</td>
                  <td className="py-1.5 pr-4">{o.kind}</td>
                  <td className="py-1.5 pr-4 font-mono">{formatNumber(o.residual, o.unit === "m" ? 5 : 2)} {o.unit}</td>
                  <td className="py-1.5 pr-4 font-mono">{formatNumber(o.stdDev, o.unit === "m" ? 5 : 2)}</td>
                  <td className="py-1.5 pr-4 font-mono">{o.standardized === null ? "—" : formatNumber(o.standardized, 2)}</td>
                  <td className="py-1.5 pr-4 font-mono">{formatNumber(o.redundancy, 2)}</td>
                  <td className="py-1.5 pr-4">{o.flagged ? t.yes : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">{t.qc}</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-400">{t.headerAnomalies}</dt>
            <dd className="mt-1">{headerAnomalies}</dd>
          </div>
          <div>
            <dt className="text-slate-400">{t.skipped}</dt>
            <dd className="mt-1">{skipped}</dd>
          </div>
          <div>
            <dt className="text-slate-400">{t.unpaired}</dt>
            <dd className="mt-1">
              {unpaired.length === 0 ? t.none : unpaired.map((u) => `${u.setup} → ${u.target} (${u.face1}/${u.face2})`).join("; ")}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">{t.dropped}</dt>
            <dd className="mt-1">{dropped.length === 0 ? t.none : dropped.join("; ")}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
