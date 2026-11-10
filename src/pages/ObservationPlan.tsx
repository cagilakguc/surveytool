import { useMemo, useState } from "react"
import type { ChangeEvent, ReactElement } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, MapPin, Upload } from "lucide-react"

import PageSeo from "../components/PageSeo"
import { parseObservationCsv } from "../lib/observationCsv"
import { parseJobXmlObservations } from "../lib/jobXmlObservations"
import type { JobObservation, ObservationData, PlanSetup } from "../lib/observationModel"
import { buildTraverseChain } from "../lib/traverseChain"
import type { ChainLink, TraverseChain } from "../lib/traverseChain"

type Language = "en" | "tr"

const copy = {
  en: {
    back: "Back to tools",
    title: "Observation Plan",
    intro:
      "Plan view of a total-station job from an all-observations CSV export. Each line runs from the setup to the observed point, using the coordinates the controller held when the observation was made, before any adjustment.",
    upload: "All-observations CSV file",
    loaded: "Loaded",
    includeDeleted: "Include deleted observations",
    setups: "Setups",
    noSetupLive: "no live observations",
    liveCount: "live",
    pairs: "Setup to point pairs",
    details: "Observations for selected pair",
    select: "Click a line or a row to see its observations.",
    time: "Time",
    face: "Face",
    hz: "Hz (deg)",
    v: "V (deg)",
    sd: "SD (m)",
    code: "Point code",
    classification: "Type",
    deleted: "Deleted",
    yes: "Yes",
    no: "No",
    rows: "Rows",
    deletedRows: "Deleted rows",
    meanRows: "Mean-angle rows left out",
    observations: "Observations",
    warnings: "Warnings",
    noData: "Load a CSV file to draw the plan.",
    setup: "Setup",
    target: "Point",
    count: "Count",
    codes: "Codes",
    legendSetup: "Setup",
    legendTarget: "Observed point",
    planView: "Plan",
    setupView: "By setup",
    chainView: "Chain",
    chainTitle: "Traverse chain",
    chainClosed: "Closed",
    chainOpen: "Open",
    chainBacksight: "Backsight",
    chainLink: "Link",
    chainKnown: "Known",
    chainChained: "Chained",
    chainBreak: "Break",
    chainNone: "No backsight",
    chainKnownPoints: "Known points (observed from first station)",
    chainOccupations: "Occupations",
    chainNoWarnings: "No chain warnings.",
    chainNoData: "No setups with observations to chain.",
    instrumentHeight: "Instrument height (m)",
    targetHeight: "Target height (m)",
    mean: "Mean",
    noRows: "No observations for this setup.",
    fileTypes: "Accepts Trimble all-observations CSV or JobXML (.jxl) field book.",
    disclaimer:
      "Coordinates are not adjusted. Results are for checking only and must be reviewed by a qualified surveyor.",
    error: "Could not read the file",
  },
  tr: {
    back: "Araçlara dön",
    title: "Gözlem Planı",
    intro:
      "Tüm gözlemler CSV dosyasından total station işinin plan görünümü. Her çizgi kurulumdan gözlenen noktaya uzanır ve kontrolcünün gözlem anında tuttuğu koordinatları kullanır. Dengeleme yapılmamıştır.",
    upload: "Tüm gözlemler CSV dosyası",
    loaded: "Yüklendi",
    includeDeleted: "Silinmiş gözlemleri dahil et",
    setups: "Kurulumlar",
    noSetupLive: "geçerli gözlem yok",
    liveCount: "geçerli",
    pairs: "Kurulum–nokta çiftleri",
    details: "Seçilen çiftin gözlemleri",
    select: "Bir çizgiye veya satıra tıklayarak gözlemleri görün.",
    time: "Zaman",
    face: "Yüz",
    hz: "Yatay açı (gr/derece)",
    v: "Düşey açı (derece)",
    sd: "Eğik mesafe (m)",
    code: "Nokta kodu",
    classification: "Tür",
    deleted: "Silinmiş",
    yes: "Evet",
    no: "Hayır",
    rows: "Satır",
    deletedRows: "Silinmiş satır",
    meanRows: "Dışarıda bırakılan ortalama satırları",
    observations: "Gözlem",
    warnings: "Uyarılar",
    noData: "Planı çizmek için bir CSV dosyası yükleyin.",
    setup: "Kurulum",
    target: "Nokta",
    count: "Adet",
    codes: "Kodlar",
    legendSetup: "Kurulum",
    legendTarget: "Gözlenen nokta",
    planView: "Plan",
    setupView: "Kuruluma göre",
    chainView: "Zincir",
    chainTitle: "Poligon zinciri",
    chainClosed: "Kapalı",
    chainOpen: "Açık",
    chainBacksight: "Geri nişan",
    chainLink: "Bağlantı",
    chainKnown: "Bilinen",
    chainChained: "Bağlı",
    chainBreak: "Kopuk",
    chainNone: "Geri nişan yok",
    chainKnownPoints: "Bilinen noktalar (ilk kurulumdan gözlenen)",
    chainOccupations: "Kurulumlar",
    chainNoWarnings: "Zincir uyarısı yok.",
    chainNoData: "Zincirlenecek gözlemli kurulum yok.",
    instrumentHeight: "Alet yüksekliği (m)",
    targetHeight: "Hedef yüksekliği (m)",
    mean: "Ortalama",
    noRows: "Bu kurulum için gözlem yok.",
    fileTypes: "Trimble tüm gözlemler CSV'si veya JobXML (.jxl) dosyası kabul edilir.",
    disclaimer:
      "Koordinatlar dengelenmemiştir. Sonuçlar yalnızca kontrol amaçlıdır ve yetkili bir surveyor tarafından incelenmelidir.",
    error: "Dosya okunamadı",
  },
} as const

type Copy = Record<keyof (typeof copy)["en"], string>

const PALETTE = ["#22d3ee", "#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#60a5fa", "#fb7185", "#facc15"]

type Pair = {
  key: string
  setup: PlanSetup
  color: string
  target: string
  easting: number
  northing: number
  observations: JobObservation[]
}

const LINK_TONE: Record<ChainLink, string> = {
  known: "bg-slate-500/20 text-slate-200",
  chain: "bg-emerald-400/15 text-emerald-200",
  break: "bg-rose-400/15 text-rose-200",
  none: "bg-amber-400/15 text-amber-200",
}

function ChainView({ data, includeDeleted, t, card }: { data: ObservationData; includeDeleted: boolean; t: Copy; card: string }) {
  const chain: TraverseChain = useMemo(() => buildTraverseChain(data, { includeDeleted }), [data, includeDeleted])
  const linkLabel: Record<ChainLink, string> = {
    known: t.chainKnown,
    chain: t.chainChained,
    break: t.chainBreak,
    none: t.chainNone,
  }

  if (chain.stations.length === 0) {
    return <p className="mt-8 text-center text-slate-400">{t.chainNoData}</p>
  }

  return (
    <div className="mt-8 space-y-6">
      <section className={card}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{t.chainTitle}</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${chain.closed ? "bg-emerald-400/15 text-emerald-200" : "bg-slate-500/20 text-slate-200"}`}
          >
            {chain.closed ? t.chainClosed : t.chainOpen}
          </span>
        </div>
        <ol className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          {chain.stations.map((station, index) => (
            <li key={`${station.name}-${index}`} className="flex items-center gap-2">
              <span className="rounded-lg border border-white/10 px-3 py-1 font-mono">{station.name}</span>
              {index < chain.stations.length - 1 && <span className="text-slate-500">→</span>}
            </li>
          ))}
        </ol>
      </section>

      <section className={card}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-400">
              <tr>
                <th className="py-2 pr-4">{t.setup}</th>
                <th className="py-2 pr-4">{t.chainBacksight}</th>
                <th className="py-2 pr-4">{t.chainLink}</th>
                <th className="py-2 pr-4">{t.chainOccupations}</th>
                <th className="py-2 pr-4">{t.observations}</th>
              </tr>
            </thead>
            <tbody>
              {chain.stations.map((station, index) => (
                <tr key={`${station.name}-${index}`} className="border-t border-white/5 align-top">
                  <td className="py-2 pr-4 font-mono">{station.name}</td>
                  <td className="py-2 pr-4 font-mono">{station.backsight ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${LINK_TONE[station.link]}`}>{linkLabel[station.link]}</span>
                  </td>
                  <td className="py-2 pr-4 text-slate-300">
                    {station.occupations.map((o) => (
                      <div key={o.recordId}>
                        {o.label} · {o.backsight ?? "—"}
                      </div>
                    ))}
                  </td>
                  <td className="py-2 pr-4 text-slate-300">
                    {station.occupations.reduce((sum, o) => sum + o.observationCount, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {chain.knownPoints.length > 0 && (
        <section className={card}>
          <h3 className="text-sm font-semibold">{t.chainKnownPoints}</h3>
          <p className="mt-2 font-mono text-sm text-slate-300">{chain.knownPoints.join(", ")}</p>
        </section>
      )}

      <section className={card}>
        <h3 className="text-sm font-semibold">{t.warnings}</h3>
        {chain.warnings.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">{t.chainNoWarnings}</p>
        ) : (
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-200">
            {chain.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SetupsView({ data, includeDeleted, t, card }: { data: ObservationData; includeDeleted: boolean; t: Copy; card: string }) {
  return (
    <div className="mt-8 space-y-6">
      {data.setups.map((setup) => {
        const rows = data.observations
          .filter((o) => o.setupRecordId === setup.recordId && (includeDeleted || !o.deleted))
          .sort((a, b) => a.target.localeCompare(b.target) || (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
        const means = data.means.filter((m) => m.setupRecordId === setup.recordId && (includeDeleted || !m.deleted))
        return (
          <section key={setup.recordId} className={card}>
            <h2 className="text-lg font-semibold">{setup.label}</h2>
            <p className="mt-1 text-xs text-slate-400">
              {t.time}: {setup.timestamp.replace("T", " ")} · {t.instrumentHeight}: {Number.isFinite(setup.instrumentHeightM) ? setup.instrumentHeightM.toFixed(3) : "—"} · {t.observations}: {setup.observationCount}
            </p>
            {rows.length === 0 && means.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">{t.noRows}</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="uppercase tracking-wide text-slate-400">
                    <tr>
                      {[t.target, t.code, t.time, t.face, t.hz, t.v, t.sd, t.targetHeight, t.classification, t.deleted].map((h) => (
                        <th key={h} className="whitespace-nowrap py-2 pr-4 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => (
                      <tr key={`${o.observationNumber}-${o.timestamp}-${o.face}`} className={`border-t border-white/5 ${o.deleted ? "text-slate-500 line-through" : "text-slate-300"}`}>
                        <td className="py-1.5 pr-4 font-mono">{o.target}</td>
                        <td className="py-1.5 pr-4">{o.pointCode}</td>
                        <td className="py-1.5 pr-4 font-mono">{o.timestamp.replace("T", " ")}</td>
                        <td className="py-1.5 pr-4">{o.face}</td>
                        <td className="py-1.5 pr-4 font-mono">{o.hzDeg.toFixed(6)}</td>
                        <td className="py-1.5 pr-4 font-mono">{o.vDeg.toFixed(6)}</td>
                        <td className="py-1.5 pr-4 font-mono">{o.slopeM.toFixed(4)}</td>
                        <td className="py-1.5 pr-4 font-mono">{Number.isFinite(o.targetHeightM) ? o.targetHeightM.toFixed(3) : "—"}</td>
                        <td className="py-1.5 pr-4">{o.classification}</td>
                        <td className="py-1.5 pr-4">{o.deleted ? t.yes : t.no}</td>
                      </tr>
                    ))}
                    {means.map((m) => (
                      <tr key={`mean-${m.target}-${m.timestamp}`} className="border-t border-white/5 italic text-cyan-200">
                        <td className="py-1.5 pr-4 font-mono">{m.target}</td>
                        <td className="py-1.5 pr-4">{m.pointCode}</td>
                        <td className="py-1.5 pr-4 font-mono">{m.timestamp.replace("T", " ")}</td>
                        <td className="py-1.5 pr-4">{t.mean} ({m.count})</td>
                        <td className="py-1.5 pr-4 font-mono">{m.hzDeg.toFixed(6)}</td>
                        <td className="py-1.5 pr-4 font-mono">{m.vDeg.toFixed(6)}</td>
                        <td className="py-1.5 pr-4 font-mono">{m.slopeM.toFixed(4)}</td>
                        <td className="py-1.5 pr-4" />
                        <td className="py-1.5 pr-4">MTA</td>
                        <td className="py-1.5 pr-4">{m.deleted ? t.yes : t.no}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

export default function ObservationPlan() {
  const [language, setLanguage] = useState<Language>("en")
  const t: Copy = copy[language]

  const [data, setData] = useState<ObservationData | null>(null)
  const [fileName, setFileName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [hiddenSetups, setHiddenSetups] = useState<Set<string>>(new Set())
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"plan" | "setups" | "chain">("plan")

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    setSelectedKey(null)
    setHiddenSetups(new Set())
    setFileName(file.name)
    try {
      const text = await file.text()
      const isJobXml = /\.jxl$|\.xml$/i.test(file.name) || /^\s*(<\?xml[\s\S]*?\?>\s*)?<JOBFile/.test(text.slice(0, 400))
      setData(isJobXml ? parseJobXmlObservations(text) : parseObservationCsv(text))
    } catch (failure) {
      setData(null)
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const setupColor = useMemo(() => {
    const colors = new Map<string, string>()
    data?.setups.forEach((setup, index) => colors.set(setup.recordId, PALETTE[index % PALETTE.length]))
    return colors
  }, [data])

  const pairs = useMemo<Pair[]>(() => {
    if (!data) return []
    const setupById = new Map(data.setups.map((setup) => [setup.recordId, setup]))
    const groups = new Map<string, JobObservation[]>()
    for (const observation of data.observations) {
      if (observation.deleted && !includeDeleted) continue
      if (hiddenSetups.has(observation.setupRecordId)) continue
      if (observation.targetE === null || observation.targetN === null) continue
      const setup = setupById.get(observation.setupRecordId)
      if (!setup || setup.easting === null || setup.northing === null) continue
      const key = `${observation.setupRecordId}|${observation.target}`
      const list = groups.get(key)
      if (list) list.push(observation)
      else groups.set(key, [observation])
    }
    return [...groups.entries()].map(([key, observations]) => {
      const setup = setupById.get(observations[0].setupRecordId) as PlanSetup
      const easting = observations.reduce((sum, o) => sum + (o.targetE ?? 0), 0) / observations.length
      const northing = observations.reduce((sum, o) => sum + (o.targetN ?? 0), 0) / observations.length
      return {
        key,
        setup,
        color: setupColor.get(setup.recordId) ?? PALETTE[0],
        target: observations[0].target,
        easting,
        northing,
        observations: observations.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1)),
      }
    })
  }, [data, includeDeleted, hiddenSetups, setupColor])

  const bounds = useMemo(() => {
    if (!data) return null
    const xs: number[] = []
    const ys: number[] = []
    for (const setup of data.setups) {
      if (setup.easting !== null && setup.northing !== null) {
        xs.push(setup.easting)
        ys.push(setup.northing)
      }
    }
    for (const pair of pairs) {
      xs.push(pair.easting)
      ys.push(pair.northing)
    }
    if (xs.length === 0) return null
    return {
      minE: Math.min(...xs),
      maxE: Math.max(...xs),
      minN: Math.min(...ys),
      maxN: Math.max(...ys),
    }
  }, [data, pairs])

  const selectedPair = pairs.find((pair) => pair.key === selectedKey) ?? null

  const toggleSetup = (recordId: string) => {
    setHiddenSetups((current) => {
      const next = new Set(current)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  }

  const label = "block text-xs font-medium uppercase tracking-wide text-slate-400"
  const card = "rounded-2xl border border-white/10 bg-white/5 p-5"

  let svg: ReactElement | null = null
  if (bounds) {
    const span = Math.max(bounds.maxE - bounds.minE, bounds.maxN - bounds.minN) || 1
    const pad = span * 0.08
    const viewBox = `${bounds.minE - pad} ${-(bounds.maxN + pad)} ${bounds.maxE - bounds.minE + 2 * pad} ${bounds.maxN - bounds.minN + 2 * pad}`
    const size = span * 0.012
    const labelSize = span * 0.02
    svg = (
      <svg viewBox={viewBox} className="w-full rounded-xl bg-slate-950" preserveAspectRatio="xMidYMid meet" role="img" aria-label={t.title}>
        {pairs.map((pair) => (
          <line
            key={pair.key}
            x1={pair.setup.easting ?? 0}
            y1={-(pair.setup.northing ?? 0)}
            x2={pair.easting}
            y2={-pair.northing}
            stroke={pair.color}
            strokeWidth={selectedKey === pair.key ? 3 : 1.2}
            vectorEffect="non-scaling-stroke"
            opacity={selectedKey && selectedKey !== pair.key ? 0.35 : 0.9}
            onClick={() => setSelectedKey(pair.key)}
            style={{ cursor: "pointer" }}
          >
            <title>{`${pair.setup.label} → ${pair.target} (${pair.observations.length})`}</title>
          </line>
        ))}
        {data?.setups.map((setup) => {
          if (setup.easting === null || setup.northing === null || hiddenSetups.has(setup.recordId)) return null
          const x = setup.easting
          const y = -setup.northing
          const color = setupColor.get(setup.recordId) ?? PALETTE[0]
          return (
            <g key={setup.recordId}>
              <path d={`M ${x} ${y - size} L ${x - size} ${y + size * 0.8} L ${x + size} ${y + size * 0.8} Z`} fill={color} stroke="#020617" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
              <text x={x + size} y={y - size} fontSize={labelSize} fill={color}>{setup.label}</text>
            </g>
          )
        })}
        {pairs
          .filter((pair, index, all) => all.findIndex((p) => p.target === pair.target) === index)
          .map((pair) => (
            <g key={`target-${pair.target}`}>
              <circle cx={pair.easting} cy={-pair.northing} r={span * 0.005} fill="#e2e8f0" />
              <text x={pair.easting + span * 0.008} y={-pair.northing + span * 0.008} fontSize={labelSize * 0.8} fill="#cbd5e1">{pair.target}</text>
            </g>
          ))}
      </svg>
    )
  }

  return (
    <div className="relative z-10 mx-auto max-w-6xl px-6 py-12 text-slate-100">
      <PageSeo
        title="Observation Plan | Survey Tool"
        description="Plan view of total-station observations using the coordinates held at the time of each measurement."
        canonicalUrl="https://www.surveytool.io/tools/observation-plan"
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
        <MapPin className="mt-1 text-cyan-300" size={28} />
        <div>
          <h1 className="text-3xl font-semibold">{t.title}</h1>
          <p className="mt-2 max-w-3xl text-slate-300">{t.intro}</p>
          <p className="mt-3 rounded-xl border border-orange-300/30 bg-orange-300/10 px-4 py-2 text-sm text-orange-100">{t.disclaimer}</p>
        </div>
      </header>

      <section className={`${card} mt-8`}>
        <label className={label}>{t.upload}</label>
        <label className="mt-2 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-white/20 px-4 py-3 text-sm text-slate-300 hover:border-cyan-300/50">
          <Upload size={16} />
          <span>{fileName ? `${t.loaded}: ${fileName}` : t.upload}</span>
          <input type="file" accept=".csv,.jxl,.xml" className="sr-only" onChange={onFile} />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-200">
            {t.error}: {error}
          </p>
        )}
      </section>

      {!data && !error && <p className="mt-10 text-center text-slate-400">{t.noData}</p>}

      {data && (
        <div className="mt-8 inline-flex rounded-xl border border-white/10 p-1 text-sm">
          {(["plan", "setups", "chain"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={viewMode === mode}
              onClick={() => setViewMode(mode)}
              className={`rounded-lg px-3 py-1 ${viewMode === mode ? "bg-cyan-400/20 text-cyan-100" : "text-slate-400 hover:text-white"}`}
            >
              {mode === "plan" ? t.planView : mode === "setups" ? t.setupView : t.chainView}
            </button>
          ))}
        </div>
      )}

      {data && viewMode === "setups" && <SetupsView data={data} includeDeleted={includeDeleted} t={t} card={card} />}
      {data && viewMode === "chain" && <ChainView data={data} includeDeleted={includeDeleted} t={t} card={card} />}

      {data && viewMode === "plan" && (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            {svg}
            <div className="flex flex-wrap gap-4 text-xs text-slate-400">
              <span>{t.legendSetup}: ▲</span>
              <span>{t.legendTarget}: ●</span>
              <span>{t.select}</span>
            </div>

            <section className={card}>
              <h2 className="text-lg font-semibold">{t.pairs}</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="py-2 pr-4 font-medium">{t.setup}</th>
                      <th className="py-2 pr-4 font-medium">{t.target}</th>
                      <th className="py-2 pr-4 font-medium">{t.count}</th>
                      <th className="py-2 pr-4 font-medium">{t.codes}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pairs.map((pair) => (
                      <tr
                        key={pair.key}
                        onClick={() => setSelectedKey(pair.key)}
                        className={`cursor-pointer border-t border-white/5 hover:bg-white/5 ${selectedKey === pair.key ? "bg-cyan-400/10" : ""}`}
                      >
                        <td className="py-2 pr-4"><span style={{ color: pair.color }}>●</span> {pair.setup.label}</td>
                        <td className="py-2 pr-4 font-mono">{pair.target}</td>
                        <td className="py-2 pr-4">{pair.observations.length}</td>
                        <td className="py-2 pr-4 text-slate-400">{[...new Set(pair.observations.map((o) => o.pointCode).filter(Boolean))].join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {selectedPair && (
              <section className={card}>
                <h2 className="text-lg font-semibold">
                  {t.details}: {selectedPair.setup.label} → {selectedPair.target}
                </h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="uppercase tracking-wide text-slate-400">
                      <tr>
                        {[t.time, t.face, t.hz, t.v, t.sd, t.code, t.classification, t.deleted].map((h) => (
                          <th key={h} className="whitespace-nowrap py-2 pr-4 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPair.observations.map((o) => (
                        <tr key={o.observationNumber} className={`border-t border-white/5 ${o.deleted ? "text-slate-500 line-through" : "text-slate-300"}`}>
                          <td className="py-1.5 pr-4 font-mono">{o.timestamp.replace("T", " ")}</td>
                          <td className="py-1.5 pr-4">{o.face}</td>
                          <td className="py-1.5 pr-4 font-mono">{o.hzDeg.toFixed(6)}</td>
                          <td className="py-1.5 pr-4 font-mono">{o.vDeg.toFixed(6)}</td>
                          <td className="py-1.5 pr-4 font-mono">{o.slopeM.toFixed(4)}</td>
                          <td className="py-1.5 pr-4">{o.pointCode}</td>
                          <td className="py-1.5 pr-4">{o.classification}</td>
                          <td className="py-1.5 pr-4">{o.deleted ? t.yes : t.no}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>

          <aside className="space-y-6">
            <section className={card}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)} />
                {t.includeDeleted}
              </label>
            </section>

            <section className={card}>
              <h2 className="text-lg font-semibold">{t.setups}</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {data.setups.map((setup) => {
                  const hasCoordinates = setup.easting !== null && setup.northing !== null
                  const disabled = setup.observationCount === 0 || !hasCoordinates
                  return (
                    <li key={setup.recordId}>
                      <label className={`flex items-center gap-2 ${disabled ? "text-slate-500" : ""}`}>
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={!hiddenSetups.has(setup.recordId) && !disabled}
                          onChange={() => toggleSetup(setup.recordId)}
                        />
                        <span style={{ color: setupColor.get(setup.recordId) }}>●</span>
                        <span>{setup.label}</span>
                        <span className="text-xs text-slate-500">
                          {setup.observationCount === 0 ? t.noSetupLive : `${setup.observationCount} ${t.liveCount}`}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className={card}>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-slate-400">{t.rows}</dt><dd>{data.qc.rowCount}</dd></div>
                <div><dt className="text-slate-400">{t.deletedRows}</dt><dd>{data.qc.deletedCount}</dd></div>
                <div><dt className="text-slate-400">{t.meanRows}</dt><dd>{data.qc.meanRowCount}</dd></div>
                <div><dt className="text-slate-400">{t.observations}</dt><dd>{data.observations.length}</dd></div>
              </dl>
            </section>

            {data.warnings.length > 0 && (
              <section className="rounded-xl border border-orange-300/30 bg-orange-300/10 p-4 text-sm text-orange-100">
                <p className="font-semibold">{t.warnings}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {data.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
