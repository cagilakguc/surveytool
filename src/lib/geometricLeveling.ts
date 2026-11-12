/**
 * Geometric levelling by height-of-instrument (rise/fall equivalent on
 * turning-point legs). This module does NOT process total-station zenith angles.
 *
 * Each consecutive setup consists of BS, optional IS readings, and FS. The FS
 * turning point must be the next setup's BS point. IS are side shots, not
 * independent legs of the closing traverse.
 */
export type LevelSight = "BS" | "IS" | "FS"

export type LevelReading = {
  setup: string
  point: string
  sight: LevelSight
  readingM: number
  /** Distance from the instrument to this staff position, in metres. */
  distanceM: number | null
}

export type LevelMethod = "auto" | "distance" | "setups"

export type LevelRow = LevelReading & {
  heightOfInstrumentM: number
  rawElevationM: number
  correctionM: number
  adjustedElevationM: number
}

export type LevelLeg = {
  setup: string
  from: string
  to: string
  deltaHeightM: number
  distanceM: number | null
  rawToElevationM: number
  adjustedToElevationM: number
  correctionM: number
}

export type LevelResult = {
  rows: LevelRow[]
  legs: LevelLeg[]
  startPoint: string
  endPoint: string
  startElevationM: number
  knownEndElevationM: number | null
  computedEndElevationM: number
  adjustedEndElevationM: number
  misclosureM: number | null
  totalDistanceM: number | null
  methodUsed: "distance" | "setups"
  toleranceMm: number | null
  withinTolerance: boolean | null
  sumBSM: number
  sumFSM: number
  notes: string[]
}

function parseDelimited(line: string, delimiter: string): string[] {
  const out: string[] = []
  let part = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const character = line[i]
    if (character === '"') {
      if (inQuotes && line[i + 1] === '"') {
        part += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (character === delimiter && !inQuotes) {
      out.push(part.trim())
      part = ""
    } else {
      part += character
    }
  }
  if (inQuotes) throw new Error("Unterminated quotation mark in CSV.")
  out.push(part.trim())
  return out
}

function key(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "")
}

export function parseLevelCsv(csv: string): LevelReading[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
  if (lines.length < 3) {
    throw new Error("Provide a CSV header and at least one backsight/foresight pair.")
  }
  const header = lines[0]
  const delimiter = [";", "\t", ","].find((value) => header.includes(value)) ?? ","
  const columns = parseDelimited(header, delimiter).map(key)
  const find = (names: string[], required = true) => {
    const index = columns.findIndex((column) => names.includes(column))
    if (index < 0 && required) throw new Error("Missing CSV column: " + names[0])
    return index
  }
  const iSetup = find(["setup", "station", "instrumentsetup"])
  const iPoint = find(["point", "pointid", "id"])
  const iSight = find(["sight", "type", "readingtype"])
  const iReading = find(["readingm", "reading", "staffreadingm", "staffm"])
  const iDistance = find(["distancem", "distance", "sightdistancem"], false)
  const rows: LevelReading[] = []
  for (let index = 1; index < lines.length; index++) {
    const values = parseDelimited(lines[index], delimiter)
    const requiredCount = Math.max(iSetup, iPoint, iSight, iReading)
    if (values.length <= requiredCount) {
      throw new Error("CSV row " + (index + 1) + " has missing fields.")
    }
    const setup = values[iSetup]?.trim() ?? ""
    const point = values[iPoint]?.trim() ?? ""
    const sight = (values[iSight] ?? "").toUpperCase()
    const raw = values[iReading]?.trim() ?? ""
    const readingM = raw === "" ? NaN : Number(raw)
    const distanceText = iDistance >= 0 ? values[iDistance]?.trim() ?? "" : ""
    const distanceM = distanceText === "" ? null : Number(distanceText)
    if (!setup || !point) throw new Error("CSV row " + (index + 1) + " needs setup and point names.")
    if (sight !== "BS" && sight !== "IS" && sight !== "FS") {
      throw new Error("CSV row " + (index + 1) + ": sight must be BS, IS or FS.")
    }
    if (!Number.isFinite(readingM)) throw new Error("CSV row " + (index + 1) + ": invalid staff reading.")
    if (distanceM !== null && !(Number.isFinite(distanceM) && distanceM > 0)) {
      throw new Error("CSV row " + (index + 1) + ": sight distance must be greater than zero.")
    }
    rows.push({ setup, point, sight, readingM, distanceM })
  }
  return rows
}

type LevelOptions = {
  startElevationM: number
  /** Null for an open line without known end control. */
  knownEndElevationM?: number | null
  method?: LevelMethod
  /** Contract-specific coefficient, mm * sqrt(km). Only evaluated with full sight distances. */
  toleranceMmSqrtKm?: number
}

export function calculateLeveling(readings: LevelReading[], options: LevelOptions): LevelResult {
  if (!Number.isFinite(options.startElevationM)) throw new Error("Start benchmark elevation must be finite.")
  if (options.knownEndElevationM !== null &&
      options.knownEndElevationM !== undefined &&
      !Number.isFinite(options.knownEndElevationM)) {
    throw new Error("End benchmark elevation must be finite.")
  }
  const coefficient = options.toleranceMmSqrtKm ?? 12
  if (!Number.isFinite(coefficient) || coefficient <= 0) {
    throw new Error("Tolerance coefficient must be positive.")
  }
  if (!readings.length || readings.length > 100000) {
    throw new Error("Provide between 1 and 100,000 levelling observations.")
  }
  const groups: LevelReading[][] = []
  const seen = new Set<string>()
  for (const row of readings) {
    if (!row.setup || !row.point || !["BS", "IS", "FS"].includes(row.sight) || !Number.isFinite(row.readingM) ||
        (row.distanceM !== null && !(Number.isFinite(row.distanceM) && row.distanceM > 0))) {
      throw new Error("Invalid levelling reading. Verify setup, point, sight, reading and distance.")
    }
    const last = groups[groups.length - 1]
    if (!last || last[0].setup !== row.setup) {
      if (seen.has(row.setup)) throw new Error("Setup " + row.setup + " appears in separate blocks. Give each occupation a unique setup name.")
      groups.push([row])
      seen.add(row.setup)
    } else {
      last.push(row)
    }
  }
  for (const group of groups) {
    const setup = group[0].setup
    if (group.length < 2 || group[0].sight !== "BS" || group[group.length - 1].sight !== "FS") {
      throw new Error("Setup " + setup + " must start with BS and end with FS.")
    }
    if (group.filter((row) => row.sight === "BS").length !== 1 ||
        group.filter((row) => row.sight === "FS").length !== 1 ||
        group.slice(1, -1).some((row) => row.sight !== "IS")) {
      throw new Error("Setup " + setup + " must have exactly one BS and one FS, with optional IS in between.")
    }
    if (group[0].point === group[group.length - 1].point) {
      throw new Error("Setup " + setup + " must have different BS and FS points.")
    }
  }
  for (let i = 1; i < groups.length; i++) {
    const previous = groups[i - 1][groups[i - 1].length - 1]
    if (groups[i][0].point !== previous.point) {
      throw new Error("Setup " + groups[i][0].setup + " BS point " + groups[i][0].point +
        " does not match previous turning point " + previous.point + ".")
    }
  }
  const startPoint = groups[0][0].point
  const endPoint = groups[groups.length - 1][groups[groups.length - 1].length - 1].point
  let knownEnd = options.knownEndElevationM ?? null
  if (startPoint === endPoint) {
    if (knownEnd !== null && Math.abs(knownEnd - options.startElevationM) > 1e-9) {
      throw new Error("Closed loop ends at the start benchmark, so the start and end known elevations must match.")
    }
    knownEnd = options.startElevationM
  }
  const legs: LevelLeg[] = []
  const uncorrectedRows: Omit<LevelRow, "correctionM" | "adjustedElevationM">[] = []
  let currentElevation = options.startElevationM
  let sumBSM = 0
  let sumFSM = 0
  for (const group of groups) {
    const backsight = group[0]
    const foresight = group[group.length - 1]
    const heightOfInstrumentM = currentElevation + backsight.readingM
    sumBSM += backsight.readingM
    sumFSM += foresight.readingM
    const distanceM = backsight.distanceM !== null && foresight.distanceM !== null
      ? backsight.distanceM + foresight.distanceM
      : null
    for (const reading of group) {
      const elevation = reading.sight === "BS" ? currentElevation : heightOfInstrumentM - reading.readingM
      uncorrectedRows.push({ ...reading, heightOfInstrumentM, rawElevationM: elevation })
    }
    const nextElevation = heightOfInstrumentM - foresight.readingM
    legs.push({
      setup: backsight.setup, from: backsight.point, to: foresight.point,
      deltaHeightM: backsight.readingM - foresight.readingM,
      distanceM, rawToElevationM: nextElevation,
      adjustedToElevationM: nextElevation, correctionM: 0,
    })
    currentElevation = nextElevation
  }
  // Check both the arithmetic reduction and direct HI propagation, independently.
  const arithmeticEnd = options.startElevationM + sumBSM - sumFSM
  if (Math.abs(arithmeticEnd - currentElevation) > 1e-8) {
    throw new Error("Internal levelling arithmetic check failed.")
  }
  const completeDistances = legs.every((leg) => leg.distanceM !== null)
  const totalDistanceM = completeDistances
    ? legs.reduce((sum, leg) => sum + (leg.distanceM ?? 0), 0)
    : null
  const requestedMethod = options.method ?? "auto"
  if (requestedMethod === "distance" && !completeDistances) {
    throw new Error("Distance-weighted corrections need both BS and FS sight distances for every setup.")
  }
  const methodUsed: "distance" | "setups" = requestedMethod === "auto"
    ? completeDistances ? "distance" : "setups"
    : requestedMethod === "distance" ? "distance" : "setups"
  const misclosureM = knownEnd === null ? null : currentElevation - knownEnd
  const weights = legs.map((leg) => methodUsed === "distance" ? leg.distanceM ?? 0 : 1)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let cumulativeWeight = 0
  let rowIndex = 0
  const rows: LevelRow[] = []
  for (let index = 0; index < legs.length; index++) {
    const leg = legs[index]
    const group = groups[index]
    const correctionAtStart = misclosureM === null ? 0 : -misclosureM * cumulativeWeight / totalWeight
    cumulativeWeight += weights[index]
    const correctionAtEnd = misclosureM === null ? 0 : -misclosureM * cumulativeWeight / totalWeight
    for (const reading of group) {
      const raw = uncorrectedRows[rowIndex++]
      // IS are side shots: without an independent route distance along the levelling
      // line, assign the known correction at the setup's BS turning point.
      const correctionM = reading.sight === "FS" ? correctionAtEnd : correctionAtStart
      rows.push({
        ...raw, correctionM,
        adjustedElevationM: raw.rawElevationM + correctionM,
      })
    }
    legs[index] = {
      ...leg, correctionM: correctionAtEnd,
      adjustedToElevationM: leg.rawToElevationM + correctionAtEnd,
    }
  }
  const adjustedEndElevationM = rows[rows.length - 1].adjustedElevationM
  const toleranceMm = knownEnd !== null && totalDistanceM !== null
    ? coefficient * Math.sqrt(totalDistanceM / 1000)
    : null
  const withinTolerance = misclosureM !== null && toleranceMm !== null
    ? Math.abs(misclosureM * 1000) <= toleranceMm
    : null
  const notes: string[] = [
    "Turning-point closure uses BS minus FS only; IS side shots do not participate in misclosure.",
    "Intermediate-sight corrections inherit the preceding turning-point correction; they are not independent level-route adjustments.",
  ]
  if (misclosureM === null) notes.push("Open line: no known end elevation, so no closure or distributed corrections.")
  if (!completeDistances) notes.push("Some BS/FS distances are missing. No distance-based closure tolerance can be certified.")
  if (methodUsed === "setups" && misclosureM !== null) notes.push("Closure correction is distributed equally per instrument setup.")
  if (withinTolerance === false) notes.push("Measured misclosure exceeds the chosen project tolerance. Review the field measurements before using corrected elevations.")
  return {
    rows, legs, startPoint, endPoint,
    startElevationM: options.startElevationM,
    knownEndElevationM: knownEnd,
    computedEndElevationM: currentElevation,
    adjustedEndElevationM,
    misclosureM, totalDistanceM, methodUsed, toleranceMm, withinTolerance,
    sumBSM, sumFSM, notes,
  }
}
