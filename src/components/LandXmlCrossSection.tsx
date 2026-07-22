import { useMemo, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import { X } from "lucide-react"

import type {
  LandXmlAlignment,
  LandXmlDocument,
  LandXmlSurface,
  PlanPoint,
} from "../lib/landxml"

type Props = { document: LandXmlDocument }
type XY = { x: number; y: number }
type SectionLine = { start: PlanPoint; end: PlanPoint }
type Sample = { distance: number; values: Array<number | null> }

const width = 1000
const height = 620
const padding = 34
const samplesCount = 120
const colours = ["#22d3ee", "#60a5fa", "#a78bfa", "#34d399", "#f472b6"]

function boundsFor(document: LandXmlDocument) {
  const points = [
    ...document.surfaces.flatMap((surface) => Object.values(surface.points)),
    ...document.alignments.flatMap((alignment) => alignment.points),
  ]
  if (!points.length) return null
  return points.reduce(
    (bounds, point) => ({
      minE: Math.min(bounds.minE, point.easting),
      maxE: Math.max(bounds.maxE, point.easting),
      minN: Math.min(bounds.minN, point.northing),
      maxN: Math.max(bounds.maxN, point.northing),
    }),
    { minE: Infinity, maxE: -Infinity, minN: Infinity, maxN: -Infinity },
  )
}

function projection(bounds: NonNullable<ReturnType<typeof boundsFor>>) {
  const rangeE = Math.max(bounds.maxE - bounds.minE, 1)
  const rangeN = Math.max(bounds.maxN - bounds.minN, 1)
  const scale = Math.min((width - padding * 2) / rangeE, (height - padding * 2) / rangeN)
  const renderedWidth = rangeE * scale
  const renderedHeight = rangeN * scale
  const offsetX = (width - renderedWidth) / 2
  const offsetY = (height - renderedHeight) / 2

  return {
    project(point: PlanPoint): XY {
      return {
        x: offsetX + (point.easting - bounds.minE) * scale,
        y: offsetY + (bounds.maxN - point.northing) * scale,
      }
    },
    unproject(point: XY): PlanPoint {
      return {
        easting: bounds.minE + (point.x - offsetX) / scale,
        northing: bounds.maxN - (point.y - offsetY) / scale,
        elevation: null,
      }
    },
  }
}

function interpolate(surface: LandXmlSurface, easting: number, northing: number) {
  for (const face of surface.faces) {
    const a = surface.points[face[0]]
    const b = surface.points[face[1]]
    const c = surface.points[face[2]]
    if (!a || !b || !c) continue
    if (
      easting < Math.min(a.easting, b.easting, c.easting) ||
      easting > Math.max(a.easting, b.easting, c.easting) ||
      northing < Math.min(a.northing, b.northing, c.northing) ||
      northing > Math.max(a.northing, b.northing, c.northing)
    ) continue

    const denominator =
      (b.northing - c.northing) * (a.easting - c.easting) +
      (c.easting - b.easting) * (a.northing - c.northing)
    if (Math.abs(denominator) < 1e-12) continue
    const wa =
      ((b.northing - c.northing) * (easting - c.easting) +
        (c.easting - b.easting) * (northing - c.northing)) /
      denominator
    const wb =
      ((c.northing - a.northing) * (easting - c.easting) +
        (a.easting - c.easting) * (northing - c.northing)) /
      denominator
    const wc = 1 - wa - wb
    if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue
    if (a.elevation === null || b.elevation === null || c.elevation === null) return null
    return wa * a.elevation + wb * b.elevation + wc * c.elevation
  }
  return null
}

function stationAt(alignment: LandXmlAlignment | undefined, point: PlanPoint) {
  if (!alignment || alignment.points.length < 2) return null
  let travelled = 0
  let best: { distance: number; chainage: number; offset: number } | null = null

  for (let index = 1; index < alignment.points.length; index += 1) {
    const a = alignment.points[index - 1]
    const b = alignment.points[index]
    const dx = b.easting - a.easting
    const dy = b.northing - a.northing
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared === 0) continue
    const t = Math.max(0, Math.min(1, ((point.easting - a.easting) * dx + (point.northing - a.northing) * dy) / lengthSquared))
    const e = a.easting + dx * t
    const n = a.northing + dy * t
    const distance = Math.hypot(point.easting - e, point.northing - n)
    const cross = dx * (point.northing - n) - dy * (point.easting - e)
    const offset = Math.sign(cross || 1) * distance
    const segmentLength = Math.sqrt(lengthSquared)
    if (!best || distance < best.distance) {
      best = {
        distance,
        chainage: (alignment.startStation ?? 0) + travelled + segmentLength * t,
        offset,
      }
    }
    travelled += segmentLength
  }
  return best
}

function formatChainage(value: number | null) {
  if (value === null) return "—"
  const kilometres = Math.floor(value / 1000)
  return `${kilometres}+${(value - kilometres * 1000).toFixed(3).padStart(7, "0")}`
}

export default function LandXmlCrossSection({ document }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [alignmentName, setAlignmentName] = useState(document.alignments[0]?.name ?? "")
  const [drawingStart, setDrawingStart] = useState<PlanPoint | null>(null)
  const [line, setLine] = useState<SectionLine | null>(null)
  const [showResult, setShowResult] = useState(false)
  const bounds = useMemo(() => boundsFor(document), [document])
  const mapProjection = useMemo(() => (bounds ? projection(bounds) : null), [bounds])
  const alignment = document.alignments.find((item) => item.name === alignmentName)

  const result = useMemo(() => {
    if (!line) return null
    const length = Math.hypot(line.end.easting - line.start.easting, line.end.northing - line.start.northing)
    const samples: Sample[] = Array.from({ length: samplesCount + 1 }, (_, index) => {
      const ratio = index / samplesCount
      const easting = line.start.easting + (line.end.easting - line.start.easting) * ratio
      const northing = line.start.northing + (line.end.northing - line.start.northing) * ratio
      return {
        distance: length * ratio,
        values: document.surfaces.map((surface) => interpolate(surface, easting, northing)),
      }
    })
    const midpoint = {
      easting: (line.start.easting + line.end.easting) / 2,
      northing: (line.start.northing + line.end.northing) / 2,
      elevation: null,
    }
    return { length, samples, station: stationAt(alignment, midpoint) }
  }, [alignment, document.surfaces, line])

  function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>) {
    if (!svgRef.current || !mapProjection) return null
    const rect = svgRef.current.getBoundingClientRect()
    return mapProjection.unproject({
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    })
  }

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const point = pointFromEvent(event)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrawingStart(point)
    setLine({ start: point, end: point })
    setShowResult(false)
  }

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drawingStart) return
    const point = pointFromEvent(event)
    if (point) setLine({ start: drawingStart, end: point })
  }

  function pointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drawingStart || !line) return
    setDrawingStart(null)
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (Math.hypot(line.end.easting - line.start.easting, line.end.northing - line.start.northing) > 0.05) {
      setShowResult(true)
    }
  }

  const projectedLine = line && mapProjection
    ? { start: mapProjection.project(line.start), end: mapProjection.project(line.end) }
    : null

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">Cross-section map</p>
          <h2 className="mt-2 text-2xl font-semibold">Drag across the surface</h2>
          <p className="mt-2 text-sm text-slate-400">Press and drag from one side of the pavement to the other. The section line remains visible while drawing.</p>
        </div>
        <label className="text-sm text-slate-300">
          <span className="mb-2 block">Alignment for chainage</span>
          <select
            value={alignmentName}
            onChange={(event) => setAlignmentName(event.target.value)}
            className="min-w-64 rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-cyan-400"
          >
            <option value="">No alignment</option>
            {document.alignments.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </label>
      </div>

      <div className="relative mt-5 overflow-hidden rounded-2xl border border-white/10 bg-slate-950">
        {bounds && mapProjection ? (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            className="block aspect-[1000/620] w-full cursor-crosshair select-none"
            style={{ touchAction: "none" }}
          >
            <rect width={width} height={height} fill="#020617" />
            {document.surfaces.map((surface, surfaceIndex) => (
              <g key={surface.name}>
                {surface.faces.filter((_, index) => index % Math.max(1, Math.ceil(surface.faces.length / 3000)) === 0).map((face, index) => {
                  const points = face.map((id) => surface.points[id]).filter(Boolean)
                  if (points.length !== 3) return null
                  return <polygon key={index} points={points.map((point) => { const p = mapProjection.project(point); return `${p.x},${p.y}` }).join(" ")} fill={colours[surfaceIndex % colours.length]} fillOpacity="0.12" stroke={colours[surfaceIndex % colours.length]} strokeOpacity="0.45" strokeWidth="0.8" />
                })}
              </g>
            ))}
            {document.alignments.map((item) => (
              <polyline key={item.name} points={item.points.map((point) => { const p = mapProjection.project(point); return `${p.x},${p.y}` }).join(" ")} fill="none" stroke={item.name === alignmentName ? "#fbbf24" : "#64748b"} strokeWidth={item.name === alignmentName ? 4 : 2} />
            ))}
            {projectedLine && (
              <g pointerEvents="none">
                <line x1={projectedLine.start.x} y1={projectedLine.start.y} x2={projectedLine.end.x} y2={projectedLine.end.y} stroke="#fb7185" strokeWidth="5" strokeDasharray="12 7" />
                <circle cx={projectedLine.start.x} cy={projectedLine.start.y} r="7" fill="#fb7185" stroke="white" strokeWidth="2" />
                <circle cx={projectedLine.end.x} cy={projectedLine.end.y} r="7" fill="#fb7185" stroke="white" strokeWidth="2" />
              </g>
            )}
          </svg>
        ) : <div className="flex aspect-[1000/620] items-center justify-center text-slate-500">No readable geometry.</div>}
      </div>

      {result && !showResult && (
        <button type="button" onClick={() => setShowResult(true)} className="mt-4 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300">Open cross section</button>
      )}

      {showResult && result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowResult(false) }}>
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-3xl border border-white/15 bg-slate-950 p-6 shadow-2xl md:p-8">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">Cross section</p>
                <h3 className="mt-2 text-2xl font-semibold">CH {formatChainage(result.station?.chainage ?? null)}</h3>
                <p className="mt-2 text-sm text-slate-400">Section length {result.length.toFixed(3)} m · Alignment offset {result.station ? `${result.station.offset.toFixed(3)} m` : "—"}</p>
              </div>
              <button type="button" onClick={() => setShowResult(false)} className="rounded-xl border border-white/10 p-2 text-slate-300 hover:bg-white/10"><X size={20} /></button>
            </div>
            <ProfileChart surfaces={document.surfaces} samples={result.samples} length={result.length} />
          </div>
        </div>
      )}
    </section>
  )
}

function ProfileChart({ surfaces, samples, length }: { surfaces: LandXmlSurface[]; samples: Sample[]; length: number }) {
  const values = samples.flatMap((sample) => sample.values).filter((value): value is number => value !== null)
  if (!values.length) return <p className="mt-8 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-amber-200">The section line does not cross a readable TIN face.</p>
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(max - min, 0.1)
  const chartWidth = 900
  const chartHeight = 430
  const inset = 55

  return (
    <div className="mt-7">
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full rounded-2xl border border-white/10 bg-slate-900/60">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = inset + ratio * (chartHeight - inset * 2)
          const level = max - ratio * range
          return <g key={ratio}><line x1={inset} y1={y} x2={chartWidth - inset} y2={y} stroke="#334155" /><text x={8} y={y + 4} fill="#94a3b8" fontSize="12">{level.toFixed(3)}</text></g>
        })}
        {surfaces.map((surface, surfaceIndex) => {
          const segments: string[] = []
          let current = ""
          samples.forEach((sample) => {
            const value = sample.values[surfaceIndex]
            if (value === null) { if (current) segments.push(current); current = ""; return }
            const x = inset + (sample.distance / Math.max(length, 0.001)) * (chartWidth - inset * 2)
            const y = inset + ((max - value) / range) * (chartHeight - inset * 2)
            current += `${current ? " L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`
          })
          if (current) segments.push(current)
          return <g key={surface.name}>{segments.map((path, index) => <path key={index} d={path} fill="none" stroke={colours[surfaceIndex % colours.length]} strokeWidth="3" />)}</g>
        })}
      </svg>
      <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-300">
        {surfaces.map((surface, index) => <span key={surface.name} className="inline-flex items-center gap-2"><span className="h-2.5 w-6 rounded-full" style={{ background: colours[index % colours.length] }} />{surface.name}</span>)}
      </div>
    </div>
  )
}
