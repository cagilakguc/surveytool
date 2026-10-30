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
