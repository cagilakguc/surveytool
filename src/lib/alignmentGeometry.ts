import type { AlignmentGeometry, LandXmlAlignment, PlanPoint } from "./landxml"

type Position = { easting: number; northing: number; tangent: number }
type HorizontalSegment = { length: number; at: (distance: number) => Position }
const distance = (a: PlanPoint, b: PlanPoint) => Math.hypot(b.easting - a.easting, b.northing - a.northing)
const tolerance = (length: number) => Math.max(0.005, length * 1e-6)
const point = (easting: number, northing: number): PlanPoint => ({ easting, northing, elevation: null })
function lineSegment(a: PlanPoint, b: PlanPoint): HorizontalSegment {
  const length = distance(a, b), tangent = Math.atan2(b.northing - a.northing, b.easting - a.easting)
  return { length, at: (d) => ({ easting: a.easting + Math.cos(tangent) * d, northing: a.northing + Math.sin(tangent) * d, tangent }) }
}

// Eight-point Gauss–Legendre integration of a clothoid's unit tangent.
// Composite intervals limit angular change; the result is distance-parametrised.
const nodes = [0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363]
const weights = [0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763]
function clothoidIntegral(d: number, length: number, k0: number, k1: number) {
  const count = Math.max(1, Math.ceil(d * Math.max(Math.abs(k0), Math.abs(k1)) / 0.25))
  if (count > 4096) throw new Error("This spiral exceeds the supported curvature range. Draw the required section manually.")
  let x = 0, y = 0
  for (let i = 0; i < count; i++) {
    const half = d / count / 2, mid = (i + 0.5) * d / count
    for (let j = 0; j < nodes.length; j++) for (const sign of [-1, 1]) {
      const s = mid + sign * half * nodes[j], angle = k0 * s + (k1 - k0) * s * s / (2 * length)
      x += half * weights[j] * Math.cos(angle); y += half * weights[j] * Math.sin(angle)
    }
  }
  return { x, y }
}

function geometrySegments(g: AlignmentGeometry): HorizontalSegment[] {
  if (g.type === "irregularline") return (g.points ?? []).slice(1).map((p, i) => lineSegment(g.points![i], p)).filter((s) => s.length > 0)
  const { start: a, end: b, attributes: attrs } = g
  if (!a || !b || ![a.easting, a.northing, b.easting, b.northing].every(Number.isFinite)) throw new Error("The alignment contains incomplete horizontal geometry. Re-export it or draw a section manually.")
  let result: HorizontalSegment
  if (g.type === "line") result = lineSegment(a, b)
  else if (g.type === "curve") {
    const c = g.center, rot = attrs.rot?.trim().toLowerCase()
    if (!c || !["cw", "ccw"].includes(rot)) throw new Error("A circular curve is missing its centre or rotation direction. Draw the section manually or re-export the alignment.")
    const radius = distance(c, a), endRadius = distance(c, b)
    if (!Number.isFinite(radius) || radius <= 0 || Math.abs(radius - endRadius) > tolerance(radius)) throw new Error("A curve's start and end radii do not agree. Check the alignment geometry.")
    const startAngle = Math.atan2(a.northing - c.northing, a.easting - c.easting)
    let delta = Math.atan2(b.northing - c.northing, b.easting - c.easting) - startAngle
    if (rot === "cw") { while (delta >= 0) delta -= Math.PI * 2 } else { while (delta <= 0) delta += Math.PI * 2 }
    const direction = rot === "cw" ? -1 : 1
    result = { length: Math.abs(delta) * radius, at: (d) => { const angle = startAngle + direction * d / radius; return { easting: c.easting + radius * Math.cos(angle), northing: c.northing + radius * Math.sin(angle), tangent: angle + direction * Math.PI / 2 } } }
  } else if (g.type === "spiral") {
    if (attrs.spiType?.trim().toLowerCase() !== "clothoid") throw new Error(`The ${attrs.spiType || "unspecified"} spiral type is not supported for interval sections. Use a drawn section or export a clothoid alignment.`)
    const length = Number(attrs.length), rot = attrs.rot?.trim().toLowerCase()
    const radius = (s: string) => /^\+?inf(?:inity)?$/i.test(s ?? "") ? Infinity : Number(s)
    const r0 = radius(attrs.radiusStart), r1 = radius(attrs.radiusEnd)
    if (!(length > 0) || !Number.isFinite(length) || !(r0 > 0) || !(r1 > 0) || !["cw", "ccw"].includes(rot)) throw new Error("A clothoid is missing valid length, radii or rotation. Check the alignment export.")
    const sign = rot === "cw" ? -1 : 1, k0 = sign / r0, k1 = sign / r1
    const total = clothoidIntegral(length, length, k0, k1), chord = distance(a, b)
    if (Math.abs(Math.hypot(total.x, total.y) - chord) > tolerance(length)) throw new Error("A clothoid's endpoints disagree with its length and radii. Check the alignment export.")
    const heading = Math.atan2(b.northing - a.northing, b.easting - a.easting) - Math.atan2(total.y, total.x)
    const cos = Math.cos(heading), sin = Math.sin(heading)
    result = { length, at: (d) => { const v = clothoidIntegral(d, length, k0, k1); return { easting: a.easting + cos * v.x - sin * v.y, northing: a.northing + sin * v.x + cos * v.y, tangent: heading + k0 * d + (k1 - k0) * d * d / (2 * length) } } }
  } else throw new Error(`The alignment's ${g.type} geometry is not supported for interval sections. Draw the section manually.`)
  const declared = attrs.length ? Number(attrs.length) : null
  if (declared !== null && (!Number.isFinite(declared) || Math.abs(result.length - declared) > tolerance(result.length))) throw new Error("A horizontal element's declared length disagrees with its geometry. Check the alignment export.")
  return result.length > 0 ? [result] : []
}

export function horizontalAlignment(alignment: LandXmlAlignment) {
  if (alignment.hasStationEquations) throw new Error("This alignment contains station equations. Automatic interval sections need continuous chainage; use a drawn section or export an alignment without station equations.")
  const segments = alignment.horizontalGeometry?.length ? alignment.horizontalGeometry.flatMap(geometrySegments) : alignment.points.slice(1).map((p, i) => lineSegment(alignment.points[i], p)).filter((s) => s.length > 0)
  const length = segments.reduce((sum, s) => sum + s.length, 0), start = alignment.startStation ?? 0
  if (!Number.isFinite(length) || !Number.isFinite(start) || !length) throw new Error("The alignment has no usable horizontal length.")
  if (alignment.length !== null && Math.abs(alignment.length - length) > tolerance(length)) throw new Error(alignment.horizontalGeometry?.length ? "The alignment length disagrees with its horizontal elements. Check for missing geometry or station equations." : "Re-import this alignment XML to retain its exact curve geometry before generating interval sections.")
  for (let i = 1; i < segments.length; i++) {
    const a = segments[i - 1].at(segments[i - 1].length), b = segments[i].at(0)
    if (Math.hypot(a.easting - b.easting, a.northing - b.northing) > tolerance(length)) throw new Error("The alignment contains a gap between horizontal elements. Check the XML before generating interval sections.")
  }
  return { length, start, end: start + length, at: (d: number) => {
    let remaining = Math.max(0, Math.min(length, d))
    for (const segment of segments) { if (remaining < segment.length - 1e-9) return segment.at(remaining); remaining -= segment.length }
    return segments[segments.length - 1].at(segments[segments.length - 1].length)
  }, preview: () => {
    const points: PlanPoint[] = [], chainages: number[] = []
    let travelled = 0
    for (const segment of segments) {
      const turn = Math.abs(segment.at(segment.length).tangent - segment.at(0).tangent)
      const steps = Math.min(20000, Math.max(1, Math.ceil(segment.length / 5), Math.ceil(turn / (Math.PI / 720)), Math.ceil(Math.sqrt(segment.length * turn / 0.008))))
      for (let i = points.length ? 1 : 0; i <= steps; i++) { const d = i / steps * segment.length, v = segment.at(d); points.push(point(v.easting, v.northing)); chainages.push(start + travelled + d) }
      travelled += segment.length
    }
    return { ...alignment, points, pointChainages: chainages }
  } }
}
