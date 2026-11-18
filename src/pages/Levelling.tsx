import { useState } from "react";
import type { ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Upload, Ruler } from "lucide-react";

import PageSeo from "../components/PageSeo";
import ReportDownloads from "../components/ReportDownloads";
import type { SurveyReport } from "../lib/surveyReports";
import { adjustLevelling, parseLevellingCsv } from "../lib/levelling";
import type { LevellingMethod, LevellingResult, LevelLeg } from "../lib/levelling";
import { trackToolAction } from "../lib/toolUsage";

type EditableLeg = { to: string; backsight: string; foresight: string; setups: string; distance: string };
const emptyLeg = (): EditableLeg => ({ to: "", backsight: "", foresight: "", setups: "1", distance: "" });
const inputStyle = "w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300 focus:outline-none";
const cardStyle = "rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6";

const translations = {
  en: {
    back: "Back to tools", title: "Levelling adjustment", intro: "Calculate a level run from backsight and foresight readings. Distribute the closing error by setup count or route distance, then review each adjusted elevation.",
    note: "Use metres and one common vertical datum throughout. This is a proportional closure adjustment, not a least-squares network solution. Check field notes and control heights before using the results.",
    control: "Known benchmarks", start: "Start point", end: "End point", startH: "Start elevation (m)", endH: "Known end elevation (m)", tolerance: "Optional closure limit (mm)", toleranceHint: "Leave blank to show the closure without a pass/fail decision. Enter a project-specific limit if needed.",
    method: "Distribute closing error by", setups: "Setup count", setupsHint: "Correction to each section is proportional to its number of instrument setups.", distance: "Route distance", distanceHint: "Correction to each section is proportional to its measured route length.",
    measurements: "Levelling sections", measurementHint: "Each row runs from the previous point to the destination. Enter BS and FS in metres; a section can summarise several setups with summed readings.", file: "Import CSV / TXT", fileHint: "Columns: to,bs,fs,setups,distance. Header optional; comma, semicolon or tab separated. Setups defaults to 1; distance may be blank in setup mode.",
    from: "From", to: "To", bs: "BS (m)", fs: "FS (m)", count: "Setups", length: "Distance (m)", add: "Add section", example: "Load example", calculate: "Calculate adjustment", error: "Check the inputs", summary: "Closure and control", measuredEnd: "Observed end elevation", knownEnd: "Known end elevation", misclosure: "Closing error", correction: "Total correction", totalSetups: "Total setups", totalDistance: "Total route distance", toleranceResult: "Closure limit", pass: "Within limit", fail: "Outside limit", notSet: "Not set", result: "Adjusted sections", rawRise: "Observed ΔH (m)", segmentCorrection: "Correction (mm)", adjustedRise: "Adjusted ΔH (m)", rawH: "Raw elevation (m)", adjustedH: "Adjusted elevation (m)", endCheck: "Adjusted end elevation", compare: "The final adjusted elevation must match the known end elevation.",
  },
  tr: {
    back: "Araçlara dön", title: "Nivelman hesabı", intro: "Geri ve ileri okumalardan nivelman hattını hesaplayın. Kapanma hatasını oturum sayısına veya hat mesafesine göre dağıtın ve dengelenmiş kotları inceleyin.",
    note: "Tüm okuma ve kotlar metre ve aynı düşey datumda olmalıdır. Bu hesap kapanma hatasını orantılı dağıtır; çok kollu ağın en küçük kareler çözümü değildir. Sonuçları saha notları ve bilinen kotlarla kontrol edin.",
    control: "Bilinen röperler", start: "Başlangıç noktası", end: "Bitiş noktası", startH: "Başlangıç kotu (m)", endH: "Bilinen bitiş kotu (m)", tolerance: "İsteğe bağlı kapanma sınırı (mm)", toleranceHint: "Boş bırakırsanız kapanma gösterilir, uygunluk kararı verilmez. Projeye ait sınırı girebilirsiniz.",
    method: "Kapanma hatasını dağıt", setups: "Oturum sayısına göre", setupsHint: "Her bölüme verilen düzeltme, o bölümün alet kurulum sayısıyla orantılıdır.", distance: "Mesafeye göre", distanceHint: "Her bölüme verilen düzeltme, ölçülen hat uzunluğuyla orantılıdır.",
    measurements: "Nivelman bölümleri", measurementHint: "Her satır önceki noktadan hedef noktaya gider. Geri ve ileri okumaları metre olarak girin; bir bölüm birden çok oturumun okuma toplamlarını içerebilir.", file: "CSV / TXT içe aktar", fileHint: "Sütunlar: to,bs,fs,setups,distance. Başlık isteğe bağlı; virgül, noktalı virgül veya sekme ayraçlı. Oturum varsayılan 1; oturuma göre hesapta mesafe boş kalabilir.",
    from: "Başlangıç", to: "Bitiş", bs: "Geri (m)", fs: "İleri (m)", count: "Oturum", length: "Mesafe (m)", add: "Bölüm ekle", example: "Örneği yükle", calculate: "Nivelmanı hesapla", error: "Girişleri kontrol edin", summary: "Kapanma ve kontrol", measuredEnd: "Ölçülen bitiş kotu", knownEnd: "Bilinen bitiş kotu", misclosure: "Kapanma hatası", correction: "Toplam düzeltme", totalSetups: "Toplam oturum", totalDistance: "Toplam hat uzunluğu", toleranceResult: "Kapanma sınırı", pass: "Sınır içinde", fail: "Sınır dışında", notSet: "Girilmedi", result: "Dengelenmiş bölümler", rawRise: "Ölçülen ΔH (m)", segmentCorrection: "Düzeltme (mm)", adjustedRise: "Dengelenmiş ΔH (m)", rawH: "Ham kot (m)", adjustedH: "Dengelenmiş kot (m)", endCheck: "Dengelenmiş bitiş kotu", compare: "Son dengelenmiş kot, bilinen bitiş kotuna eşit olmalıdır.",
  },
} as const;

function requiredNumber(value: string) { return value.trim() ? Number(value) : NaN; }
function format(value: number, decimals = 4) { return value.toFixed(decimals); }

function makeReport(result: LevellingResult, details: {
  start: string; end: string; startElevation: number; endElevation: number; method: LevellingMethod; tolerance: number | null;
}): SurveyReport {
  return {
    title: "Levelling adjustment", project: `${details.start} → ${details.end}`, createdAt: new Date().toISOString(),
    metadata: [["Distribution", details.method === "setups" ? "Setup count" : "Route distance"], ["Start elevation (m)", details.startElevation], ["Known end elevation (m)", details.endElevation], ["Closure limit (mm)", details.tolerance]],
    summary: [["Observed end elevation (m)", result.observedEnd], ["Closing error (mm)", result.misclosure * 1000], ["Total setups", result.totalSetups], ["Total distance (m)", result.totalDistance], ["Within closure limit", result.withinTolerance === null ? "Not assessed" : result.withinTolerance ? "Yes" : "No"]],
    columns: ["From", "To", "BS (m)", "FS (m)", "Setups", "Distance (m)", "Observed rise (m)", "Correction (mm)", "Adjusted rise (m)", "Raw elevation (m)", "Adjusted elevation (m)"],
    rows: result.legs.map((leg) => [leg.from, leg.to, leg.backsight, leg.foresight, leg.setups, leg.distance, leg.observedRise, leg.correction * 1000, leg.adjustedRise, leg.rawElevation, leg.adjustedElevation]),
    notes: ["All heights and readings are in metres and must share one vertical datum.", "Closing error = observed end elevation − known end elevation. Section correction = −closing error × section weight / total weight.", "This is a proportional closure adjustment, not a least-squares network solution."],
  };
}

export default function Levelling() {
  const [language, setLanguage] = useState<"en" | "tr">(() => navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en");
  const t = translations[language];
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [startH, setStartH] = useState("");
  const [endH, setEndH] = useState("");
  const [method, setMethod] = useState<LevellingMethod>("setups");
  const [tolerance, setTolerance] = useState("");
  const [legs, setLegs] = useState<EditableLeg[]>([emptyLeg()]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<LevellingResult | null>(null);
  const [report, setReport] = useState<SurveyReport | null>(null);
  const [error, setError] = useState("");

  function invalidate() { setResult(null); setReport(null); setError(""); }
  function updateLeg(index: number, field: keyof EditableLeg, value: string) {
    setLegs((current) => current.map((leg, i) => i === index ? { ...leg, [field]: value } : leg));
    invalidate();
  }
  function loadExample() {
    setStart("BM1"); setEnd("BM2"); setStartH("100.000"); setEndH("100.500");
    setLegs([
      { to: "TP1", backsight: "1.255", foresight: "1.005", setups: "1", distance: "120" },
      { to: "BM2", backsight: "1.380", foresight: "1.125", setups: "2", distance: "180" },
    ]);
    setFileName(""); setMethod("setups"); setTolerance(""); invalidate();
  }
  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    invalidate();
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("The file must be smaller than 2 MB.");
      const parsed = parseLevellingCsv(await file.text());
      setLegs(parsed.map((leg: LevelLeg) => ({ to: leg.to, backsight: String(leg.backsight), foresight: String(leg.foresight), setups: String(leg.setups), distance: leg.distance == null ? "" : String(leg.distance) })));
      setFileName(file.name);
      trackToolAction("levelling", "import_complete", { source: "upload", format: file.name.toLowerCase().endsWith(".csv") ? "csv" : "txt" });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not read the file."); }
  }
  function calculate() {
    invalidate();
    try {
      const details = { start: start.trim(), end: end.trim(), startElevation: requiredNumber(startH), endElevation: requiredNumber(endH), method, tolerance: tolerance.trim() ? Number(tolerance) : null };
      const adjusted = adjustLevelling({ ...details, toleranceMm: details.tolerance, legs: legs.map((leg) => ({ to: leg.to, backsight: requiredNumber(leg.backsight), foresight: requiredNumber(leg.foresight), setups: requiredNumber(leg.setups), distance: leg.distance.trim() ? Number(leg.distance) : null })) });
      setResult(adjusted);
      setReport(makeReport(adjusted, details));
      trackToolAction("levelling", "calculate_complete");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not calculate levelling."); }
  }

  return (
    <div className="relative z-10 mx-auto max-w-7xl px-4 py-10 text-slate-100 sm:px-6">
      <PageSeo title="Levelling Adjustment | SurveyTool" description="Calculate differential levelling closure and adjusted elevations by setup count or measured route distance." canonicalUrl="https://www.surveytool.io/tools/levelling" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link to="/#tools" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={16} /> {t.back}</Link>
        <div className="inline-flex rounded-xl border border-white/10 p-1 text-sm">
          {(["en", "tr"] as const).map((code) => <button type="button" key={code} aria-pressed={language === code} onClick={() => setLanguage(code)} className={`rounded-lg px-3 py-1 ${language === code ? "bg-cyan-400/20 text-cyan-100" : "text-slate-400 hover:text-white"}`}>{code === "en" ? "English" : "Türkçe"}</button>)}
        </div>
      </div>
      <header className="mt-8 flex items-start gap-4">
        <Ruler className="mt-1 shrink-0 text-cyan-300" size={30} />
        <div><h1 className="text-3xl font-semibold">{t.title}</h1><p className="mt-2 max-w-3xl text-slate-300">{t.intro}</p><p className="mt-3 max-w-4xl rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">{t.note}</p></div>
      </header>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className={cardStyle}>
          <h2 className="text-lg font-semibold">{t.control}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {([[t.start, start, setStart], [t.startH, startH, setStartH], [t.end, end, setEnd], [t.endH, endH, setEndH]] as const).map(([label, value, setter], i) => <label key={label} className="block text-sm text-slate-300">{label}<input className={`${inputStyle} mt-2`} type={i % 2 ? "number" : "text"} step={i % 2 ? "any" : undefined} value={value} onChange={(event) => { setter(event.target.value); invalidate(); }} placeholder={i % 2 ? "100.000" : i < 2 ? "BM1" : "BM2"} /></label>)}
          </div>
          <label className="mt-4 block text-sm text-slate-300">{t.tolerance}<input type="number" min="0" step="any" value={tolerance} onChange={(event) => { setTolerance(event.target.value); invalidate(); }} className={`${inputStyle} mt-2 max-w-xs`} placeholder="e.g. 10" /></label>
          <p className="mt-2 text-xs text-slate-400">{t.toleranceHint}</p>
        </div>
        <div className={cardStyle}>
          <h2 className="text-lg font-semibold">{t.method}</h2>
          <div className="mt-4 space-y-3">
            {(["setups", "distance"] as const).map((option) => <label key={option} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${method === option ? "border-cyan-300/50 bg-cyan-300/10" : "border-white/10 hover:border-white/30"}`}><input type="radio" name="levelling-method" value={option} checked={method === option} onChange={() => { setMethod(option); invalidate(); }} className="mt-1 accent-cyan-400" /><span><strong className="block text-sm">{t[option]}</strong><span className="mt-1 block text-xs text-slate-400">{option === "setups" ? t.setupsHint : t.distanceHint}</span></span></label>)}
          </div>
        </div>
      </section>

      <section className={`${cardStyle} mt-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">{t.measurements}</h2><p className="mt-1 max-w-3xl text-sm text-slate-400">{t.measurementHint}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={loadExample} className="rounded-xl border border-white/20 px-3 py-2 text-sm hover:border-cyan-300/50">{t.example}</button><label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 px-3 py-2 text-sm hover:border-cyan-300/50"><Upload size={15}/>{t.file}<input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(event) => void onFile(event)}/></label></div></div>
        <p className="mt-3 text-xs text-slate-400">{t.fileHint}{fileName && ` · ${fileName}`}</p>
        <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[760px] border-separate border-spacing-y-2 text-left text-sm"><thead><tr className="text-xs text-slate-400">{[t.from, t.to, t.bs, t.fs, t.count, t.length, ""].map((heading, index) => <th scope="col" key={index} className="px-2 font-medium">{heading}</th>)}</tr></thead><tbody>{legs.map((leg, index) => <tr key={index}><td className="px-2 text-slate-300">{index ? legs[index - 1].to || "—" : start || "—"}</td>{(["to", "backsight", "foresight", "setups", "distance"] as const).map((field) => <td key={field} className="px-1"><input aria-label={`${[t.to, t.bs, t.fs, t.count, t.length][["to", "backsight", "foresight", "setups", "distance"].indexOf(field)]} ${index + 1}`} className={`${inputStyle} min-w-24`} type={field === "to" ? "text" : "number"} step={field === "setups" ? "1" : "any"} min={field === "setups" ? "1" : field === "distance" ? "0" : undefined} value={leg[field]} onChange={(event) => updateLeg(index, field, event.target.value)} placeholder={field === "to" ? "TP / BM" : field === "distance" ? "—" : "0.000"}/></td>)}<td className="px-1"><button type="button" aria-label={`Remove section ${index + 1}`} disabled={legs.length === 1} onClick={() => { setLegs((current) => current.filter((_, i) => i !== index)); invalidate(); }} className="rounded-lg p-2 text-slate-400 hover:bg-rose-300/10 hover:text-rose-200 disabled:opacity-30"><Trash2 size={17}/></button></td></tr>)}</tbody></table></div>
        <button type="button" onClick={() => { setLegs((current) => [...current, emptyLeg()]); invalidate(); }} className="mt-2 inline-flex items-center gap-2 rounded-xl border border-cyan-300/30 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-300/10"><Plus size={16}/>{t.add}</button>
      </section>

      <button type="button" onClick={calculate} className="mt-6 rounded-xl bg-cyan-400 px-6 py-3 font-semibold text-slate-950 hover:bg-cyan-300">{t.calculate}</button>
      {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/40 bg-rose-300/10 p-4 text-sm text-rose-100"><strong>{t.error}:</strong> {error}</p>}
      {result && <div className="mt-8 space-y-6" aria-live="polite">
        <section className={cardStyle}><h2 className="text-xl font-semibold">{t.summary}</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[[t.measuredEnd, `${format(result.observedEnd)} m`], [t.knownEnd, `${format(Number(endH))} m`], [t.misclosure, `${format(result.misclosure * 1000, 2)} mm`], [t.correction, `${format(-result.misclosure * 1000, 2)} mm`], [t.totalSetups, String(result.totalSetups)], [t.totalDistance, result.totalDistance == null ? "—" : `${format(result.totalDistance, 2)} m`], [t.toleranceResult, result.withinTolerance == null ? t.notSet : `${result.withinTolerance ? t.pass : t.fail} (±${tolerance} mm)`], [t.endCheck, `${format(result.legs.at(-1)!.adjustedElevation)} m`]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-slate-900/60 p-3"><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 font-mono text-lg text-cyan-100">{value}</dd></div>)}</dl><p className="mt-4 text-xs text-slate-400">{t.compare}</p></section>
        <section className={cardStyle}><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{t.result}</h2><ReportDownloads report={report} formats={["pdf", "csv"]}/></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead><tr className="border-b border-white/20 text-xs text-slate-400">{[t.from, t.to, t.bs, t.fs, t.count, t.length, t.rawRise, t.segmentCorrection, t.adjustedRise, t.rawH, t.adjustedH].map((heading) => <th scope="col" key={heading} className="px-3 py-3 font-medium">{heading}</th>)}</tr></thead><tbody>{result.legs.map((leg, index) => <tr key={index} className="border-b border-white/10"><td className="px-3 py-3">{leg.from}</td><td className="px-3 py-3 font-semibold">{leg.to}</td><td className="px-3 py-3 font-mono">{format(leg.backsight)}</td><td className="px-3 py-3 font-mono">{format(leg.foresight)}</td><td className="px-3 py-3">{leg.setups}</td><td className="px-3 py-3">{leg.distance == null ? "—" : format(leg.distance, 2)}</td><td className="px-3 py-3 font-mono">{format(leg.observedRise)}</td><td className="px-3 py-3 font-mono">{format(leg.correction * 1000, 2)}</td><td className="px-3 py-3 font-mono">{format(leg.adjustedRise)}</td><td className="px-3 py-3 font-mono">{format(leg.rawElevation)}</td><td className="px-3 py-3 font-mono text-cyan-200">{format(leg.adjustedElevation)}</td></tr>)}</tbody></table></div></section>
      </div>}
    </div>
  );
}
