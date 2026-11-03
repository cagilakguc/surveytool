import polygonClipping from "polygon-clipping"
import intersects from "robust-segment-intersect"
import type { LandXmlBoundary, LandXmlSurface, PlanPoint } from "./landxml"

type XY = [number, number]
type BoundaryTriangle = { a: PlanPoint; b: PlanPoint; c: PlanPoint; minE: number; maxE: number; minN: number; maxN: number }
type PreparedBoundary = ReturnType<typeof prepareBoundary>
const epsilon = 1e-8

function ringArea(ring: XY[]) {
  const [ox, oy] = ring[0]
  let area = 0
  for (let i = 1; i < ring.length - 1; i++) area += (ring[i][0] - ox) * (ring[i + 1][1] - oy) - (ring[i + 1][0] - ox) * (ring[i][1] - oy)
  return Math.abs(area) / 2
}

function validateRing(ring: XY[], fail: (message: string) => never) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of ring) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
  const scale = Math.max(maxX - minX, maxY - minY)
  if (!scale || ringArea(ring) <= scale * scale * 1e-14) fail("The polygon has no usable area.")
  const normalized: XY[] = ring.map(([x, y]) => [(x - minX) / scale, (y - minY) / scale])
  const dimension = Math.min(160, Math.max(8, Math.ceil(Math.sqrt(ring.length))))
  const buckets = new Map<number, number[]>()
  let checks = 0, references = 0
  for (let i = 0; i < normalized.length; i++) {
    const a = normalized[i], b = normalized[(i + 1) % normalized.length], seen = new Set<number>()
    for (let x = Math.floor(Math.min(a[0], b[0]) * dimension); x <= Math.floor(Math.max(a[0], b[0]) * dimension); x++) {
      for (let y = Math.floor(Math.min(a[1], b[1]) * dimension); y <= Math.floor(Math.max(a[1], b[1]) * dimension); y++) {
        if (++references > 2_000_000) fail("The polygon is too complex. Export a smaller work area.")
        const key = x * (dimension + 1) + y, previous = buckets.get(key) ?? []
        for (const j of previous) {
          if (seen.has(j)) continue
          seen.add(j)
          if (++checks > 4_000_000) fail("The polygon is too complex. Export a smaller work area.")
          const adjacent = j === i - 1 || i === normalized.length - 1 && j === 0
          if (adjacent) {
            const s = j === i - 1 ? a : b, u = j === i - 1 ? b : a, v = j === i - 1 ? normalized[j] : normalized[1]
            const cross = (u[0] - s[0]) * (v[1] - s[1]) - (u[1] - s[1]) * (v[0] - s[0])
            if (Math.abs(cross) < 1e-14 && (u[0] - s[0]) * (v[0] - s[0]) + (u[1] - s[1]) * (v[1] - s[1]) > 0) fail("The polygon contains overlapping edges.")
          } else if (intersects(a, b, normalized[j], normalized[(j + 1) % normalized.length])) fail("The polygon crosses or touches itself.")
        }
        previous.push(i); buckets.set(key, previous)
      }
    }
  }
  return { minE: minX, maxE: maxX, minN: minY, maxN: maxY }
}

function prepareBoundary(boundary: LandXmlBoundary) {
  const fail = (message: string): never => { throw new Error(`Surface boundary “${boundary.name}”: ${message}`) }
  if (boundary.error) fail(boundary.error)
  const type = boundary.type === "hide" ? "void" : boundary.type === "show" ? "island" : boundary.type
  if (!["outer", "void", "island"].includes(type)) fail(`Unsupported boundary type “${boundary.type || "missing"}”. Export an outer, void or island boundary, or a clipped TIN.`)
  const ring: XY[] = []
  for (const point of boundary.points) {
    if (!Number.isFinite(point.easting) || !Number.isFinite(point.northing)) fail("The polygon contains invalid coordinates.")
    const last = ring.at(-1)
    if (!last || last[0] !== point.easting || last[1] !== point.northing) ring.push([point.easting, point.northing])
  }
  if (ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1]) ring.pop()
  if (ring.length < 3) fail("At least three distinct polygon vertices are required.")
  const bounds = validateRing(ring, fail)
  // Index by northing for point queries; large corridor boundaries do not scan every edge at every survey point.
  const size = Math.min(256, Math.max(1, Math.ceil(Math.sqrt(ring.length))))
  const step = Math.max(bounds.maxN - bounds.minN, epsilon) / size
  const cell = (n: number) => Math.min(size - 1, Math.max(0, Math.floor((n - bounds.minN) / step)))
  const edges = Array.from({ length: size }, () => [] as number[])
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]
    for (let j = cell(Math.min(a[1], b[1]) - epsilon); j <= cell(Math.max(a[1], b[1]) + epsilon); j++) edges[j].push(i)
  })
  function contains(e: number, n: number) {
    if (e < bounds.minE - epsilon || e > bounds.maxE + epsilon || n < bounds.minN - epsilon || n > bounds.maxN + epsilon) return false
    let inside = false
    for (const i of edges[cell(n)]) {
      const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1]
      if (e >= Math.min(a[0], b[0]) - epsilon && e <= Math.max(a[0], b[0]) + epsilon && n >= Math.min(a[1], b[1]) - epsilon && n <= Math.max(a[1], b[1]) + epsilon && Math.abs((e - a[0]) * dy - (n - a[1]) * dx) <= epsilon * Math.max(1, Math.hypot(dx, dy))) return true
      if ((a[1] > n) !== (b[1] > n) && e < a[0] + (n - a[1]) * dx / dy) inside = !inside
    }
    return inside
  }
  const origin = ring[0], localRing: XY[] = ring.map(([x, y]) => [x - origin[0], y - origin[1]])
  const triangleCache = new WeakMap<BoundaryTriangle, { any: boolean; all: boolean }>()
  function triangleCoverage(t: BoundaryTriangle) {
    const previous = triangleCache.get(t)
    if (previous) return previous
    let coverage = { any: false, all: false }
    if (t.minE <= bounds.maxE && t.maxE >= bounds.minE && t.minN <= bounds.maxN && t.maxN >= bounds.minN) {
      const triangle: XY[] = [t.a, t.b, t.c].map((p) => [p.easting - origin[0], p.northing - origin[1]])
      const area = ringArea(triangle), tolerance = Math.max(area * 1e-10, 1e-12)
      const clipped = polygonClipping.intersection([triangle], [localRing])
      const clippedArea = clipped.reduce((sum, polygon) => sum + ringArea(polygon[0]) - polygon.slice(1).reduce((holes, hole) => holes + ringArea(hole), 0), 0)
      coverage = { any: clippedArea > tolerance, all: Math.abs(clippedArea - area) <= tolerance }
    }
    triangleCache.set(t, coverage)
    return coverage
  }
  return { type, edgeTrim: boundary.edgeTrim, contains, triangleCoverage }
}

/** LandXML boundary order is retained. A later outer boundary replaces earlier visibility operations. */
export function createTinBoundaryFilter(surface: LandXmlSurface) {
  if (surface.hasBoundaryDefinitions && !surface.boundaries?.length) throw new Error("Re-upload this LandXML file to read its boundary polygons. Boundary geometry was not retained in older saved projects.")
  const boundaries = surface.boundaries ?? []
  if (boundaries.length > 5_000 || boundaries.reduce((sum, b) => sum + b.points.length, 0) > 100_000) throw new Error("The surface boundary exceeds 100,000 vertices or 5,000 polygons. Export a smaller work area.")
  const prepared: PreparedBoundary[] = boundaries.map(prepareBoundary)
  const lastOuter = prepared.findLastIndex((boundary) => boundary.type === "outer")
  const active = prepared.slice(Math.max(0, lastOuter))
  return active.length ? (t: BoundaryTriangle, e: number, n: number) => {
    let visible = true
    for (const boundary of active) {
      const contained = boundary.edgeTrim ? boundary.contains(e, n) : boundary.triangleCoverage(t)
      const inside = typeof contained === "boolean" ? contained : boundary.type === "void" ? contained.any : contained.all
      if (boundary.type === "outer") visible = inside
      else if (inside) visible = boundary.type === "island"
    }
    return visible
  } : null
}

/** Include crossings and interval midpoints so a narrow void cannot be joined over by a section profile. */
export function tinBoundarySectionFractions(surface: LandXmlSurface | undefined, start: PlanPoint, end: PlanPoint) {
  const dx = end.easting - start.easting, dy = end.northing - start.northing, lengthSquared = dx * dx + dy * dy
  if (!surface?.boundaries?.length || !lengthSquared) return []
  const crossings = [0, 1]
  for (const boundary of surface.boundaries) {
    for (let i = 0; i < boundary.points.length; i++) {
      const a = boundary.points[i], b = boundary.points[(i + 1) % boundary.points.length]
      const sx = b.easting - a.easting, sy = b.northing - a.northing, ax = a.easting - start.easting, ay = a.northing - start.northing
      const denominator = dx * sy - dy * sx
      if (Math.abs(denominator) <= Math.max(Math.hypot(dx, dy) * Math.hypot(sx, sy), 1) * 1e-12) {
        if (Math.abs(ax * dy - ay * dx) <= epsilon * Math.hypot(dx, dy)) for (const p of [a, b]) {
          const t = ((p.easting - start.easting) * dx + (p.northing - start.northing) * dy) / lengthSquared
          if (t > 0 && t < 1) crossings.push(t)
        }
        continue
      }
      const t = (ax * sy - ay * sx) / denominator, u = (ax * dy - ay * dx) / denominator
      if (t > 0 && t < 1 && u >= 0 && u <= 1) crossings.push(t)
    }
  }
  const sorted = [...new Set(crossings)].sort((a, b) => a - b)
  if (sorted.length > 10_000) throw new Error("The section crosses too many surface boundaries. Draw a shorter section or export a smaller work area.")
  return sorted.flatMap((t, i) => i ? [(sorted[i - 1] + t) / 2, t] : [t])
}
