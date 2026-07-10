import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type {
  PointerEvent as ReactPointerEvent,
  ReactNode,
  WheelEvent as ReactWheelEvent,
} from "react"
import {
  Maximize2,
  Minus,
  Plus,
} from "lucide-react"

import type {
  LandXmlDocument,
  LandXmlSurface,
  PlanPoint,
} from "../lib/landxml"

type LandXmlPreviewProps = {
  document: LandXmlDocument
}

type Bounds = {
  minEasting: number
  maxEasting: number
  minNorthing: number
  maxNorthing: number
}

type ViewBox = {
  x: number
  y: number
  width: number
  height: number
}

type TinTriangle = {
  surfaceName: string
  a: PlanPoint
  b: PlanPoint
  c: PlanPoint
  minEasting: number
  maxEasting: number
  minNorthing: number
  maxNorthing: number
}

type SurfaceHit = {
  surfaceName: string
  elevation: number | null
}

type HoverInfo = SurfaceHit & {
  easting: number
  northing: number
  svgX: number
  svgY: number
  left: number
  top: number
}

type PanState = {
  pointerId: number
  clientX: number
  clientY: number
  viewBox: ViewBox
}

const surfaceColours = [
  "#22d3ee",
  "#60a5fa",
  "#a78bfa",
  "#34d399",
  "#f472b6",
]

const previewWidth = 1000
const previewHeight = 620
const previewPadding = 34
const maximumPreviewFaces = 3500
const fitViewBox: ViewBox = {
  x: 0,
  y: 0,
  width: previewWidth,
  height: previewHeight,
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function getSurfacePoints(surface: LandXmlSurface) {
  return Object.values(surface.points)
}

function calculateBounds(points: PlanPoint[]): Bounds | null {
  if (points.length === 0) {
    return null
  }

  let minEasting = Number.POSITIVE_INFINITY
  let maxEasting = Number.NEGATIVE_INFINITY
  let minNorthing = Number.POSITIVE_INFINITY
  let maxNorthing = Number.NEGATIVE_INFINITY

  points.forEach((point) => {
    minEasting = Math.min(minEasting, point.easting)
    maxEasting = Math.max(maxEasting, point.easting)
    minNorthing = Math.min(minNorthing, point.northing)
    maxNorthing = Math.max(maxNorthing, point.northing)
  })

  return {
    minEasting,
    maxEasting,
    minNorthing,
    maxNorthing,
  }
}

function createProjection(bounds: Bounds) {
  const eastingRange = Math.max(
    bounds.maxEasting - bounds.minEasting,
    1,
  )
  const northingRange = Math.max(
    bounds.maxNorthing - bounds.minNorthing,
    1,
  )
  const usableWidth = previewWidth - previewPadding * 2
  const usableHeight = previewHeight - previewPadding * 2
  const scale = Math.min(
    usableWidth / eastingRange,
    usableHeight / northingRange,
  )
  const renderedWidth = eastingRange * scale
  const renderedHeight = northingRange * scale
  const offsetX = (previewWidth - renderedWidth) / 2
  const offsetY = (previewHeight - renderedHeight) / 2

  return {
    project(point: PlanPoint) {
      return {
        x:
          offsetX +
          (point.easting - bounds.minEasting) * scale,
        y:
          offsetY +
          (bounds.maxNorthing - point.northing) * scale,
      }
    },
    unproject(x: number, y: number) {
      return {
        easting:
          bounds.minEasting + (x - offsetX) / scale,
        northing:
          bounds.maxNorthing - (y - offsetY) / scale,
      }
    },
  }
}

function interpolateTriangle(
  triangle: TinTriangle,
  easting: number,
  northing: number,
): SurfaceHit | null {
  const { a, b, c } = triangle
  const denominator =
    (b.northing - c.northing) *
      (a.easting - c.easting) +
    (c.easting - b.easting) *
      (a.northing - c.northing)

  if (Math.abs(denominator) < 0.0000000001) {
    return null
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
  const tolerance = -0.000001

  if (
    weightA < tolerance ||
    weightB < tolerance ||
    weightC < tolerance
  ) {
    return null
  }

  const elevation =
    a.elevation !== null &&
    b.elevation !== null &&
    c.elevation !== null
      ? weightA * a.elevation +
        weightB * b.elevation +
        weightC * c.elevation
      : null

  return {
    surfaceName: triangle.surfaceName,
    elevation,
  }
}

function createTinIndex(surfaces: LandXmlSurface[]) {
  const triangles: TinTriangle[] = []

  surfaces.forEach((surface) => {
    surface.faces.forEach((face) => {
      const a = surface.points[face[0]]
      const b = surface.points[face[1]]
      const c = surface.points[face[2]]

      if (!a || !b || !c) {
        return
      }

      triangles.push({
        surfaceName: surface.name,
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
  })

  if (triangles.length === 0) {
    return null
  }

  let minEasting = Number.POSITIVE_INFINITY
  let maxEasting = Number.NEGATIVE_INFINITY
  let minNorthing = Number.POSITIVE_INFINITY
  let maxNorthing = Number.NEGATIVE_INFINITY

  triangles.forEach((triangle) => {
    minEasting = Math.min(minEasting, triangle.minEasting)
    maxEasting = Math.max(maxEasting, triangle.maxEasting)
    minNorthing = Math.min(minNorthing, triangle.minNorthing)
    maxNorthing = Math.max(maxNorthing, triangle.maxNorthing)
  })

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
  const cells = new Map<string, TinTriangle[]>()

  function cellIndex(value: number, minimum: number, size: number) {
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
        const cell = cells.get(key)
        if (cell) {
          cell.push(triangle)
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
        const hit = interpolateTriangle(
          triangle,
          easting,
          northing,
        )
        if (hit) {
          return hit
        }
      }

      return null
    },
  }
}

function formatCoordinate(value: number) {
  return new Intl.NumberFormat("en-NZ", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
    useGrouping: false,
  }).format(value)
}

export default function LandXmlPreview({
  document,
}: LandXmlPreviewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const panRef = useRef<PanState | null>(null)
  const hoverFrameRef = useRef<number | null>(null)
  const [selectedSurface, setSelectedSurface] = useState("all")
  const [showSurfaces, setShowSurfaces] = useState(true)
  const [showVertices, setShowVertices] = useState(false)
  const [showAlignments, setShowAlignments] = useState(true)
  const [showCogoPoints, setShowCogoPoints] = useState(true)
  const [viewBox, setViewBox] = useState<ViewBox>(fitViewBox)
  const [isPanning, setIsPanning] = useState(false)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)

  const visibleSurfaces = useMemo(
    () =>
      selectedSurface === "all"
        ? document.surfaces
        : document.surfaces.filter(
            (surface) => surface.name === selectedSurface,
          ),
    [document.surfaces, selectedSurface],
  )

  const bounds = useMemo(() => {
    const points: PlanPoint[] = []

    if (showSurfaces || showVertices) {
      visibleSurfaces.forEach((surface) => {
        getSurfacePoints(surface).forEach((point) =>
          points.push(point),
        )
      })
    }

    if (showAlignments) {
      document.alignments.forEach((alignment) => {
        alignment.points.forEach((point) => points.push(point))
      })
    }

    if (showCogoPoints) {
      document.cogoPoints.forEach((point) => points.push(point))
    }

    return calculateBounds(points)
  }, [
    document.alignments,
    document.cogoPoints,
    showAlignments,
    showCogoPoints,
    showSurfaces,
    showVertices,
    visibleSurfaces,
  ])

  const projection = useMemo(
    () => (bounds ? createProjection(bounds) : null),
    [bounds],
  )
  const tinIndex = useMemo(
    () => createTinIndex(visibleSurfaces),
    [visibleSurfaces],
  )

  useEffect(() => {
    setSelectedSurface("all")
  }, [document])

  useEffect(() => {
    setViewBox(fitViewBox)
    setHoverInfo(null)
  }, [bounds])

  useEffect(
    () => () => {
      if (hoverFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverFrameRef.current)
      }
    },
    [],
  )

  const totalFaces = visibleSurfaces.reduce(
    (sum, surface) => sum + surface.faces.length,
    0,
  )
  const faceStep = Math.max(
    1,
    Math.ceil(totalFaces / maximumPreviewFaces),
  )
  const zoomPercent = Math.round(
    (previewWidth / viewBox.width) * 100,
  )

  function zoomAt(factor: number, focusX: number, focusY: number) {
    setViewBox((current) => {
      const width = clamp(current.width * factor, 70, 2400)
      const height = width * (previewHeight / previewWidth)
      const widthRatio = width / current.width
      const heightRatio = height / current.height

      return {
        x: focusX - (focusX - current.x) * widthRatio,
        y: focusY - (focusY - current.y) * heightRatio,
        width,
        height,
      }
    })
    setHoverInfo(null)
  }

  function zoomFromCentre(factor: number) {
    zoomAt(
      factor,
      viewBox.x + viewBox.width / 2,
      viewBox.y + viewBox.height / 2,
    )
  }

  function clientToSvg(clientX: number, clientY: number) {
    const svg = svgRef.current
    if (!svg) {
      return null
    }

    const rect = svg.getBoundingClientRect()
    return {
      x:
        viewBox.x +
        ((clientX - rect.left) / rect.width) * viewBox.width,
      y:
        viewBox.y +
        ((clientY - rect.top) / rect.height) * viewBox.height,
      rect,
    }
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault()
    const point = clientToSvg(event.clientX, event.clientY)
    if (!point) {
      return
    }

    zoomAt(event.deltaY > 0 ? 1.18 : 0.84, point.x, point.y)
  }

  function handlePointerDown(
    event: ReactPointerEvent<SVGSVGElement>,
  ) {
    if (event.button !== 0) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    panRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      viewBox,
    }
    setIsPanning(true)
    setHoverInfo(null)
  }

  function updateHover(clientX: number, clientY: number) {
    if (
      !projection ||
      !tinIndex ||
      (!showSurfaces && !showVertices)
    ) {
      setHoverInfo(null)
      return
    }

    const point = clientToSvg(clientX, clientY)
    if (!point) {
      return
    }

    const coordinate = projection.unproject(point.x, point.y)
    const hit = tinIndex.find(
      coordinate.easting,
      coordinate.northing,
    )

    if (!hit) {
      setHoverInfo(null)
      return
    }

    setHoverInfo({
      ...hit,
      ...coordinate,
      svgX: point.x,
      svgY: point.y,
      left: clamp(
        clientX - point.rect.left + 14,
        8,
        Math.max(8, point.rect.width - 238),
      ),
      top: clamp(
        clientY - point.rect.top - 104,
        8,
        Math.max(8, point.rect.height - 118),
      ),
    })
  }

  function handlePointerMove(
    event: ReactPointerEvent<SVGSVGElement>,
  ) {
    const pan = panRef.current
    const svg = svgRef.current

    if (pan && svg) {
      const rect = svg.getBoundingClientRect()
      const deltaX =
        ((event.clientX - pan.clientX) / rect.width) *
        pan.viewBox.width
      const deltaY =
        ((event.clientY - pan.clientY) / rect.height) *
        pan.viewBox.height

      setViewBox({
        ...pan.viewBox,
        x: pan.viewBox.x - deltaX,
        y: pan.viewBox.y - deltaY,
      })
      return
    }

    if (hoverFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverFrameRef.current)
    }

    hoverFrameRef.current = window.requestAnimationFrame(() => {
      updateHover(event.clientX, event.clientY)
      hoverFrameRef.current = null
    })
  }

  function finishPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null
      setIsPanning(false)
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">
            Plan preview
          </p>
          <h2 className="mt-2 text-2xl font-semibold">
            LandXML geometry
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Scroll to zoom, drag to pan and hover over a TIN face
            for interpolated coordinates and RL.
          </p>
        </div>

        {document.surfaces.length > 1 && (
          <label className="text-sm text-slate-300">
            <span className="mb-2 block">Surface</span>
            <select
              value={selectedSurface}
              onChange={(event) =>
                setSelectedSurface(event.target.value)
              }
              className="min-w-56 rounded-xl border border-white/10 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-cyan-400"
            >
              <option value="all">All surfaces</option>
              {document.surfaces.map((surface) => (
                <option key={surface.name} value={surface.name}>
                  {surface.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <LayerToggle
          label="TIN faces"
          checked={showSurfaces}
          onChange={setShowSurfaces}
        />
        <LayerToggle
          label="TIN vertices"
          checked={showVertices}
          onChange={setShowVertices}
        />
        <LayerToggle
          label="Alignments"
          checked={showAlignments}
          onChange={setShowAlignments}
        />
        <LayerToggle
          label="COGO points"
          checked={showCogoPoints}
          onChange={setShowCogoPoints}
        />
      </div>

      <div className="relative mt-5 overflow-hidden rounded-2xl border border-white/10 bg-[#020617]">
        {bounds && projection ? (
          <>
            <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-xl border border-white/10 bg-slate-950/90 p-1.5 shadow-xl backdrop-blur">
              <ToolButton
                label="Zoom in"
                onClick={() => zoomFromCentre(0.8)}
              >
                <Plus size={17} />
              </ToolButton>
              <span className="min-w-14 text-center text-xs font-semibold text-slate-300">
                {zoomPercent}%
              </span>
              <ToolButton
                label="Zoom out"
                onClick={() => zoomFromCentre(1.25)}
              >
                <Minus size={17} />
              </ToolButton>
              <ToolButton
                label="Fit to view"
                onClick={() => {
                  setViewBox(fitViewBox)
                  setHoverInfo(null)
                }}
              >
                <Maximize2 size={16} />
              </ToolButton>
            </div>

            <svg
              ref={svgRef}
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
              role="img"
              aria-label="Interactive plan preview of the loaded LandXML geometry"
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishPan}
              onPointerCancel={finishPan}
              onPointerLeave={() => {
                if (!panRef.current) {
                  setHoverInfo(null)
                }
              }}
              className={`block aspect-[1000/620] w-full select-none ${
                isPanning ? "cursor-grabbing" : "cursor-crosshair"
              }`}
              style={{ touchAction: "none" }}
            >
              <defs>
                <pattern
                  id="landxml-grid"
                  width="50"
                  height="50"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 50 0 L 0 0 0 50"
                    fill="none"
                    stroke="rgba(148,163,184,0.10)"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                  />
                </pattern>
              </defs>

              <rect
                x={viewBox.x}
                y={viewBox.y}
                width={viewBox.width}
                height={viewBox.height}
                fill="url(#landxml-grid)"
              />

              {showSurfaces &&
                visibleSurfaces.map((surface, surfaceIndex) => {
                  const colour =
                    surfaceColours[
                      surfaceIndex % surfaceColours.length
                    ]
                  const elevationRange = Math.max(
                    (surface.maxElevation ?? 0) -
                      (surface.minElevation ?? 0),
                    0.001,
                  )

                  return (
                    <g key={surface.name}>
                      {surface.faces
                        .filter(
                          (_, faceIndex) =>
                            faceIndex % faceStep === 0,
                        )
                        .map((face, faceIndex) => {
                          const facePoints = face
                            .map((id) => surface.points[id])
                            .filter(
                              (point): point is PlanPoint =>
                                point !== undefined,
                            )

                          if (facePoints.length !== 3) {
                            return null
                          }

                          const averageElevation =
                            facePoints.reduce(
                              (sum, point) =>
                                sum + (point.elevation ?? 0),
                              0,
                            ) / 3
                          const elevationRatio =
                            surface.minElevation === null
                              ? 0.5
                              : (averageElevation -
                                  surface.minElevation) /
                                elevationRange

                          return (
                            <polygon
                              key={`${surface.name}-${faceIndex}`}
                              points={facePoints
                                .map((point) => {
                                  const projected =
                                    projection.project(point)
                                  return `${projected.x},${projected.y}`
                                })
                                .join(" ")}
                              fill={colour}
                              fillOpacity={
                                0.16 + elevationRatio * 0.28
                              }
                              stroke={colour}
                              strokeOpacity="0.5"
                              strokeWidth="0.7"
                              vectorEffect="non-scaling-stroke"
                            />
                          )
                        })}
                    </g>
                  )
                })}

              {showVertices &&
                visibleSurfaces.map((surface, surfaceIndex) => {
                  const colour =
                    surfaceColours[
                      surfaceIndex % surfaceColours.length
                    ]
                  const points = getSurfacePoints(surface)
                  const pointStep = Math.max(
                    1,
                    Math.ceil(points.length / 5000),
                  )

                  return (
                    <g key={`${surface.name}-vertices`}>
                      {points
                        .filter(
                          (_, pointIndex) =>
                            pointIndex % pointStep === 0,
                        )
                        .map((point, pointIndex) => {
                          const projected =
                            projection.project(point)
                          return (
                            <circle
                              key={`${surface.name}-point-${pointIndex}`}
                              cx={projected.x}
                              cy={projected.y}
                              r="1.8"
                              fill={colour}
                              fillOpacity="0.9"
                            />
                          )
                        })}
                    </g>
                  )
                })}

              {showAlignments &&
                document.alignments.map((alignment) => (
                  <polyline
                    key={alignment.name}
                    points={alignment.points
                      .map((point) => {
                        const projected = projection.project(point)
                        return `${projected.x},${projected.y}`
                      })
                      .join(" ")}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}

              {showCogoPoints &&
                document.cogoPoints.map((point) => {
                  const projected = projection.project(point)
                  return (
                    <circle
                      key={`${point.name}-${point.easting}-${point.northing}`}
                      cx={projected.x}
                      cy={projected.y}
                      r="4"
                      fill="#f472b6"
                      stroke="#fdf2f8"
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  )
                })}

              {hoverInfo && (
                <g pointerEvents="none">
                  <line
                    x1={hoverInfo.svgX - 12}
                    y1={hoverInfo.svgY}
                    x2={hoverInfo.svgX + 12}
                    y2={hoverInfo.svgY}
                    stroke="#f8fafc"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={hoverInfo.svgX}
                    y1={hoverInfo.svgY - 12}
                    x2={hoverInfo.svgX}
                    y2={hoverInfo.svgY + 12}
                    stroke="#f8fafc"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={hoverInfo.svgX}
                    cy={hoverInfo.svgY}
                    r="4"
                    fill="#020617"
                    stroke="#f8fafc"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}
            </svg>

            {hoverInfo && (
              <div
                className="pointer-events-none absolute z-30 w-[230px] rounded-xl border border-cyan-300/30 bg-slate-950/95 p-3 text-xs shadow-2xl shadow-black/40 backdrop-blur"
                style={{
                  left: hoverInfo.left,
                  top: hoverInfo.top,
                }}
              >
                <p className="truncate font-semibold text-cyan-300">
                  {hoverInfo.surfaceName}
                </p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-slate-300">
                  <dt className="text-slate-500">E</dt>
                  <dd>{formatCoordinate(hoverInfo.easting)}</dd>
                  <dt className="text-slate-500">N</dt>
                  <dd>{formatCoordinate(hoverInfo.northing)}</dd>
                  <dt className="text-slate-500">RL</dt>
                  <dd className="font-semibold text-white">
                    {hoverInfo.elevation === null
                      ? "Unavailable"
                      : hoverInfo.elevation.toFixed(3)}
                  </dd>
                </dl>
              </div>
            )}
          </>
        ) : (
          <div className="flex aspect-[1000/620] items-center justify-center p-10 text-center text-slate-500">
            Turn on a layer containing readable geometry to preview it.
          </div>
        )}
      </div>

      {bounds && (
        <div className="mt-4 flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:justify-between">
          <span>
            E {formatCoordinate(bounds.minEasting)} – {" "}
            {formatCoordinate(bounds.maxEasting)}
          </span>
          <span>
            N {formatCoordinate(bounds.minNorthing)} – {" "}
            {formatCoordinate(bounds.maxNorthing)}
          </span>
        </div>
      )}

      {faceStep > 1 && (
        <p className="mt-3 text-xs text-amber-300">
          Preview simplified to every {faceStep}th face for smooth
          performance. Hover RL still uses the complete TIN.
        </p>
      )}
    </section>
  )
}

type ToolButtonProps = {
  label: string
  onClick: () => void
  children: ReactNode
}

function ToolButton({
  label,
  onClick,
  children,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  )
}

type LayerToggleProps = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function LayerToggle({
  label,
  checked,
  onChange,
}: LayerToggleProps) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-slate-300 transition hover:border-cyan-400/40">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-cyan-400"
      />
      {label}
    </label>
  )
}
