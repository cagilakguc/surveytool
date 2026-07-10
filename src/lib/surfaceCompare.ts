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
  bounds: { minE: number; maxE: number; minN: number; maxN: number }
  sampleCount: number
}

type Triangle = [PlanPoint, PlanPoint, PlanPoint]

function triangles(surface: LandXmlSurface): Triangle[] {
  return surface.faces.flatMap((face) => {
    const points = face.map((id) => surface.points[id])
    return points.every((point) => point?.elevation !== null)
      ? [[points[0], points[1], points[2]] as Triangle]
      : []
  })
}

function bounds(surface: LandXmlSurface) {
  const points = Object.values(surface.points)
  return {
    minE: Math.min(...points.map((point) => point.easting)),
    maxE: Math.max(...points.map((point) => point.easting)),
    minN: Math.min(...points.map((point) => point.northing)),
    maxN: Math.max(...points.map((point) => point.northing)),
  }
}

function elevationAt(easting: number, northing: number, mesh: Triangle[]) {
  for (const [a, b, c] of mesh) {
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

    if (wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9) {
      return (
        wa * (a.elevation as number) +
        wb * (b.elevation as number) +
        wc * (c.elevation as number)
      )
    }
  }

  return null
}

export function compareSurfaces(
  existing: LandXmlSurface,
  design: LandXmlSurface,
  resolution = 90,
): SurfaceComparison {
  const existingMesh = triangles(existing)
  const designMesh = triangles(design)
  if (!existingMesh.length || !designMesh.length) {
    throw new Error("Both surfaces need readable TIN faces and elevations.")
  }

  const a = bounds(existing)
  const b = bounds(design)
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

  const cellSize = Math.max(width, height) / Math.max(20, Math.min(resolution, 180))
  const cells: SurfaceCell[] = []
  let cutVolume = 0
  let fillVolume = 0

  for (let northing = overlap.minN + cellSize / 2; northing < overlap.maxN; northing += cellSize) {
    for (let easting = overlap.minE + cellSize / 2; easting < overlap.maxE; easting += cellSize) {
      const existingElevation = elevationAt(easting, northing, existingMesh)
      const designElevation = elevationAt(easting, northing, designMesh)
      if (existingElevation === null || designElevation === null) continue

      const difference = designElevation - existingElevation
      cells.push({ easting, northing, difference })
      const volume = Math.abs(difference) * cellSize * cellSize
      if (difference < 0) cutVolume += volume
      else fillVolume += volume
    }
  }

  if (!cells.length) {
    throw new Error("No shared TIN area could be sampled.")
  }

  const differences = cells.map((cell) => cell.difference)
  return {
    cells,
    cutVolume,
    fillVolume,
    netVolume: fillVolume - cutVolume,
    minDifference: Math.min(...differences),
    maxDifference: Math.max(...differences),
    averageDifference: differences.reduce((sum, value) => sum + value, 0) / differences.length,
    comparedArea: cells.length * cellSize * cellSize,
    cellSize,
    bounds: overlap,
    sampleCount: cells.length,
  }
}
