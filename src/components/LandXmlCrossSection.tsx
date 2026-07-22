import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type {
  PointerEvent as ReactPointerEvent,
} from "react"
import { X } from "lucide-react"

import type {
  LandXmlAlignment,
  LandXmlDocument,
  LandXmlSurface,
  PlanPoint,
} from "../lib/landxml"

type Props = {
  document: LandXmlDocument
}

type XY = {
  x: number
  y: number
}

type SectionLine = {
  start: PlanPoint
  end: PlanPoint
}

type Sample = {
  distance: number
  values: Array<number | null>
}

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

type ThicknessStats = {
  minimum: number
  maximum: number
  average: number
  sampleCount: number
}

const width = 1000
const height = 620
const padding = 34
const samplesCount = 160
const colours = [
  "#22d3ee",
  "#60a5fa",
  "#a78bfa",
  "#34d399",
  "#f472b6",
]

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function boundsFor(document: LandXmlDocument) {
  const points = [
    ...document.surfaces.flatMap((surface) =>
      Object.values(surface.points),
    ),
    ...document.alignments.flatMap((alignment) =>
      alignment.points,
    ),
  ]

  if (points.length === 0) {
    return null
  }

  return points.reduce(
    (bounds, point) => ({
      minE: Math.min(bounds.minE, point.easting),
      maxE: Math.max(bounds.maxE, point.easting),
      minN: Math.min(bounds.minN, point.northing),
      maxN: Math.max(bounds.maxN, point.northing),
    }),
    {
      minE: Number.POSITIVE_INFINITY,
      maxE: Number.NEGATIVE_INFINITY,
      minN: Number.POSITIVE_INFINITY,
      maxN: Number.NEGATIVE_INFINITY,
    },
  )
}

function projection(
  bounds: NonNullable<ReturnType<typeof boundsFor>>,
) {
  const rangeE = Math.max(bounds.maxE - bounds.minE, 1)
  const rangeN = Math.max(bounds.maxN - bounds.minN, 1)
  const scale = Math.min(
    (width - padding * 2) / rangeE,
    (height - padding * 2) / rangeN,
  )
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

function interpolateTriangle(
  triangle: SurfaceTriangle,
  easting: number,
  northing: number,
): number | null | undefined {
  const { a, b, c } = triangle
  const denominator =
    (b.northing - c.northing) *
      (a.easting - c.easting) +
    (c.easting - b.easting) *
      (a.northing - c.northing)

  if (Math.abs(denominator) < 0.000000000001) {
    return undefined
  }

  const weightA =
    ((b.northing - c.northing) *
      (easting - c.easting) +
      (c.easting - b.easting) *
        (northing - c.northing)) /
    denominator
  const weightB =
    ((c.northing - a.northing) *
      (easting - c.easting) +
      (a.easting - c.easting) *
        (northing - c.northing)) /
    denominator
  const weightC = 1 - weightA - weightB

  if (
    weightA < -0.000001 ||
    weightB < -0.000001 ||
    weightC < -0.000001
  ) {
    return undefined
  }

  if (
    a.elevation === null ||
    b.elevation === null ||
    c.elevation === null
  ) {
    return null
  }

  return (
    weightA * a.elevation +
    weightB * b.elevation +
    weightC * c.elevation
  )
}

function createSurfaceIndex(surface: LandXmlSurface) {
  const triangles: SurfaceTriangle[] = []

  surface.faces.forEach((face) => {
    const a = surface.points[face[0]]
    const b = surface.points[face[1]]
    const c = surface.points[face[2]]

    if (!a || !b || !c) {
      return
    }

    triangles.push({
      a,
      b,
      c,
      minEasting: Math.min(a.easting, b.easting, c.easting),
      maxEasting: Math.max(a.easting, b.easting, c.easting),
      minNorthing: Math.min(
        a.northing,
        b.northing,
        c.northing,
      ),
      maxNorthing: Math.max(
        a.northing,
        b.northing,
        c.northing,
      ),
    })
  })

  if (triangles.length === 0) {
    return {
      find: () => null,
    }
  }

  const minEasting = Math.min(
    ...triangles.map((triangle) => triangle.minEasting),
  )
  const maxEasting = Math.max(
    ...triangles.map((triangle) => triangle.maxEasting),
  )
  const minNorthing = Math.min(
    ...triangles.map((triangle) => triangle.minNorthing),
  )
  const maxNorthing = Math.max(
    ...triangles.map((triangle) => triangle.maxNorthing),
  )
  const dimension = clamp(
    Math.ceil(Math.sqrt(triangles.length / 6)),
    8,
    120,
  )
  const cellWidth = Math.max(
    (maxEasting - minEasting) / dimension,
    0.000001,
  )
  const cellHeight = Math.max(
    (maxNorthing - minNorthing) / dimension,
    0.000001,
  )
  const cells = new Map<string, SurfaceTriangle[]>()

  function cellIndex(
    value: number,
    minimum: number,
    size: number,
  ) {
    return clamp(
      Math.floor((value - minimum) / size),
      0,
      dimension - 1,
    )
  }

  triangles.forEach((triangle) => {
    const startX = cellIndex(
      triangle.minEasting,
      minEasting,
      cellWidth,
    )
    const endX = cellIndex(
      triangle.maxEasting,
      minEasting,
      cellWidth,
    )
    const startY = cellIndex(
      triangle.minNorthing,
      minNorthing,
      cellHeight,
    )
    const endY = cellIndex(
      triangle.maxNorthing,
      minNorthing,
      cellHeight,
    )

    for (let x = startX; x <= endX; x += 1) {
      for (let y = startY; y <= endY; y += 1) {
        const key = `${x}:${y}`
        const existing = cells.get(key)

        if (existing) {
          existing.push(triangle)
        } else {
          cells.set(key, [triangle])
        }
      }
    }
  })

  return {
    find(easting: number, northing: number) {
      if (
        easting < minEasting ||
        easting > maxEasting ||
        northing < minNorthing ||
        northing > maxNorthing
      ) {
        return null
      }

      const x = cellIndex(easting, minEasting, cellWidth)
      const y = cellIndex(northing, minNorthing, cellHeight)
      const candidates = cells.get(`${x}:${y}`) ?? []

      for (const triangle of candidates) {
        const value = interpolateTriangle(
          triangle,
          easting,
          northing,
        )

        if (value !== undefined) {
          return value
        }
      }

      return null
    },
  }
}

function stationAt(
  alignment: LandXmlAlignment | undefined,
  point: PlanPoint,
): StationResult | null {
  if (!alignment || alignment.points.length < 2) {
    return null
  }

  let travelled = 0
  let best: StationResult | null = null

  for (
    let index = 1;
    index < alignment.points.length;
    index += 1
  ) {
    const a = alignment.points[index - 1]
    const b = alignment.points[index]
    const dx = b.easting - a.easting
    const dy = b.northing - a.northing
    const lengthSquared = dx * dx + dy * dy

    if (lengthSquared === 0) {
      continue
    }

    const t = clamp(
      ((point.easting - a.easting) * dx +
        (point.northing - a.northing) * dy) /
        lengthSquared,
      0,
      1,
    )
    const easting = a.easting + dx * t
    const northing = a.northing + dy * t
    const distance = Math.hypot(
      point.easting - easting,
      point.northing - northing,
    )
    const cross =
      dx * (point.northing - northing) -
      dy * (point.easting - easting)
    const segmentLength = Math.sqrt(lengthSquared)

    if (!best || distance < best.distance) {
      best = {
        distance,
        chainage:
          (alignment.startStation ?? 0) +
          travelled +
          segmentLength * t,
        offset: Math.sign(cross || 1) * distance,
        sectionDistance: null,
      }
    }

    travelled += segmentLength
  }

  return best
}

function cross2d(
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  return ax * by - ay * bx
}

function stationForSection(
  alignment: LandXmlAlignment | undefined,
  line: SectionLine,
): StationResult | null {
  if (!alignment || alignment.points.length < 2) {
    return null
  }

  const sectionX = line.end.easting - line.start.easting
  const sectionY = line.end.northing - line.start.northing
  const sectionLength = Math.hypot(sectionX, sectionY)
  let travelled = 0

  for (
    let index = 1;
    index < alignment.points.length;
    index += 1
  ) {
    const a = alignment.points[index - 1]
    const b = alignment.points[index]
    const alignmentX = b.easting - a.easting
    const alignmentY = b.northing - a.northing
    const denominator = cross2d(
      alignmentX,
      alignmentY,
      sectionX,
      sectionY,
    )
    const segmentLength = Math.hypot(alignmentX, alignmentY)

    if (Math.abs(denominator) > 0.000000001) {
      const deltaX = line.start.easting - a.easting
      const deltaY = line.start.northing - a.northing
      const alignmentRatio =
        cross2d(deltaX, deltaY, sectionX, sectionY) /
        denominator
      const sectionRatio =
        cross2d(deltaX, deltaY, alignmentX, alignmentY) /
        denominator

      if (
        alignmentRatio >= -0.000001 &&
        alignmentRatio <= 1.000001 &&
        sectionRatio >= -0.000001 &&
        sectionRatio <= 1.000001
      ) {
        return {
          chainage:
            (alignment.startStation ?? 0) +
            travelled +
            segmentLength * alignmentRatio,
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

  return fallback
    ? {
        ...fallback,
        sectionDistance: sectionLength / 2,
      }
    : null
}

function formatChainage(value: number | null) {
  if (value === null) {
    return "—"
  }

  const kilometres = Math.floor(value / 1000)
  return `${kilometres}+${(value - kilometres * 1000)
    .toFixed(3)
    .padStart(7, "0")}`
}

function calculateThickness(
  samples: Sample[],
  topIndex: number,
  bottomIndex: number,
): ThicknessStats | null {
  if (topIndex < 0 || bottomIndex < 0) {
    return null
  }

  const values = samples
    .map((sample) => {
      const top = sample.values[topIndex]
      const bottom = sample.values[bottomIndex]

      return top !== null && bottom !== null
        ? (top - bottom) * 1000
        : null
    })
    .filter((value): value is number => value !== null)

  if (values.length === 0) {
    return null
  }

  return {
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    average:
      values.reduce((sum, value) => sum + value, 0) /
      values.length,
    sampleCount: values.length,
  }
}

export default function LandXmlCrossSection({
  document,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{
    pointerId: number
    start: PlanPoint
  } | null>(null)
  const [alignmentName, setAlignmentName] = useState(
    document.alignments[0]?.name ?? "",
  )
  const [topSurfaceName, setTopSurfaceName] = useState(
    document.surfaces[0]?.name ?? "",
  )
  const [bottomSurfaceName, setBottomSurfaceName] = useState(
    document.surfaces[1]?.name ??
      document.surfaces[0]?.name ??
      "",
  )
  const [line, setLine] = useState<SectionLine | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [showResult, setShowResult] = useState(false)
  const bounds = useMemo(() => boundsFor(document), [document])
  const mapProjection = useMemo(
    () => (bounds ? projection(bounds) : null),
    [bounds],
  )
  const surfaceIndexes = useMemo(
    () => document.surfaces.map(createSurfaceIndex),
    [document.surfaces],
  )
  const alignment = document.alignments.find(
    (item) => item.name === alignmentName,
  )

  useEffect(() => {
    const alignmentNames = document.alignments.map(
      (item) => item.name,
    )

    if (alignmentNames.length === 0) {
      if (alignmentName !== "") {
        setAlignmentName("")
      }
      return
    }

    if (!alignmentNames.includes(alignmentName)) {
      setAlignmentName(alignmentNames[0])
    }
  }, [alignmentName, document.alignments])

  useEffect(() => {
    const surfaceNames = document.surfaces.map(
      (surface) => surface.name,
    )

    if (!surfaceNames.includes(topSurfaceName)) {
      setTopSurfaceName(surfaceNames[0] ?? "")
    }

    if (!surfaceNames.includes(bottomSurfaceName)) {
      setBottomSurfaceName(
        surfaceNames[1] ?? surfaceNames[0] ?? "",
      )
    }
  }, [
    bottomSurfaceName,
    document.surfaces,
    topSurfaceName,
  ])

  const result = useMemo(() => {
    if (!line) {
      return null
    }

    const length = Math.hypot(
      line.end.easting - line.start.easting,
      line.end.northing - line.start.northing,
    )
    const samples: Sample[] = Array.from(
      { length: samplesCount + 1 },
      (_, index) => {
        const ratio = index / samplesCount
        const easting =
          line.start.easting +
          (line.end.easting - line.start.easting) * ratio
        const northing =
          line.start.northing +
          (line.end.northing - line.start.northing) * ratio

        return {
          distance: length * ratio,
          values: surfaceIndexes.map((surfaceIndex) =>
            surfaceIndex.find(easting, northing),
          ),
        }
      },
    )

    return {
      length,
      samples,
      station: stationForSection(alignment, line),
    }
  }, [alignment, line, surfaceIndexes])

  const thickness = useMemo(() => {
    if (!result) {
      return null
    }

    return calculateThickness(
      result.samples,
      document.surfaces.findIndex(
        (surface) => surface.name === topSurfaceName,
      ),
      document.surfaces.findIndex(
        (surface) => surface.name === bottomSurfaceName,
      ),
    )
  }, [
    bottomSurfaceName,
    document.surfaces,
    result,
    topSurfaceName,
  ])

  function pointFromEvent(
    event: ReactPointerEvent<SVGSVGElement>,
  ) {
    if (!svgRef.current || !mapProjection) {
      return null
    }

    const rect = svgRef.current.getBoundingClientRect()

    return mapProjection.unproject({
      x:
        ((event.clientX - rect.left) / rect.width) *
        width,
      y:
        ((event.clientY - rect.top) / rect.height) *
        height,
    })
  }

  function pointerDown(
    event: ReactPointerEvent<SVGSVGElement>,
  ) {
    if (event.button !== 0) {
      return
    }

    const point = pointFromEvent(event)
    if (!point) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      start: point,
    }
    setIsDrawing(true)
    setLine({ start: point, end: point })
    setShowResult(false)
  }

  function pointerMove(
    event: ReactPointerEvent<SVGSVGElement>,
  ) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    const point = pointFromEvent(event)
    if (point) {
      setLine({ start: drag.start, end: point })
    }
  }

  function finishPointer(
    event: ReactPointerEvent<SVGSVGElement>,
    cancelled = false,
  ) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    const end = pointFromEvent(event) ?? drag.start
    const finalLine = {
      start: drag.start,
      end,
    }
    const length = Math.hypot(
      finalLine.end.easting - finalLine.start.easting,
      finalLine.end.northing - finalLine.start.northing,
    )

    dragRef.current = null
    setIsDrawing(false)

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    if (cancelled || length <= 0.05) {
      setLine(null)
      setShowResult(false)
      return
    }

    setLine(finalLine)
    setShowResult(true)
  }

  const projectedLine =
    line && mapProjection
      ? {
          start: mapProjection.project(line.start),
          end: mapProjection.project(line.end),
        }
      : null

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
            Cross-section map
          </p>
          <h2 className="mt-2 text-2xl font-semibold">
            Drag across the surface
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Press and drag from one side of the pavement to the
            other. The section line remains visible while drawing.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <SelectControl
            label="Alignment for chainage"
            value={alignmentName}
            onChange={setAlignmentName}
            options={document.alignments.map((item) => item.name)}
            emptyLabel="No alignment"
          />
          <SelectControl
            label="Top surface"
            value={topSurfaceName}
            onChange={setTopSurfaceName}
            options={document.surfaces.map((item) => item.name)}
          />
          <SelectControl
            label="Bottom surface"
            value={bottomSurfaceName}
            onChange={setBottomSurfaceName}
            options={document.surfaces.map((item) => item.name)}
          />
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
            onPointerCancel={(event) =>
              finishPointer(event, true)
            }
            className={`block aspect-[1000/620] w-full select-none ${
              isDrawing ? "cursor-grabbing" : "cursor-crosshair"
            }`}
            style={{ touchAction: "none" }}
          >
            <rect width={width} height={height} fill="#020617" />

            {document.surfaces.map(
              (surface, surfaceIndex) => {
                const faceStep = Math.max(
                  1,
                  Math.ceil(surface.faces.length / 3000),
                )

                return (
                  <g key={surface.name}>
                    {surface.faces
                      .filter(
                        (_, index) => index % faceStep === 0,
                      )
                      .map((face, index) => {
                        const points = face
                          .map((id) => surface.points[id])
                          .filter(
                            (point): point is PlanPoint =>
                              point !== undefined,
                          )

                        if (points.length !== 3) {
                          return null
                        }

                        return (
                          <polygon
                            key={`${surface.name}-${index}`}
                            points={points
                              .map((point) => {
                                const projected =
                                  mapProjection.project(point)
                                return `${projected.x},${projected.y}`
                              })
                              .join(" ")}
                            fill={
                              colours[
                                surfaceIndex % colours.length
                              ]
                            }
                            fillOpacity="0.12"
                            stroke={
                              colours[
                                surfaceIndex % colours.length
                              ]
                            }
                            strokeOpacity="0.45"
                            strokeWidth="0.8"
                            vectorEffect="non-scaling-stroke"
                          />
                        )
                      })}
                  </g>
                )
              },
            )}

            {document.alignments.map((item) => (
              <polyline
                key={item.name}
                points={item.points
                  .map((point) => {
                    const projected =
                      mapProjection.project(point)
                    return `${projected.x},${projected.y}`
                  })
                  .join(" ")}
                fill="none"
                stroke={
                  item.name === alignmentName
                    ? "#fbbf24"
                    : "#64748b"
                }
                strokeWidth={
                  item.name === alignmentName ? 4 : 2
                }
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {projectedLine && (
              <g pointerEvents="none">
                <line
                  x1={projectedLine.start.x}
                  y1={projectedLine.start.y}
                  x2={projectedLine.end.x}
                  y2={projectedLine.end.y}
                  stroke="#fb7185"
                  strokeWidth="5"
                  strokeDasharray="12 7"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={projectedLine.start.x}
                  cy={projectedLine.start.y}
                  r="7"
                  fill="#fb7185"
                  stroke="white"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={projectedLine.end.x}
                  cy={projectedLine.end.y}
                  r="7"
                  fill="#fb7185"
                  stroke="white"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}
          </svg>
        ) : (
          <div className="flex aspect-[1000/620] items-center justify-center text-slate-500">
            No readable geometry.
          </div>
        )}
      </div>

      {result && !showResult && (
        <button
          type="button"
          onClick={() => setShowResult(true)}
          className="mt-4 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
        >
          Open cross section
        </button>
      )}

      {showResult && result && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowResult(false)
            }
          }}
        >
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-3xl border border-white/15 bg-slate-950 p-6 shadow-2xl md:p-8">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
                  Cross section
                </p>
                <h3 className="mt-2 text-2xl font-semibold">
                  CH {formatChainage(result.station?.chainage ?? null)}
                </h3>
                <p className="mt-2 text-sm text-slate-400">
                  Section length {result.length.toFixed(3)} m ·
                  Alignment offset {" "}
                  {result.station
                    ? `${result.station.offset.toFixed(3)} m`
                    : "—"}
                  {result.station?.sectionDistance !== null &&
                  result.station?.sectionDistance !== undefined
                    ? ` · Alignment at section offset ${result.station.sectionDistance.toFixed(3)} m`
                    : ""}
                </p>
              </div>

              <button
                type="button"
                aria-label="Close cross section"
                onClick={() => setShowResult(false)}
                className="rounded-xl border border-white/10 p-2 text-slate-300 transition hover:bg-white/10"
              >
                <X size={20} />
              </button>
            </div>

            <ThicknessSummary
              stats={thickness}
              topSurfaceName={topSurfaceName}
              bottomSurfaceName={bottomSurfaceName}
            />

            <ProfileChart
              surfaces={document.surfaces}
              samples={result.samples}
              length={result.length}
            />
          </div>
        </div>
      )}
    </section>
  )
}

type SelectControlProps = {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
  emptyLabel?: string
}

function SelectControl({
  label,
  value,
  onChange,
  options,
  emptyLabel,
}: SelectControlProps) {
  return (
    <label className="text-sm text-slate-300">
      <span className="mb-2 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full min-w-48 rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-cyan-400"
      >
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function ThicknessSummary({
  stats,
  topSurfaceName,
  bottomSurfaceName,
}: {
  stats: ThicknessStats | null
  topSurfaceName: string
  bottomSurfaceName: string
}) {
  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
      <div>
        <h4 className="font-semibold">Layer thickness</h4>
        <p className="mt-1 text-sm text-slate-400">
          {topSurfaceName || "Top surface"} minus {" "}
          {bottomSurfaceName || "bottom surface"}
        </p>
      </div>

      {stats ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Minimum"
            value={`${stats.minimum.toFixed(0)} mm`}
          />
          <StatCard
            label="Average"
            value={`${stats.average.toFixed(0)} mm`}
          />
          <StatCard
            label="Maximum"
            value={`${stats.maximum.toFixed(0)} mm`}
          />
        </div>
      ) : (
        <p className="mt-4 text-sm text-amber-200">
          The selected surfaces do not overlap along this section.
        </p>
      )}
    </section>
  )
}

function StatCard({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-white">
        {value}
      </p>
    </div>
  )
}

function ProfileChart({
  surfaces,
  samples,
  length,
}: {
  surfaces: LandXmlSurface[]
  samples: Sample[]
  length: number
}) {
  const values = samples
    .flatMap((sample) => sample.values)
    .filter((value): value is number => value !== null)

  if (values.length === 0) {
    return (
      <p className="mt-8 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-amber-200">
        The section line does not cross a readable TIN face.
      </p>
    )
  }

  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const range = Math.max(maximum - minimum, 0.1)
  const chartWidth = 900
  const chartHeight = 430
  const inset = 55

  return (
    <div className="mt-7">
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="w-full rounded-2xl border border-white/10 bg-slate-900/60"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y =
            inset + ratio * (chartHeight - inset * 2)
          const level = maximum - ratio * range

          return (
            <g key={ratio}>
              <line
                x1={inset}
                y1={y}
                x2={chartWidth - inset}
                y2={y}
                stroke="#334155"
              />
              <text
                x={8}
                y={y + 4}
                fill="#94a3b8"
                fontSize="12"
              >
                {level.toFixed(3)}
              </text>
            </g>
          )
        })}

        {surfaces.map((surface, surfaceIndex) => {
          const segments: string[] = []
          let current = ""

          samples.forEach((sample) => {
            const value = sample.values[surfaceIndex]

            if (value === null) {
              if (current) {
                segments.push(current)
              }
              current = ""
              return
            }

            const x =
              inset +
              (sample.distance / Math.max(length, 0.001)) *
                (chartWidth - inset * 2)
            const y =
              inset +
              ((maximum - value) / range) *
                (chartHeight - inset * 2)

            current += `${current ? " L" : "M"}${x.toFixed(
              2,
            )} ${y.toFixed(2)}`
          })

          if (current) {
            segments.push(current)
          }

          return (
            <g key={surface.name}>
              {segments.map((path, index) => (
                <path
                  key={index}
                  d={path}
                  fill="none"
                  stroke={
                    colours[surfaceIndex % colours.length]
                  }
                  strokeWidth="3"
                />
              ))}
            </g>
          )
        })}
      </svg>

      <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-300">
        {surfaces.map((surface, index) => (
          <span
            key={surface.name}
            className="inline-flex items-center gap-2"
          >
            <span
              className="h-2.5 w-6 rounded-full"
              style={{
                background: colours[index % colours.length],
              }}
            />
            {surface.name}
          </span>
        ))}
      </div>
    </div>
  )
}
