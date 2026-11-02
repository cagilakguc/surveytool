import type { LandXmlAlignment, PlanPoint } from "./landxml"
import { horizontalAlignment } from "./alignmentGeometry"

export function formatChainage(chainage: number, decimals = 3) {
  const value = Math.abs(chainage).toFixed(decimals)
  const [whole, fraction] = value.split(".")
  const metres = Number(whole)
  return `${chainage < 0 ? "-" : ""}${Math.floor(metres / 1000)}+${String(metres % 1000).padStart(3, "0")}${fraction ? `.${fraction}` : ""}`
}

export function alignmentChainageMarkers(alignment: LandXmlAlignment, interval = 10) {
  if (!Number.isFinite(interval) || interval <= 0) throw new Error("Choose a positive chainage label interval.")
  const range = horizontalAlignment(alignment)
  // Bound map features for very long alignments while retaining regular stations.
  const step = interval * Math.max(1, Math.ceil(range.length / interval / 2000))
  const first = Math.ceil((range.start - 1e-7) / step) * step
  const markers = []
  for (let index = 0; index <= 2000; index++) {
    const chainage = first + index * step
    if (chainage > range.end + 1e-7) break
    const position = range.at(chainage - range.start)
    markers.push({ ...position, chainage, label: `CH ${formatChainage(chainage, 0)}`, major: Math.abs(chainage / 100 - Math.round(chainage / 100)) < 1e-7 })
  }
  return { markers, interval: step }
}

type Segment = { a: PlanPoint; b: PlanPoint; from: number; to: number; minE: number; maxE: number; minN: number; maxN: number }
type Node = { minE: number; maxE: number; minN: number; maxN: number; left?: Node; right?: Node; segments?: Segment[] }
export type AlignmentStation = { chainage: number | null; offset: number | null; status: "ON_ALIGNMENT" | "BEFORE_START" | "AFTER_END" }

// An indexed preview locates the closest horizontal element. Refinement evaluates
// the original lines/arcs/clothoids, so chainage is never measured on a curve chord.
export function createAlignmentProjector(alignment: LandXmlAlignment) {
  const range = horizontalAlignment(alignment)
  const preview = range.preview()
  const segments: Segment[] = []
  for (let i = 1; i < preview.points.length; i++) {
    const a = preview.points[i - 1], b = preview.points[i]
    if (a.easting === b.easting && a.northing === b.northing) continue
    segments.push({ a, b, from: preview.pointChainages![i - 1] - range.start, to: preview.pointChainages![i] - range.start,
      minE: Math.min(a.easting, b.easting), maxE: Math.max(a.easting, b.easting), minN: Math.min(a.northing, b.northing), maxN: Math.max(a.northing, b.northing) })
  }
  function build(items: Segment[]): Node {
    const node: Node = { minE: Infinity, maxE: -Infinity, minN: Infinity, maxN: -Infinity }
    for (const s of items) { node.minE = Math.min(node.minE, s.minE); node.maxE = Math.max(node.maxE, s.maxE); node.minN = Math.min(node.minN, s.minN); node.maxN = Math.max(node.maxN, s.maxN) }
    if (items.length <= 8) node.segments = items
    else {
      const east = node.maxE - node.minE > node.maxN - node.minN
      items.sort((a, b) => east ? a.minE + a.maxE - b.minE - b.maxE : a.minN + a.maxN - b.minN - b.maxN)
      const middle = Math.floor(items.length / 2)
      node.left = build(items.slice(0, middle)); node.right = build(items.slice(middle))
    }
    return node
  }
  const root = build(segments)
  return (point: Pick<PlanPoint, "easting" | "northing">): AlignmentStation => {
    const e = point.easting, n = point.northing
    let best: Segment | null = null, bestDistance = Infinity
    const boxDistance = (node: Node) => Math.max(node.minE - e, 0, e - node.maxE) ** 2 + Math.max(node.minN - n, 0, n - node.maxN) ** 2
    function visit(node: Node) {
      if (boxDistance(node) > bestDistance) return
      if (node.segments) {
        for (const s of node.segments) {
          const dx = s.b.easting - s.a.easting, dy = s.b.northing - s.a.northing
          const t = Math.max(0, Math.min(1, ((e - s.a.easting) * dx + (n - s.a.northing) * dy) / (dx * dx + dy * dy)))
          const d = (e - s.a.easting - t * dx) ** 2 + (n - s.a.northing - t * dy) ** 2
          if (d < bestDistance) { bestDistance = d; best = s }
        }
      } else if (node.left && node.right) {
        const [near, far] = boxDistance(node.left) <= boxDistance(node.right) ? [node.left, node.right] : [node.right, node.left]
        visit(near); visit(far)
      }
    }
    visit(root)
    const segment = best as Segment | null
    if (!segment) throw new Error("This alignment has no usable horizontal elements.")
    const squared = (d: number) => { const p = range.at(d); return (e - p.easting) ** 2 + (n - p.northing) ** 2 }
    let lo = segment.from, hi = segment.to
    const ratio = (Math.sqrt(5) - 1) / 2
    let a = hi - ratio * (hi - lo), b = lo + ratio * (hi - lo), da = squared(a), db = squared(b)
    for (let i = 0; i < 28; i++) {
      if (da < db) { hi = b; b = a; db = da; a = hi - ratio * (hi - lo); da = squared(a) }
      else { lo = a; a = b; da = db; b = lo + ratio * (hi - lo); db = squared(b) }
    }
    let distance = (lo + hi) / 2
    for (const edge of [segment.from, segment.to]) if (squared(edge) < squared(distance)) distance = edge
    const position = range.at(distance)
    const dx = e - position.easting, dy = n - position.northing
    const along = dx * Math.cos(position.tangent) + dy * Math.sin(position.tangent)
    if (distance < 1e-4 && along < -1e-4) return { chainage: null, offset: null, status: "BEFORE_START" }
    if (range.length - distance < 1e-4 && along > 1e-4) return { chainage: null, offset: null, status: "AFTER_END" }
    const cross = Math.cos(position.tangent) * dy - Math.sin(position.tangent) * dx
    return { chainage: range.start + distance, offset: Math.sign(cross || 1) * Math.hypot(dx, dy), status: "ON_ALIGNMENT" }
  }
}
