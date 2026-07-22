import type { LandXmlSurface, PlanPoint } from "./landxml"

export type SurfaceCell = {
  easting: number
  northing: number
  difference: number
}

export type SurfaceComparison = {
  cells: SurfaceCell[]
  cutVolume: number
  fillVolume: number
  netVolume: number
  minDifference: number
  maxDifference: number
  averageDifference: number
  comparedArea: number
  cellSize: number
  bounds: {
    minE: number
    maxE: number
    minN: number
    maxN: number
  }
  sampleCount: number
}

type Triangle = {
  a: PlanPoint
  b: PlanPoint
  c: PlanPoint
  minE: number
  maxE: number
  minN: number
  maxN: number
}

type Bounds = {
  minE: number
  maxE: number
  minN: number
  maxN: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function surfaceBounds(surface: LandXmlSurface): Bounds {
  const points = Object.values(surface.points)
  if (points.length === 0) {
    throw new Error(`${surface.name} contains no readable TIN points.`)
  }

  let minE = Number.POSITIVE_INFINITY
  let maxE = Number.NEGATIVE_INFINITY
  let minN = Number.POSITIVE_INFINITY
  let maxN = Number.NEGATIVE_INFINITY

  points.forEach((point) => {
    minE = Math.min(minE, point.easting)
    maxE = Math.max(maxE, point.easting)
    minN = Math.min(minN, point.northing)
    maxN = Math.max(maxN, point.northing)
  })

  return { minE, maxE, minN, maxN }
}

function buildSurfaceIndex(surface: LandXmlSurface) {
  const mesh: Triangle[] = []

  surface.faces.forEach((face) => {
    const a = surface.points[face[0]]
    const b = surface.points[face[1]]
    const c = surface.points[face[2]]

    if (
      !a ||
      !b ||
      !c ||
      a.elevation === null ||
      b.elevation === null ||
      c.elevation === null
    ) {
      return
    }

    mesh.push({
      a,
      b,
      c,
      minE: Math.min(a.easting, b.easting, c.easting),
      maxE: Math.max(a.easting, b.easting, c.easting),
      minN: Math.min(a.northing, b.northing, c.northing),
      maxN: Math.max(a.northing, b.northing, c.northing),
    })
  })

  if (mesh.length === 0) {
    throw new Error(`${surface.name} has no readable TIN faces and elevations.`)
  }

  const bounds = surfaceBounds(surface)
  const dimension = clamp(
    Math.ceil(Math.sqrt(mesh.length / 5)),
    12,
    180,
  )
  const cellWidth = Math.max((bounds.maxE - bounds.minE) / dimension, 0.000001)
  const cellHeight = Math.max((bounds.maxN - bounds.minN) / dimension, 0.000001)
  const cells = new Map<string, Triangle[]>()

  function indexFor(value: number, minimum: number, size: number) {
    return clamp(
      Math.floor((value - minimum) / size),
      0,
      dimension - 1,
    )
  }

  mesh.forEach((triangle) => {
    const startX = indexFor(triangle.minE, bounds.minE, cellWidth)
    const endX = indexFor(triangle.maxE, bounds.minE, cellWidth)
    const startY = indexFor(triangle.minN, bounds.minN, cellHeight)
    const endY = indexFor(triangle.maxN, bounds.minN, cellHeight)

    for (let x = startX; x <= endX; x += 1) {
      for (let y = startY; y <= endY; y += 1) {
        const key = `${x}:${y}`
        const existing = cells.get(key)
        if (existing) existing.push(triangle)
        else cells.set(key, [triangle])
      }
    }
  })

  function interpolate(triangle: Triangle, easting: number, northing: number) {
    const { a, b, c } = triangle
    const denominator =
      (b.northing - c.northing) * (a.easting - c.easting) +
      (c.easting - b.easting) * (a.northing - c.northing)

    if (Math.abs(denominator) < 1e-12) return null

    const wa =
      ((b.northing - c.northing) * (easting - c.easting) +
        (c.easting - b.easting) * (northing - c.northing)) /
      denominator
    const wb =
      ((c.northing - a.northing) * (easting - c.easting) +
        (a.easting - c.easting) * (northing - c.northing)) /
      denominator
    const wc = 1 - wa - wb

    if (wa < -1e-8 || wb < -1e-8 || wc < -1e-8) return null

    return (
      wa * (a.elevation as number) +
      wb * (b.elevation as number) +
      wc * (c.elevation as number)
    )
  }

  return {
    bounds,
    elevationAt(easting: number, northing: number) {
      if (
        easting < bounds.minE ||
        easting > bounds.maxE ||
        northing < bounds.minN ||
        northing > bounds.maxN
      ) {
        return null
      }

      const x = indexFor(easting, bounds.minE, cellWidth)
      const y = indexFor(northing, bounds.minN, cellHeight)
      const candidates = cells.get(`${x}:${y}`) ?? []

      for (const triangle of candidates) {
        if (
          easting < triangle.minE ||
          easting > triangle.maxE ||
          northing < triangle.minN ||
          northing > triangle.maxN
        ) {
          continue
        }

        const elevation = interpolate(triangle, easting, northing)
        if (elevation !== null) return elevation
      }

      return null
    },
  }
}

export function compareSurfaces(
  existing: LandXmlSurface,
  design: LandXmlSurface,
  resolution = 90,
): SurfaceComparison {
  const existingIndex = buildSurfaceIndex(existing)
  const designIndex = buildSurfaceIndex(design)
  const a = existingIndex.bounds
  const b = designIndex.bounds
  const overlap = {
    minE: Math.max(a.minE, b.minE),
    maxE: Math.min(a.maxE, b.maxE),
    minN: Math.max(a.minN, b.minN),
    maxN: Math.min(a.maxN, b.maxN),
  }
  const width = overlap.maxE - overlap.minE
  const height = overlap.maxN - overlap.minN

  if (width <= 0 || height <= 0) {
    throw new Error("The selected surfaces do not overlap in plan.")
  }

  const safeResolution = Math.max(20, Math.min(resolution, 180))
  const cellSize = Math.max(width, height) / safeResolution
  const cells: SurfaceCell[] = []
  let cutVolume = 0
  let fillVolume = 0
  let differenceTotal = 0
  let minDifference = Number.POSITIVE_INFINITY
  let maxDifference = Number.NEGATIVE_INFINITY

  for (
    let northing = overlap.minN + cellSize / 2;
    northing < overlap.maxN;
    northing += cellSize
  ) {
    for (
      let easting = overlap.minE + cellSize / 2;
      easting < overlap.maxE;
      easting += cellSize
    ) {
      const existingElevation = existingIndex.elevationAt(easting, northing)
      const designElevation = designIndex.elevationAt(easting, northing)
      if (existingElevation === null || designElevation === null) continue

      const difference = designElevation - existingElevation
      cells.push({ easting, northing, difference })
      differenceTotal += difference
      minDifference = Math.min(minDifference, difference)
      maxDifference = Math.max(maxDifference, difference)

      const volume = Math.abs(difference) * cellSize * cellSize
      if (difference < 0) cutVolume += volume
      else fillVolume += volume
    }
  }

  if (cells.length === 0) {
    throw new Error("No shared TIN area could be sampled.")
  }

  return {
    cells,
    cutVolume,
    fillVolume,
    netVolume: fillVolume - cutVolume,
    minDifference,
    maxDifference,
    averageDifference: differenceTotal / cells.length,
    comparedArea: cells.length * cellSize * cellSize,
    cellSize,
    bounds: overlap,
    sampleCount: cells.length,
  }
}
