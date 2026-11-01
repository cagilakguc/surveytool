import type { LandXmlAlignment } from "./landxml"
import type { SectionLine } from "./sectionOptions"
import { horizontalAlignment } from "./alignmentGeometry"

export const maximumBatchSections = 200
export type AlignmentSection = { chainage: number; line: SectionLine }
export function alignmentSectionRange(alignment: LandXmlAlignment) {
  try { const { start, end, length } = horizontalAlignment(alignment); return { start, end, length, error: "" } }
  catch (error) { const start = alignment.startStation ?? 0; return { start, end: start, length: 0, error: error instanceof Error ? error.message : "The alignment could not be stationed." } }
}

export function createAlignmentSections(alignment: LandXmlAlignment, interval: number, halfWidth: number, start: number, end: number): AlignmentSection[] {
  if (![interval, halfWidth, start, end].every(Number.isFinite) || interval <= 0 || halfWidth <= 0 || start > end) throw new Error("Enter a positive interval and section width, with start chainage no greater than end chainage.")
  const range = horizontalAlignment(alignment)
  if (!range.length) throw new Error("The alignment has no usable horizontal length.")
  if (start < range.start - 1e-7 || end > range.end + 1e-7) throw new Error(`Keep the chainage range within ${range.start.toFixed(3)}–${range.end.toFixed(3)}. No sections are extrapolated beyond the alignment.`)
  const count = Math.floor((end - start) / interval + 1e-9) + 1
  if (count > maximumBatchSections) throw new Error(`This range creates ${count.toLocaleString()} sections. Split it into batches of ${maximumBatchSections} or fewer, or increase the interval.`)
  return Array.from({ length: count }, (_, i) => {
    const chainage = start + i * interval, distance = Math.min(range.length, Math.max(0, chainage - range.start))
    const { easting: e, northing: n, tangent } = range.at(distance)
    const leftE = -Math.sin(tangent) * halfWidth, leftN = Math.cos(tangent) * halfWidth
    return { chainage, line: { start: { easting: e + leftE, northing: n + leftN, elevation: null }, end: { easting: e - leftE, northing: n - leftN, elevation: null } } }
  })
}

/**
 * Find the station range occupied by measured points near an alignment.
 * Uses a local spatial grid to avoid comparing every point with every segment.
 * The imported alignment preview carries chainages for curves and spirals.
 */
export function detectAsbuiltChainageRange(
  alignment: LandXmlAlignment,
  points: ReadonlyArray<{ easting: number; northing: number }>,
  interval: number,
  maximumOffset: number,
) {
  if (!Number.isFinite(interval) || interval <= 0 || !Number.isFinite(maximumOffset) || maximumOffset <= 0) {
    throw new Error("Choose a positive section interval and width before detecting the as-built chainages.")
  }
  if (alignment.points.length < 2) throw new Error("This alignment has no usable plan geometry.")
  if (!points.length) throw new Error("Select an as-built point file before detecting its chainage range.")
  const range = horizontalAlignment(alignment)
  const size = Math.max(10, maximumOffset)
  type Segment = { ax: number; ay: number; dx: number; dy: number; length2: number; start: number; end: number }
  const segments: Segment[] = []
  const cells = new Map<string, number[]>()
  let distanceAlong = range.start, entries = 0
  const key = (x: number, y: number) => `${x}:${y}`
  for (let i = 1; i < alignment.points.length; i++) {
    const a = alignment.points[i - 1], b = alignment.points[i]
    const dx = b.easting - a.easting, dy = b.northing - a.northing
    const length2 = dx * dx + dy * dy
    if (length2 <= 0) continue
    const length = Math.sqrt(length2)
    const start = alignment.pointChainages?.[i - 1] ?? distanceAlong
    const end = alignment.pointChainages?.[i] ?? start + length
    const index = segments.push({ ax: a.easting, ay: a.northing, dx, dy, length2, start, end }) - 1
    const minX = Math.floor((Math.min(a.easting, b.easting) - maximumOffset) / size)
    const maxX = Math.floor((Math.max(a.easting, b.easting) + maximumOffset) / size)
    const minY = Math.floor((Math.min(a.northing, b.northing) - maximumOffset) / size)
    const maxY = Math.floor((Math.max(a.northing, b.northing) + maximumOffset) / size)
    const cellCount = (maxX - minX + 1) * (maxY - minY + 1)
    if (entries + cellCount > 500_000) throw new Error("The alignment is too extensive for automatic point matching. Enter start/end chainages manually.")
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
      const id = key(x, y), bucket = cells.get(id) ?? []
      bucket.push(index)
      cells.set(id, bucket)
    }
    entries += cellCount
    distanceAlong += length
  }
  let minimum = Infinity, maximum = -Infinity, matched = 0
  const threshold2 = maximumOffset * maximumOffset
  for (const point of points) {
    if (!Number.isFinite(point.easting) || !Number.isFinite(point.northing)) continue
    const bucket = cells.get(key(Math.floor(point.easting / size), Math.floor(point.northing / size)))
    if (!bucket) continue
    let nearest2 = Infinity, station = 0
    for (const index of bucket) {
      const segment = segments[index]
      const t = Math.max(0, Math.min(1, ((point.easting - segment.ax) * segment.dx + (point.northing - segment.ay) * segment.dy) / segment.length2))
      const de = point.easting - segment.ax - t * segment.dx
      const dn = point.northing - segment.ay - t * segment.dy
      const dist2 = de * de + dn * dn
      if (dist2 < nearest2) { nearest2 = dist2; station = segment.start + (segment.end - segment.start) * t }
    }
    if (nearest2 > threshold2) continue
    matched++
    minimum = Math.min(minimum, station)
    maximum = Math.max(maximum, station)
  }
  if (!matched) throw new Error(`No selected as-built points fall within ${maximumOffset.toFixed(2)} m of the alignment. Check the selected point file, grid and section width.`)
  const gridStart = Math.ceil((range.start - 1e-7) / interval) * interval
  const gridEnd = Math.floor((range.end + 1e-7) / interval) * interval
  const start = Math.max(gridStart, Math.floor((minimum + 1e-7) / interval) * interval)
  const end = Math.min(gridEnd, Math.ceil((maximum - 1e-7) / interval) * interval)
  if (start > end) throw new Error("The surveyed area falls outside the available regular section stations. Use manual start/end chainages.")
  return { start, end, minimum, maximum, matched, total: points.length }
}

export const maximumAutomaticSections = 600

/** Process long section ranges in bounded groups while retaining one report. */
export function createAlignmentSectionBatches(
  alignment: LandXmlAlignment, interval: number, halfWidth: number, start: number, end: number,
): AlignmentSection[][] {
  if (![interval, halfWidth, start, end].every(Number.isFinite) || interval <= 0 || halfWidth <= 0 || start > end) {
    throw new Error("Enter a positive interval and width, with start chainage no greater than end chainage.")
  }
  const count = Math.floor((end - start) / interval + 1e-9) + 1
  if (count > maximumAutomaticSections) throw new Error(`This range creates ${count} sections. Use a shorter chainage range or increase the interval (maximum ${maximumAutomaticSections} sections per export).`)
  const batches: AlignmentSection[][] = []
  for (let index = 0; index < count; index += maximumBatchSections) {
    const last = Math.min(count - 1, index + maximumBatchSections - 1)
    batches.push(createAlignmentSections(alignment, interval, halfWidth, start + index * interval, start + last * interval))
  }
  return batches
}
