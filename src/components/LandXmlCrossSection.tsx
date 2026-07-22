import { useEffect, useMemo, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import { X } from "lucide-react"

import type { LandXmlAlignment, LandXmlDocument, LandXmlSurface, PlanPoint } from "../lib/landxml"
import type { SurveyPoint, SurveyPointLayer } from "../lib/surveyPoints"

type Props = {
  document: LandXmlDocument
  pointLayers: SurveyPointLayer[]
}

type XY = { x: number; y: number }
type SectionLine = { start: PlanPoint; end: PlanPoint }
type Sample = { distance: number; values: Array<number | null> }
type SurfaceTriangle = {
  a: PlanPoint
  b: PlanPoint
  c: PlanPoint
  minEasting: number
  maxEasting: number
  minNorthing: number
  maxNorthing: number
}
type StationResult = {
  chainage: number
  offset: number
  distance: number
  sectionDistance: number | null
}
type ThicknessStats = { minimum: number; maximum: number; average: number; sampleCount: number }
type SectionSurveyPoint = SurveyPoint & {
  layerName: string
  layerIndex: number
  distance: number
  offset: number
  referenceLevel: number | null
  differenceMm: number | null
}

const width = 1000
const height = 620
const padding = 34
const samplesCount = 160
const surfaceColours = ["#22d3ee", "#60a5fa", "#a78bfa", "#34d399", "#f472b6"]
const pointColours = ["#fb923c", "#e879f9", "#facc15", "#2dd4bf", "#fb7185", "#818cf8"]

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function boundsFor(document: LandXmlDocument, pointLayers: SurveyPointLayer[]) {
  let minE = Number.POSITIVE_INFINITY
  let maxE = Number.NEGATIVE_INFINITY
  let minN = Number.POSITIVE_INFINITY
  let maxN = Number.NEGATIVE_INFINITY
  let count = 0

  function include(point: { easting: number; northing: number }) {
    minE = Math.min(minE, point.easting)
    maxE = Math.max(maxE, point.easting)
    minN = Math.min(minN, point.northing)
    maxN = Math.max(maxN, point.northing)
    count += 1
  }

  document.surfaces.forEach((surface) => Object.values(surface.points).forEach(include))
  document.alignments.forEach((alignment) => alignment.points.forEach(include))
  pointLayers.forEach((layer) => layer.points.forEach(include))

  return count ? { minE, maxE, minN, maxN } : null
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
    project(point: { easting: number; northing: number }): XY {
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

function interpolateTriangle(triangle: SurfaceTriangle, easting: number, northing: number): number | null | undefined {
  const { a, b, c } = triangle
  const denominator =
    (b.northing - c.northing) * (a.easting - c.easting) +
    (c.easting - b.easting) * (a.northing - c.northing)
  if (Math.abs(denominator) < 1e-12) return undefined

  const weightA =
    ((b.northing - c.northing) * (easting - c.easting) +
      (c.easting - b.easting) * (northing - c.northing)) /
    denominator
  const weightB =
    ((c.northing - a.northing) * (easting - c.easting) +
      (a.easting - c.easting) * (northing - c.northing)) /
    denominator
  const weightC = 1 - weightA - weightB
  if (weightA < -0.000001 || weightB < -0.000001 || weightC < -0.000001) return undefined
  if (a.elevation === null || b.elevation === null || c.elevation === null) return null
  return weightA * a.elevation + weightB * b.elevation + weightC * c.elevation
}

function createSurfaceIndex(surface: LandXmlSurface) {
  const triangles: SurfaceTriangle[] = []
  let minEasting = Number.POSITIVE_INFINITY
  let maxEasting = Number.NEGATIVE_INFINITY
  let minNorthing = Number.POSITIVE_INFINITY
  let maxNorthing = Number.NEGATIVE_INFINITY

  surface.faces.forEach((face) => {
    const a = surface.points[face[0]]
    const b = surface.points[face[1]]
    const c = surface.points[face[2]]
    if (!a || !b || !c) return

    const triangle = {
      a,
      b,
      c,
      minEasting: Math.min(a.easting, b.easting, c.easting),
      maxEasting: Math.max(a.easting, b.easting, c.easting),
      minNorthing: Math.min(a.northing, b.northing, c.northing),
      maxNorthing: Math.max(a.northing, b.northing, c.northing),
    }
    minEasting = Math.min(minEasting, triangle.minEasting)
    maxEasting = Math.max(maxEasting, triangle.maxEasting)
    minNorthing = Math.min(minNorthing, triangle.minNorthing)
    maxNorthing = Math.max(maxNorthing, triangle.maxNorthing)
    triangles.push(triangle)
  })

  if (!triangles.length) return { find: () => null as number | null }

  const dimension = clamp(Math.ceil(Math.sqrt(triangles.length / 6)), 8, 120)
  const cellWidth = Math.max((maxEasting - minEasting) / dimension, 0.000001)
  const cellHeight = Math.max((maxNorthing - minNorthing) / dimension, 0.000001)
  const cells = new Map<string, SurfaceTriangle[]>()

  function cellIndex(value: number, minimum: number, size: number) {
    return clamp(Math.floor((value - minimum) / size), 0, dimension - 1)
  }

  triangles.forEach((triangle) => {
    const startX = cellIndex(triangle.minEasting, minEasting, cellWidth)
    const endX = cellIndex(triangle.maxEasting, minEasting, cellWidth)
    const startY = cellIndex(triangle.minNorthing, minNorthing, cellHeight)
    const endY = cellIndex(triangle.maxNorthing, minNorthing, cellHeight)

    for (let x = startX; x <= endX; x += 1) {
      for (let y = startY; y <= endY; y += 1) {
        const key = `${x}:${y}`
        const existing = cells.get(key)
        if (existing) existing.push(triangle)
        else cells.set(key, [triangle])
      }
    }
  })

  return {
    find(easting: number, northing: number) {
      if (easting < minEasting || easting > maxEasting || northing < minNorthing || northing > maxNorthing) return null
      const candidates = cells.get(`${cellIndex(easting, minEasting, cellWidth)}:${cellIndex(northing, minNorthing, cellHeight)}`) ?? []
      for (const triangle of candidates) {
        const value = interpolateTriangle(triangle, easting, northing)
        if (value !== undefined) return value
      }
      return null
    },
  }
}

function stationAt(alignment: LandXmlAlignment | undefined, point: PlanPoint): StationResult | null {
  if (!alignment || alignment.points.length < 2) return null
  let travelled = 0
  let best: StationResult | null = null

  for (let index = 1; index < alignment.points.length; index += 1) {
    const a = alignment.points[index - 1]
    const b = alignment.points[index]
    const dx = b.easting - a.easting
    const dy = b.northing - a.northing
    const lengthSquared = dx * dx + dy * dy
    if (!lengthSquared) continue
    const t = clamp(((point.easting - a.easting) * dx + (point.northing - a.northing) * dy) / lengthSquared, 0, 1)
    const easting = a.easting + dx * t
    const northing = a.northing + dy * t
    const distance = Math.hypot(point.easting - easting, point.northing - northing)
    const cross = dx * (point.northing - northing) - dy * (point.easting - easting)
    const segmentLength = Math.sqrt(lengthSquared)
    if (!best || distance < best.distance) {
      best = {
        distance,
        chainage: (alignment.startStation ?? 0) + travelled + segmentLength * t,
        offset: Math.sign(cross || 1) * distance,
        sectionDistance: null,
      }
    }
    travelled += segmentLength
  }
  return best
}

function cross2d(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx
}

function stationForSection(alignment: LandXmlAlignment | undefined, line: SectionLine): StationResult | null {
  if (!alignment || alignment.points.length < 2) return null
  const sectionX = line.end.easting - line.start.easting
  const sectionY = line.end.northing - line.start.northing
  const sectionLength = Math.hypot(sectionX, sectionY)
  let travelled = 0

  for (let index = 1; index < alignment.points.length; index += 1) {
    const a = alignment.points[index - 1]
    const b = alignment.points[index]
    const alignmentX = b.easting - a.easting
    const alignmentY = b.northing - a.northing
    const denominator = cross2d(alignmentX, alignmentY, sectionX, sectionY)
    const segmentLength = Math.hypot(alignmentX, alignmentY)

    if (Math.abs(denominator) > 1e-9) {
      const deltaX = line.start.easting - a.easting
      const deltaY = line.start.northing - a.northing
      const alignmentRatio = cross2d(deltaX, deltaY, sectionX, sectionY) / denominator
      const sectionRatio = cross2d(deltaX, deltaY, alignmentX, alignmentY) / denominator
      if (alignmentRatio >= -0.000001 && alignmentRatio <= 1.000001 && sectionRatio >= -0.000001 && sectionRatio <= 1.000001) {
        return {
          chainage: (alignment.startStation ?? 0) + travelled + segmentLength * alignmentRatio,
          offset: 0,
          distance: 0,
          sectionDistance: sectionLength * sectionRatio,
        }
      }
    }
    travelled += segmentLength
  }

  const midpoint = {
    easting: (line.start.easting + line.end.easting) / 2,
    northing: (line.start.northing + line.end.northing) / 2,
    elevation: null,
  }
  const fallback = stationAt(alignment, midpoint)
  return fallback ? { ...fallback, sectionDistance: sectionLength / 2 } : null
}

function formatChainage(value: number | null) {
  if (value === null) return "—"
  const kilometres = Math.floor(value / 1000)
  return `${kilometres}+${(value - kilometres * 1000).toFixed(3).padStart(7, "0")}`
}

function calculateThickness(samples: Sample[], topIndex: number, bottomIndex: number): ThicknessStats | null {
  if (topIndex < 0 || bottomIndex < 0) return null
  const values: number[] = []
  samples.forEach((sample) => {
    const top = sample.values[topIndex]
    const bottom = sample.values[bottomIndex]
    if (top !== null && bottom !== null) values.push((top - bottom) * 1000)
  })
  if (!values.length) return null
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  let total = 0
  values.forEach((value) => {
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
    total += value
  })
  return { minimum, maximum, average: total / values.length, sampleCount: values.length }
}

function projectPointToSection(point: SurveyPoint, line: SectionLine, corridor: number) {
  const dx = line.end.easting - line.start.easting
  const dy = line.end.northing - line.start.northing
  const lengthSquared = dx * dx + dy * dy
  const length = Math.sqrt(lengthSquared)
  if (!lengthSquared) return null

  const ratio = ((point.easting - line.start.easting) * dx + (point.northing - line.start.northing) * dy) / lengthSquared
  if (ratio < 0 || ratio > 1) return null
  const nearestEasting = line.start.easting + dx * ratio
  const nearestNorthing = line.start.northing + dy * ratio
  const cross = dx * (point.northing - nearestNorthing) - dy * (point.easting - nearestEasting)
  const offset = cross / length
  if (Math.abs(offset) > corridor) return null
  return { distance: ratio * length, offset }
}

export default function LandXmlCrossSection({ document, pointLayers }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ pointerId: number; start: PlanPoint } | null>(null)
  const [alignmentName, setAlignmentName] = useState(document.alignments[0]?.name ?? "")
  const [topSurfaceName, setTopSurfaceName] = useState(document.surfaces[0]?.name ?? "")
  const [bottomSurfaceName, setBottomSurfaceName] = useState(document.surfaces[1]?.name ?? document.surfaces[0]?.name ?? "")
  const [referenceSurfaceName, setReferenceSurfaceName] = useState(document.surfaces[0]?.name ?? "")
  const [corridor, setCorridor] = useState(1)
  const [line, setLine] = useState<SectionLine | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [showResult, setShowResult] = useState(false)

  const bounds = useMemo(() => boundsFor(document, pointLayers), [document, pointLayers])
  const mapProjection = useMemo(() => (bounds ? projection(bounds) : null), [bounds])
  const surfaceIndexes = useMemo(() => document.surfaces.map(createSurfaceIndex), [document.surfaces])
  const alignment = document.alignments.find((item) => item.name === alignmentName)

  useEffect(() => {
    const names = document.alignments.map((item) => item.name)
    if (!names.length) setAlignmentName("")
    else if (!names.includes(alignmentName)) setAlignmentName(names[0])
  }, [alignmentName, document.alignments])

  useEffect(() => {
    const names = document.surfaces.map((surface) => surface.name)
    if (!names.includes(topSurfaceName)) setTopSurfaceName(names[0] ?? "")
    if (!names.includes(bottomSurfaceName)) setBottomSurfaceName(names[1] ?? names[0] ?? "")
    if (!names.includes(referenceSurfaceName)) setReferenceSurfaceName(names[0] ?? "")
  }, [bottomSurfaceName, document.surfaces, referenceSurfaceName, topSurfaceName])

  const result = useMemo(() => {
    if (!line || isDrawing) return null
    const length = Math.hypot(line.end.easting - line.start.easting, line.end.northing - line.start.northing)
    const samples: Sample[] = Array.from({ length: samplesCount + 1 }, (_, index) => {
      const ratio = index / samplesCount
      const easting = line.start.easting + (line.end.easting - line.start.easting) * ratio
      const northing = line.start.northing + (line.end.northing - line.start.northing) * ratio
      return { distance: length * ratio, values: surfaceIndexes.map((surfaceIndex) => surfaceIndex.find(easting, northing)) }
    })

    const referenceIndex = document.surfaces.findIndex((surface) => surface.name === referenceSurfaceName)
    const sectionPoints: SectionSurveyPoint[] = []
    pointLayers.forEach((layer, layerIndex) => {
      layer.points.forEach((point) => {
        const projected = projectPointToSection(point, line, Math.max(corridor, 0.01))
        if (!projected) return
        const referenceLevel = referenceIndex >= 0 ? surfaceIndexes[referenceIndex].find(point.easting, point.northing) : null
        sectionPoints.push({
          ...point,
          layerName: layer.name,
          layerIndex,
          distance: projected.distance,
          offset: projected.offset,
          referenceLevel,
          differenceMm: referenceLevel === null ? null : (point.elevation - referenceLevel) * 1000,
        })
      })
    })
    sectionPoints.sort((a, b) => a.distance - b.distance)

    return { length, samples, station: stationForSection(alignment, line), sectionPoints }
  }, [alignment, corridor, document.surfaces, isDrawing, line, pointLayers, referenceSurfaceName, surfaceIndexes])

  const thickness = useMemo(() => {
    if (!result) return null
    return calculateThickness(
      result.samples,
      document.surfaces.findIndex((surface) => surface.name === topSurfaceName),
      document.surfaces.findIndex((surface) => surface.name === bottomSurfaceName),
    )
  }, [bottomSurfaceName, document.surfaces, result, topSurfaceName])

  function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>) {
    if (!svgRef.current || !mapProjection) return null
    const rect = svgRef.current.getBoundingClientRect()
    return mapProjection.unproject({
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    })
  }

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return
    const point = pointFromEvent(event)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, start: point }
    setIsDrawing(true)
    setLine({ start: point, end: point })
    setShowResult(false)
  }

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = pointFromEvent(event)
    if (point) setLine({ start: drag.start, end: point })
  }

  function finishPointer(event: ReactPointerEvent<SVGSVGElement>, cancelled = false) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const finalLine = { start: drag.start, end: pointFromEvent(event) ?? drag.start }
    const length = Math.hypot(finalLine.end.easting - finalLine.start.easting, finalLine.end.northing - finalLine.start.northing)
    dragRef.current = null
    setIsDrawing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (cancelled || length <= 0.05) {
      setLine(null)
      setShowResult(false)
      return
    }
    setLine(finalLine)
    setShowResult(true)
  }

  const projectedLine = line && mapProjection ? { start: mapProjection.project(line.start), end: mapProjection.project(line.end) } : null

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">Cross-section map</p>
          <h2 className="mt-2 text-2xl font-semibold">Drag across surfaces and as-built points</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">Measured points within the section corridor are plotted against the selected reference TIN.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SelectControl label="Alignment" value={alignmentName} onChange={setAlignmentName} options={document.alignments.map((item) => item.name)} emptyLabel="No alignment" />
          <SelectControl label="Top surface" value={topSurfaceName} onChange={setTopSurfaceName} options={document.surfaces.map((item) => item.name)} />
          <SelectControl label="Bottom surface" value={bottomSurfaceName} onChange={setBottomSurfaceName} options={document.surfaces.map((item) => item.name)} />
          <SelectControl label="As-built reference" value={referenceSurfaceName} onChange={setReferenceSurfaceName} options={document.surfaces.map((item) => item.name)} emptyLabel="No reference" />
          <label className="text-sm text-slate-300">
            <span className="mb-2 block">Point corridor ±m</span>
            <input type="number" min="0.05" max="20" step="0.05" value={corridor} onChange={(event) => setCorridor(Math.max(0.05, Number(event.target.value) || 0.05))} className="w-full min-w-32 rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-cyan-400" />
          </label>
        </div>
      </div>

      <div className="relative mt-5 overflow-hidden rounded-2xl border border-white/10 bg-slate-950">
        {bounds && mapProjection ? (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={(event) => finishPointer(event)}
            onPointerCancel={(event) => finishPointer(event, true)}
            className={`block aspect-[1000/620] w-full select-none ${isDrawing ? "cursor-grabbing" : "cursor-crosshair"}`}
            style={{ touchAction: "none" }}
          >
            <rect width={width} height={height} fill="#020617" />
            {document.surfaces.map((surface, surfaceIndex) => {
              const faceStep = Math.max(1, Math.ceil(surface.faces.length / 3000))
              return (
                <g key={surface.name}>
                  {surface.faces.filter((_, index) => index % faceStep === 0).map((face, index) => {
                    const points = face.map((id) => surface.points[id]).filter((point): point is PlanPoint => point !== undefined)
                    if (points.length !== 3) return null
                    return (
                      <polygon
                        key={`${surface.name}-${index}`}
                        points={points.map((point) => { const projected = mapProjection.project(point); return `${projected.x},${projected.y}` }).join(" ")}
                        fill={surfaceColours[surfaceIndex % surfaceColours.length]}
                        fillOpacity="0.1"
                        stroke={surfaceColours[surfaceIndex % surfaceColours.length]}
                        strokeOpacity="0.4"
                        strokeWidth="0.8"
                        vectorEffect="non-scaling-stroke"
                      />
                    )
                  })}
                </g>
              )
            })}

            {document.alignments.map((item) => (
              <polyline
                key={item.name}
                points={item.points.map((point) => { const projected = mapProjection.project(point); return `${projected.x},${projected.y}` }).join(" ")}
                fill="none"
                stroke={item.name === alignmentName ? "#fbbf24" : "#64748b"}
                strokeWidth={item.name === alignmentName ? 4 : 2}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {pointLayers.map((layer, layerIndex) => {
              const step = Math.max(1, Math.ceil(layer.points.length / 5000))
              return (
                <g key={layer.name}>
                  {layer.points.filter((_, index) => index % step === 0).map((point) => {
                    const projected = mapProjection.project(point)
                    return <circle key={`${layer.name}-${point.id}-${projected.x}-${projected.y}`} cx={projected.x} cy={projected.y} r="3.5" fill={pointColours[layerIndex % pointColours.length]} stroke="#020617" strokeWidth="1"><title>{`${layer.name} · ${point.id} · RL ${point.elevation.toFixed(3)}`}</title></circle>
                  })}
                </g>
              )
            })}

            {projectedLine && (
              <g pointerEvents="none">
                <line x1={projectedLine.start.x} y1={projectedLine.start.y} x2={projectedLine.end.x} y2={projectedLine.end.y} stroke="#fb7185" strokeWidth="5" strokeDasharray="12 7" vectorEffect="non-scaling-stroke" />
                <circle cx={projectedLine.start.x} cy={projectedLine.start.y} r="7" fill="#fb7185" stroke="white" strokeWidth="2" />
                <circle cx={projectedLine.end.x} cy={projectedLine.end.y} r="7" fill="#fb7185" stroke="white" strokeWidth="2" />
              </g>
            )}
          </svg>
        ) : <div className="flex aspect-[1000/620] items-center justify-center text-slate-500">No readable geometry.</div>}
      </div>

      {result && !showResult && <button type="button" onClick={() => setShowResult(true)} className="mt-4 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">Open cross section</button>}

      {showResult && result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowResult(false) }}>
          <div className="max-h-[92vh] w-full max-w-6xl overflow-auto rounded-3xl border border-white/15 bg-slate-950 p-6 shadow-2xl md:p-8">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">Cross section</p>
                <h3 className="mt-2 text-2xl font-semibold">CH {formatChainage(result.station?.chainage ?? null)}</h3>
                <p className="mt-2 text-sm text-slate-400">
                  Section length {result.length.toFixed(3)} m · Alignment offset {result.station ? `${result.station.offset.toFixed(3)} m` : "—"}
                  {result.station?.sectionDistance !== null && result.station?.sectionDistance !== undefined ? ` · Alignment at section offset ${result.station.sectionDistance.toFixed(3)} m` : ""}
                </p>
              </div>
              <button type="button" aria-label="Close cross section" onClick={() => setShowResult(false)} className="rounded-xl border border-white/10 p-2 text-slate-300 transition hover:bg-white/10"><X size={20} /></button>
            </div>

            <div className="mt-6 grid gap-5 xl:grid-cols-2">
              <ThicknessSummary stats={thickness} topSurfaceName={topSurfaceName} bottomSurfaceName={bottomSurfaceName} />
              <AsbuiltSummary points={result.sectionPoints} referenceSurfaceName={referenceSurfaceName} corridor={corridor} />
            </div>

            <ProfileChart surfaces={document.surfaces} samples={result.samples} length={result.length} points={result.sectionPoints} pointLayers={pointLayers} />
            <AsbuiltTable points={result.sectionPoints} />
          </div>
        </div>
      )}
    </section>
  )
}

function SelectControl({ label, value, onChange, options, emptyLabel }: { label: string; value: string; onChange: (value: string) => void; options: string[]; emptyLabel?: string }) {
  return (
    <label className="text-sm text-slate-300">
      <span className="mb-2 block">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full min-w-40 rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-cyan-400">
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  )
}

function ThicknessSummary({ stats, topSurfaceName, bottomSurfaceName }: { stats: ThicknessStats | null; topSurfaceName: string; bottomSurfaceName: string }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h4 className="font-semibold">Layer thickness</h4>
      <p className="mt-1 text-sm text-slate-400">{topSurfaceName || "Top surface"} minus {bottomSurfaceName || "bottom surface"}</p>
      {stats ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="Minimum" value={`${stats.minimum.toFixed(0)} mm`} />
          <StatCard label="Average" value={`${stats.average.toFixed(0)} mm`} />
          <StatCard label="Maximum" value={`${stats.maximum.toFixed(0)} mm`} />
        </div>
      ) : <p className="mt-4 text-sm text-amber-200">The selected surfaces do not overlap along this section.</p>}
    </section>
  )
}

function AsbuiltSummary({ points, referenceSurfaceName, corridor }: { points: SectionSurveyPoint[]; referenceSurfaceName: string; corridor: number }) {
  const differences = points.map((point) => point.differenceMm).filter((value): value is number => value !== null)
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  let total = 0
  differences.forEach((value) => { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); total += value })

  return (
    <section className="rounded-2xl border border-violet-400/20 bg-violet-400/5 p-5">
      <h4 className="font-semibold">As-built comparison</h4>
      <p className="mt-1 text-sm text-slate-400">Points within ±{corridor.toFixed(2)} m · reference {referenceSurfaceName || "not selected"}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <StatCard label="Points" value={points.length.toLocaleString("en-NZ")} />
        <StatCard label="Minimum Δ" value={differences.length ? `${minimum.toFixed(0)} mm` : "—"} />
        <StatCard label="Average Δ" value={differences.length ? `${(total / differences.length).toFixed(0)} mm` : "—"} />
        <StatCard label="Maximum Δ" value={differences.length ? `${maximum.toFixed(0)} mm` : "—"} />
      </div>
    </section>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  )
}

function ProfileChart({ surfaces, samples, length, points, pointLayers }: { surfaces: LandXmlSurface[]; samples: Sample[]; length: number; points: SectionSurveyPoint[]; pointLayers: SurveyPointLayer[] }) {
  const levels: number[] = []
  samples.forEach((sample) => sample.values.forEach((value) => { if (value !== null) levels.push(value) }))
  points.forEach((point) => levels.push(point.elevation))
  if (!levels.length) return <p className="mt-8 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-amber-200">The section line does not cross readable surfaces or measured points.</p>

  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  levels.forEach((level) => { minimum = Math.min(minimum, level); maximum = Math.max(maximum, level) })
  const range = Math.max(maximum - minimum, 0.1)
  const chartWidth = 1000
  const chartHeight = 460
  const inset = 60
  const xAt = (distance: number) => inset + (distance / Math.max(length, 0.001)) * (chartWidth - inset * 2)
  const yAt = (level: number) => inset + ((maximum - level) / range) * (chartHeight - inset * 2)

  return (
    <div className="mt-7">
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full rounded-2xl border border-white/10 bg-slate-900/60">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = inset + ratio * (chartHeight - inset * 2)
          const level = maximum - ratio * range
          return <g key={ratio}><line x1={inset} y1={y} x2={chartWidth - inset} y2={y} stroke="#334155" /><text x={8} y={y + 4} fill="#94a3b8" fontSize="12">{level.toFixed(3)}</text></g>
        })}

        {surfaces.map((surface, surfaceIndex) => {
          const segments: string[] = []
          let current = ""
          samples.forEach((sample) => {
            const value = sample.values[surfaceIndex]
            if (value === null) { if (current) segments.push(current); current = ""; return }
            current += `${current ? " L" : "M"}${xAt(sample.distance).toFixed(2)} ${yAt(value).toFixed(2)}`
          })
          if (current) segments.push(current)
          return <g key={surface.name}>{segments.map((path, index) => <path key={index} d={path} fill="none" stroke={surfaceColours[surfaceIndex % surfaceColours.length]} strokeWidth="3" />)}</g>
        })}

        {points.map((point, index) => (
          <circle key={`${point.layerName}-${point.id}-${index}`} cx={xAt(point.distance)} cy={yAt(point.elevation)} r="5" fill={pointColours[point.layerIndex % pointColours.length]} stroke="white" strokeWidth="1.5">
            <title>{`${point.layerName} · ${point.id} · offset ${point.offset.toFixed(3)} m · RL ${point.elevation.toFixed(3)}${point.differenceMm === null ? "" : ` · Δ ${point.differenceMm.toFixed(0)} mm`}`}</title>
          </circle>
        ))}
      </svg>

      <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-300">
        {surfaces.map((surface, index) => <Legend key={surface.name} colour={surfaceColours[index % surfaceColours.length]} label={surface.name} />)}
        {pointLayers.map((layer, index) => <Legend key={layer.name} colour={pointColours[index % pointColours.length]} label={`${layer.name} (${layer.format})`} point />)}
      </div>
    </div>
  )
}

function Legend({ colour, label, point = false }: { colour: string; label: string; point?: boolean }) {
  return <span className="inline-flex items-center gap-2"><span className={point ? "h-3 w-3 rounded-full" : "h-2.5 w-6 rounded-full"} style={{ background: colour }} />{label}</span>
}

function AsbuiltTable({ points }: { points: SectionSurveyPoint[] }) {
  if (!points.length) return <p className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-slate-400">No as-built points fall inside the selected section corridor.</p>
  return (
    <section className="mt-7 overflow-hidden rounded-2xl border border-white/10">
      <div className="flex items-center justify-between bg-white/5 px-5 py-4">
        <div><h4 className="font-semibold">Measured points in section</h4><p className="mt-1 text-xs text-slate-500">Showing {Math.min(points.length, 200).toLocaleString("en-NZ")} of {points.length.toLocaleString("en-NZ")}</p></div>
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="sticky top-0 bg-slate-900 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">File</th><th className="px-4 py-3">Point</th><th className="px-4 py-3">Code</th><th className="px-4 py-3">Section offset</th><th className="px-4 py-3">Corridor offset</th><th className="px-4 py-3">As-built RL</th><th className="px-4 py-3">Reference RL</th><th className="px-4 py-3">Difference</th></tr></thead>
          <tbody className="divide-y divide-white/5">
            {points.slice(0, 200).map((point, index) => (
              <tr key={`${point.layerName}-${point.id}-${index}`} className="text-slate-300">
                <td className="px-4 py-3">{point.layerName}</td><td className="px-4 py-3 font-medium text-white">{point.id}</td><td className="px-4 py-3">{point.code || "—"}</td><td className="px-4 py-3">{point.distance.toFixed(3)} m</td><td className="px-4 py-3">{point.offset >= 0 ? "+" : ""}{point.offset.toFixed(3)} m</td><td className="px-4 py-3">{point.elevation.toFixed(3)}</td><td className="px-4 py-3">{point.referenceLevel === null ? "—" : point.referenceLevel.toFixed(3)}</td><td className={`px-4 py-3 font-semibold ${point.differenceMm === null ? "text-slate-500" : Math.abs(point.differenceMm) <= 20 ? "text-emerald-300" : "text-amber-300"}`}>{point.differenceMm === null ? "—" : `${point.differenceMm >= 0 ? "+" : ""}${point.differenceMm.toFixed(0)} mm`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
