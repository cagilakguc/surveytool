import { useMemo, useState } from "react"

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

function getSurfacePoints(surface: LandXmlSurface) {
  return Object.values(surface.points)
}

function calculateBounds(points: PlanPoint[]): Bounds | null {
  if (points.length === 0) {
    return null
  }

  const eastings = points.map((point) => point.easting)
  const northings = points.map((point) => point.northing)

  return {
    minEasting: Math.min(...eastings),
    maxEasting: Math.max(...eastings),
    minNorthing: Math.min(...northings),
    maxNorthing: Math.max(...northings),
  }
}

function projectPoint(point: PlanPoint, bounds: Bounds) {
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
    x: offsetX + (point.easting - bounds.minEasting) * scale,
    y:
      offsetY +
      (bounds.maxNorthing - point.northing) * scale,
  }
}

function formatCoordinate(value: number) {
  return new Intl.NumberFormat("en-NZ", {
    maximumFractionDigits: 3,
    useGrouping: false,
  }).format(value)
}

export default function LandXmlPreview({
  document,
}: LandXmlPreviewProps) {
  const [selectedSurface, setSelectedSurface] = useState("all")
  const [showSurfaces, setShowSurfaces] = useState(true)
  const [showVertices, setShowVertices] = useState(false)
  const [showAlignments, setShowAlignments] = useState(true)
  const [showCogoPoints, setShowCogoPoints] = useState(true)

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
      visibleSurfaces.forEach((surface) =>
        points.push(...getSurfacePoints(surface)),
      )
    }

    if (showAlignments) {
      document.alignments.forEach((alignment) =>
        points.push(...alignment.points),
      )
    }

    if (showCogoPoints) {
      points.push(...document.cogoPoints)
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

  const totalFaces = visibleSurfaces.reduce(
    (sum, surface) => sum + surface.faces.length,
    0,
  )
  const faceStep = Math.max(
    1,
    Math.ceil(totalFaces / maximumPreviewFaces),
  )

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
            Curves are sampled for the preview. Original file data is
            not changed.
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

      <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-[#020617]">
        {bounds ? (
          <svg
            viewBox={`0 0 ${previewWidth} ${previewHeight}`}
            role="img"
            aria-label="Plan preview of the loaded LandXML geometry"
            className="block aspect-[1000/620] w-full"
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
                />
              </pattern>
            </defs>

            <rect
              width={previewWidth}
              height={previewHeight}
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
                    {surface.faces.map((face, faceIndex) => {
                      if (faceIndex % faceStep !== 0) {
                        return null
                      }

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
                              const projected = projectPoint(
                                point,
                                bounds,
                              )
                              return `${projected.x},${projected.y}`
                            })
                            .join(" ")}
                          fill={colour}
                          fillOpacity={0.16 + elevationRatio * 0.28}
                          stroke={colour}
                          strokeOpacity="0.5"
                          strokeWidth="0.7"
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
                    {points.map((point, pointIndex) => {
                      if (pointIndex % pointStep !== 0) {
                        return null
                      }

                      const projected = projectPoint(point, bounds)
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
                      const projected = projectPoint(point, bounds)
                      return `${projected.x},${projected.y}`
                    })
                    .join(" ")}
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}

            {showCogoPoints &&
              document.cogoPoints.map((point) => {
                const projected = projectPoint(point, bounds)
                return (
                  <circle
                    key={`${point.name}-${point.easting}-${point.northing}`}
                    cx={projected.x}
                    cy={projected.y}
                    r="4"
                    fill="#f472b6"
                    stroke="#fdf2f8"
                    strokeWidth="1.5"
                  />
                )
              })}
          </svg>
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
          browser performance. File statistics still use all faces.
        </p>
      )}
    </section>
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
