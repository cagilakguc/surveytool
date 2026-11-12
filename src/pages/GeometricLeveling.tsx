import { useState } from "react"
import type { ChangeEvent } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, Download, FileText, Ruler, Upload } from "lucide-react"

import PageSeo from "../components/PageSeo"
import {
  calculateLeveling, parseLevelCsv,
} from "../lib/geometricLeveling"
import type { LevelMethod, LevelResult } from "../lib/geometricLeveling"
import {
  createReportCsv, createReportPdf, downloadReportBlob, safeReportName,
} from "../lib/surveyReports"
import type { SurveyReport } from "../lib/surveyReports"

const example = [
  "setup,point,sight,reading_m,distance_m",
  "S1,BM_A,BS,1.455,30",
  "S1,TP1,FS,1.115,35",
  "S2,TP1,BS,1.630,42",
  "S2,P101,IS,1.755,20",
  "S2,BM_B,FS,1.425,43",
].join("\n")

const copy = {
  en: {
    title: "Geometric Levelling", intro: "Reduce differential levelling staff readings (BS / IS / FS), verify the height difference, check closure, and export a field report. All calculations run in your browser.",
    back: "Back to tools", warning: "Check the measurement method, benchmark datum and project tolerance before construction use. This is geometric levelling with staff readings, not total-station trigonometric height transfer.",
    language: "Language", upload: "Load levelling CSV", example: "Load example CSV",
    csvLabel: "Levelling readings (CSV)", csvHint: "Columns: setup, point, sight, reading_m, distance_m. One setup block must begin with BS, contain optional IS, and end with FS; the next BS must be at the previous FS turning point.",
    project: "Project / report name", start: "Known start RL (m)", end: "Known end RL (m, optional)", endHint: "Leave empty for an open line. If the last FS point has the same name as the first BS, a closed-loop check uses the start RL automatically.",
    method: "Distribute closure correction", auto: "Automatic: sight distances if complete, otherwise per setup",
    distance: "By BS+FS sight distances", setups: "Equally per setup",
    tolerance: "Tolerance coefficient (mm/√km)", toleranceHint: "Project-defined acceptance criterion, not a universal standard. Tolerance can only be assessed if every BS and FS sight distance is supplied.",
    calculate: "Calculate levelling", result: "Levelling results", point: "Point", setup: "Setup", sight: "Sight", reading: "Reading (m)", distanceLabel: "Sight distance (m)", hi: "HI (m)", raw: "Unadjusted RL (m)", correction: "Correction (m)", adjusted: "Adjusted RL (m)",
    stations: "Instrument setups", length: "Measured line length", first: "Start benchmark", last: "End benchmark",
    closure: "Height misclosure", toleranceResult: "Allowed misclosure", sumBsFs: "Σ BS − Σ FS",
    status: "Acceptance", pass: "Within tolerance", fail: "Out of tolerance", unverified: "Not assessable",
    csv: "Download CSV report", pdf: "Download PDF report", error: "Could not calculate", notes: "Calculation notes",
    noData: "Load a CSV or paste readings to begin.", methodDistance: "Distance-weighted", methodSetups: "Equal setups",
  },
  tr: {
    title: "Geometrik Nivelman Hesabı", intro: "BS / IS / FS mira okumalarından kot hesaplayın; yükseklik farkını, kapanmayı ve düzeltme dağıtımını kontrol edip rapor alın. Hesaplar tarayıcınızda çalışır.",
    back: "Araçlara dön", warning: "İnşaatta kullanmadan önce ölçü yöntemini, kot datumunu ve proje toleransını doğrulayın. Bu araç mira okumalı geometrik nivelmandır; total station trigonometrik yükseklik hesabı değildir.",
    language: "Dil", upload: "Nivelman CSV yükle", example: "Örnek CSV yükle",
    csvLabel: "Nivelman okumaları (CSV)", csvHint: "Sütunlar: setup, point, sight, reading_m, distance_m. Her alet kurulumunda önce BS, ardından isteğe bağlı IS ve en son FS olmalıdır. Sonraki BS, önceki FS dönüm noktasına yapılmalıdır.",
    project: "Proje / rapor adı", start: "Bilinen başlangıç kotu (m)", end: "Bilinen bitiş kotu (m, isteğe bağlı)", endHint: "Dayalı olmayan açık nivelman için boş bırakın. Son FS ile ilk BS aynı noktaysa başlangıç kotuyla kapalı devre kontrolü yapılır.",
    method: "Kapanma düzeltmesini dağıt", auto: "Otomatik: mesafeler tam ise mesafeye, değilse kurulum sayısına göre",
    distance: "BS+FS görüş mesafelerine göre", setups: "Her kuruluma eşit",
    tolerance: "Tolerans katsayısı (mm/√km)", toleranceHint: "Bu katsayı projeye özgüdür; evrensel standart değildir. Tolerans kontrolü için tüm BS ve FS görüş mesafeleri girilmelidir.",
    calculate: "Nivelmanı hesapla", result: "Nivelman sonuçları", point: "Nokta", setup: "Kurulum", sight: "Okuma", reading: "Mira (m)", distanceLabel: "Görüş mesafesi (m)", hi: "Alet ufku (m)", raw: "Düzeltilmemiş kot (m)", correction: "Düzeltme (m)", adjusted: "Düzeltilmiş kot (m)",
    stations: "Alet kurulumu", length: "Ölçülen hat uzunluğu", first: "Başlangıç röperi", last: "Bitiş röperi",
    closure: "Kot kapanma hatası", toleranceResult: "İzin verilen hata", sumBsFs: "Σ BS − Σ FS",
    status: "Tolerans sonucu", pass: "Tolerans içinde", fail: "Tolerans dışında", unverified: "Değerlendirilemedi",
    csv: "CSV raporu indir", pdf: "PDF raporu indir", error: "Hesaplama hatası", notes: "Hesap notları",
    noData: "Başlamak için CSV yükleyin veya ölçüleri yapıştırın.", methodDistance: "Mesafeye göre", methodSetups: "Kurulum sayısına göre",
  },
} as const

const inputClass = "mt-2 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300"
const card = "rounded-2xl border border-white/10 bg-white/5 p-5"
const label = "block text-xs font-medium uppercase tracking-wide text-slate-400"
const number = (value: number | null, digits = 4) => value === null ? "—" : value.toFixed(digits)

export default function GeometricLeveling() {
  const [language, setLanguage] = useState<"en" | "tr">("en")
  const t = copy[language]
  const [fileName, setFileName] = useState("")
  const [source, setSource] = useState("")
  const [project, setProject] = useState("Geometric levelling")
  const [startRL, setStartRL] = useState("100.000")
  const [endRL, setEndRL] = useState("")
  const [method, setMethod] = useState<LevelMethod>("auto")
  const [coefficient, setCoefficient] = useState("12")
  const [result, setResult] = useState<LevelResult | null>(null)
  const [error, setError] = useState("")
  const [exporting, setExporting] = useState(false)

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setSource(await file.text())
    setResult(null)
    setError("")
  }

  function calculate() {
    setError("")
    setResult(null)
    try {
      if (startRL.trim() === "" || !Number.isFinite(Number(startRL))) {
        throw new Error("Enter a valid starting benchmark RL.")
      }
      if (endRL.trim() !== "" && !Number.isFinite(Number(endRL))) {
        throw new Error("Enter a valid ending benchmark RL.")
      }
      if (coefficient.trim() === "" || !Number.isFinite(Number(coefficient))) {
        throw new Error("Enter a valid tolerance coefficient.")
      }
      setResult(calculateLeveling(parseLevelCsv(source), {
        startElevationM: Number(startRL),
        knownEndElevationM: endRL.trim() === "" ? null : Number(endRL),
        method, toleranceMmSqrtKm: Number(coefficient),
      }))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  function report(): SurveyReport {
    if (!result) throw new Error("Calculate the levelling line first.")
    const r = result
    const tag = r.withinTolerance === null ? t.unverified : r.withinTolerance ? t.pass : t.fail
    const columns = [t.setup, t.point, t.sight, t.reading, t.distanceLabel, t.hi, t.raw, t.correction, t.adjusted]
    return {
      title: t.title,
      project: project.trim() || "SurveyTool.io levelling",
      createdAt: new Date().toISOString(),
      metadata: [
        [t.first, r.startPoint + " / " + number(r.startElevationM, 4) + " m"],
        [t.last, r.endPoint + " / " + (r.knownEndElevationM === null ? t.unverified : number(r.knownEndElevationM, 4) + " m")],
        [t.method, r.methodUsed === "distance" ? t.methodDistance : t.methodSetups],
        [t.stations, r.legs.length],
      ],
      summary: [
        [t.length, r.totalDistanceM === null ? "Not measured" : number(r.totalDistanceM, 2) + " m"],
        [t.sumBsFs, number(r.sumBSM - r.sumFSM, 4) + " m"],
        [t.closure, r.misclosureM === null ? t.unverified : number(r.misclosureM * 1000, 2) + " mm"],
        [t.toleranceResult, r.toleranceMm === null ? t.unverified : number(r.toleranceMm, 2) + " mm"],
        [t.status, tag],
        [t.last + " (computed)", number(r.computedEndElevationM, 4) + " m"],
      ],
      columns,
      rows: r.rows.map((row) => [
        row.setup, row.point, row.sight, row.readingM, row.distanceM,
        row.heightOfInstrumentM, row.rawElevationM, row.correctionM, row.adjustedElevationM,
      ]),
      notes: [...r.notes, t.warning],
    }
  }

  function saveCsv() {
    if (!result) return
    downloadReportBlob(createReportCsv(report()), "text/csv;charset=utf-8", safeReportName(project) + "-levelling.csv")
  }

  async function savePdf() {
    if (!result || exporting) return
    setExporting(true)
    setError("")
    try {
      const pdf = await createReportPdf(report())
      downloadReportBlob(pdf, "application/pdf", safeReportName(project) + "-levelling.pdf")
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="relative z-10 mx-auto max-w-6xl px-6 py-12 text-slate-100">
      <PageSeo title="Geometric Levelling | SurveyTool.io" description="Geometric level reduction from BS, IS and FS staff readings, loop closure and PDF/CSV field reports." canonicalUrl="https://www.surveytool.io/tools/geometric-leveling" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={16} /> {t.back}</Link>
        <div className="inline-flex rounded-xl border border-white/10 p-1 text-sm">
          {(["en", "tr"] as const).map((code) => (
            <button key={code} type="button" onClick={() => setLanguage(code)} aria-pressed={language === code}
              className={"rounded-lg px-3 py-1 " + (language === code ? "bg-cyan-400/20 text-cyan-100" : "text-slate-400 hover:text-white")}>
              {code === "en" ? "English" : "Türkçe"}
            </button>
          ))}
        </div>
      </div>
      <header className="mt-8 flex items-start gap-4">
        <Ruler size={28} className="mt-1 text-cyan-300" />
        <div>
          <h1 className="text-3xl font-semibold">{t.title}</h1>
          <p className="mt-2 max-w-3xl text-slate-300">{t.intro}</p>
          <p className="mt-3 rounded-xl border border-orange-300/30 bg-orange-300/10 px-4 py-3 text-sm text-orange-100">{t.warning}</p>
        </div>
      </header>
      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className={card}>
          <h2 className="text-lg font-semibold">{t.csvLabel}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-sm hover:border-cyan-300">
              <Upload size={16} /> {fileName || t.upload}
              <input type="file" accept=".csv,.txt" className="sr-only" onChange={(event) => { void onFile(event) }} />
            </label>
            <button type="button" onClick={() => { setSource(example); setFileName("levelling-example.csv"); setStartRL("100.000"); setEndRL("100.543"); setResult(null); setError("") }}
              className="rounded-xl border border-white/15 px-3 py-2 text-sm hover:border-cyan-300">{t.example}</button>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">{t.csvHint}</p>
          <textarea value={source} onChange={(event) => { setSource(event.target.value); setResult(null) }} rows={11} spellCheck={false}
            placeholder="setup,point,sight,reading_m,distance_m" className={inputClass + " font-mono text-xs"} aria-label={t.csvLabel} />
        </div>
        <div className={card}>
          <div>
            <label className={label}>{t.project}</label>
            <input value={project} onChange={(event) => setProject(event.target.value)} className={inputClass} />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div><label className={label}>{t.start}</label>
              <input type="number" step="0.001" value={startRL} onChange={(event) => { setStartRL(event.target.value); setResult(null) }} className={inputClass} /></div>
            <div><label className={label}>{t.end}</label>
              <input type="number" step="0.001" value={endRL} onChange={(event) => { setEndRL(event.target.value); setResult(null) }} className={inputClass} /></div>
          </div>
          <p className="mt-2 text-xs text-slate-400">{t.endHint}</p>
          <label className={label + " mt-5"}>{t.method}</label>
          <select value={method} onChange={(event) => { setMethod(event.target.value as LevelMethod); setResult(null) }} className={inputClass}>
            <option value="auto">{t.auto}</option><option value="distance">{t.distance}</option><option value="setups">{t.setups}</option>
          </select>
          <div className="mt-5"><label className={label}>{t.tolerance}</label>
            <input type="number" min="0.01" step="0.5" value={coefficient} onChange={(event) => { setCoefficient(event.target.value); setResult(null) }} className={inputClass} /></div>
          <p className="mt-2 text-xs leading-5 text-slate-400">{t.toleranceHint}</p>
          <button type="button" onClick={calculate} className="mt-6 w-full rounded-xl bg-cyan-400 px-6 py-3 font-semibold text-slate-950 hover:bg-cyan-300">{t.calculate}</button>
        </div>
      </section>
      {error && <div role="alert" className="mt-6 rounded-xl border border-rose-400/40 bg-rose-400/10 p-4 text-sm text-rose-100"><strong>{t.error}</strong><p className="mt-2">{error}</p></div>}
      {result && (
        <section className="mt-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">{t.result}</h2>
            <div className="flex gap-2">
              <button type="button" onClick={saveCsv} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm hover:border-cyan-300"><Download size={16} /> {t.csv}</button>
              <button type="button" onClick={() => { void savePdf() }} disabled={exporting} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm hover:border-cyan-300 disabled:opacity-40"><FileText size={16} /> {t.pdf}</button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [t.stations, String(result.legs.length)],
              [t.closure, result.misclosureM === null ? "—" : number(result.misclosureM * 1000, 2) + " mm"],
              [t.toleranceResult, result.toleranceMm === null ? "—" : number(result.toleranceMm, 2) + " mm"],
              [t.status, result.withinTolerance === null ? t.unverified : result.withinTolerance ? t.pass : t.fail],
            ].map(([key, value]) => (
              <div key={key} className={card}><p className="text-xs uppercase tracking-wide text-slate-400">{key}</p><p className="mt-2 text-xl font-semibold">{value}</p></div>
            ))}
          </div>
          <div className={card}>
            <p className="text-sm text-slate-300">{t.first}: <strong>{result.startPoint}</strong> / {number(result.startElevationM)} m</p>
            <p className="mt-1 text-sm text-slate-300">{t.last}: <strong>{result.endPoint}</strong> / {number(result.computedEndElevationM)} m ({t.raw})</p>
            <p className="mt-1 text-sm text-slate-300">{t.length}: {result.totalDistanceM === null ? "—" : number(result.totalDistanceM, 2) + " m"} · {t.sumBsFs}: {number(result.sumBSM - result.sumFSM)} m</p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="text-slate-400"><tr>{[t.setup, t.point, t.sight, t.reading, t.distanceLabel, t.hi, t.raw, t.correction, t.adjusted].map((name) => <th key={name} className="whitespace-nowrap px-2 py-2">{name}</th>)}</tr></thead>
                <tbody>{result.rows.map((row, index) => (
                  <tr key={row.setup + "-" + index} className="border-t border-white/5">
                    <td className="px-2 py-2 font-mono">{row.setup}</td><td className="px-2 py-2 font-mono">{row.point}</td><td className="px-2 py-2">{row.sight}</td>
                    <td className="px-2 py-2 font-mono">{number(row.readingM, 3)}</td>
                    <td className="px-2 py-2 font-mono">{number(row.distanceM, 2)}</td>
                    <td className="px-2 py-2 font-mono">{number(row.heightOfInstrumentM)}</td>
                    <td className="px-2 py-2 font-mono">{number(row.rawElevationM)}</td>
                    <td className="px-2 py-2 font-mono">{number(row.correctionM, 5)}</td>
                    <td className="px-2 py-2 font-mono">{number(row.adjustedElevationM)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          <div className={card}><h3 className="font-semibold">{t.notes}</h3>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-300">{result.notes.map((note) => <li key={note}>{note}</li>)}</ul>
          </div>
        </section>
      )}
    </div>
  )
}
