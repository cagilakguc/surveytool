/**
 * Independent, pre-adjustment traverse closure from JobXML readings.
 *
 * IMPORTANT: Unlike adjustment starting values, all orientation and endpoint
 * coordinates must come from the user's explicitly fixed XY control table.
 * Each turned angle uses readings from a *single occupation*: raw Hz readings
 * from different setups cannot be subtracted from one another.
 */
import type { JobObservation, ObservationData } from "./observationModel"
import type { BuildOptions, ClosureOptions } from "./networkFromRaw"
import type { TraverseClosureInput, TraverseStation } from "./traverseClosure"
import { circularMeanDeg } from "./networkFromJobXml"

type Occupation = {
  recordId: string
  station: string
  firstTimestamp: string
  observations: JobObservation[]
}

type ReducedReading = {
  hzDeg: number
  zenithDeg: number
  slopeM: number
  instrumentHeightM: number
  targetHeightM: number
}

const RAD = Math.PI / 180
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
const positiveDegrees = (value: number) => ((value % 360) + 360) % 360

function reduceReadings(readings: JobObservation[]): ReducedReading {
  if (readings.length === 0) throw new Error("No readings to reduce.")
  const hz = readings.map((reading) => positiveDegrees(
    reading.hzDeg + (reading.face === "Face2" ? 180 : 0),
  ))
  const zenith = readings.map((reading) =>
    reading.face === "Face2" ? 360 - reading.vDeg : reading.vDeg,
  )
  return {
    hzDeg: circularMeanDeg(hz),
    zenithDeg: mean(zenith),
    slopeM: mean(readings.map((reading) => reading.slopeM)),
    instrumentHeightM: mean(readings.map((reading) => reading.instrumentHeightM)),
    targetHeightM: mean(readings.map((reading) => reading.targetHeightM)),
  }
}

export type TrigHeightLeg = {
  from: string
  to: string
  slopeM: number
  zenithDeg: number
  instrumentHeightM: number
  targetHeightM: number
  deltaHeightM: number
}

export type TrigHeightClosure = {
  startElevationM: number
  knownEndElevationM: number
  computedEndElevationM: number
  misclosureM: number
  totalRiseM: number
  legs: TrigHeightLeg[]
}

export type JobXmlClosureBuild = {
  heightClosure: TrigHeightClosure | null
  input: TraverseClosureInput
  /** Ambiguous repeated occupations selected deterministically, not silently. */
  warnings: string[]
}

/**
 * Build a conventional tied-traverse closure using unadjusted JXL measurements.
 *
 * The sequence and orientation points are supplied by the surveyor. The
 * setup-chain viewer can suggest a sequence, but it is not authoritative.
 */
export function buildJobXmlClosureInput(
  data: ObservationData,
  options: BuildOptions,
  closure: ClosureOptions,
): JobXmlClosureBuild {
  const canonical = (name: string) => options.aliases.get(name) ?? name
  const names = closure.sequence.map((name) => canonical(name.trim())).filter(Boolean)
  const startBack = canonical(closure.startBacksight.trim())
  const endBack = canonical(closure.endBacksight.trim())
  if (names.length < 3) {
    throw new Error("A traverse needs at least three stations: start, intermediate and end.")
  }
  if (!startBack || !endBack) {
    throw new Error("Specify both start and end orientation points for JXL closure.")
  }
  if (startBack === names[1] || endBack === names[names.length - 2]) {
    throw new Error("The orientation point must differ from the adjacent traverse station.")
  }
  const duplicate = names.find((name, index) =>
    names.indexOf(name) < index && !(index === names.length - 1 && name === names[0]),
  )
  if (duplicate) {
    throw new Error("Repeated intermediate traverse station: " + duplicate)
  }
  const coordinates = new Map(options.coordinates.map((point) => [point.id, point]))
  const fixedXY = (name: string) => {
    const point = coordinates.get(name)
    if (!point || !point.fixedHorizontal) {
      throw new Error("Provide an explicitly fixed XY control coordinate for " + name + " (fixed = XY or XYZ). JXL controller coordinates are approximate only.")
    }
    return { e: point.easting, n: point.northing }
  }
  const start = fixedXY(names[0])
  const startBacksight = fixedXY(startBack)
  const end = fixedXY(names[names.length - 1])
  const endBacksight = fixedXY(endBack)

  const occupations = new Map<string, Occupation>()
  const sequenceStations = new Set(names)
  for (const reading of data.observations) {
    if (reading.deleted || options.excludedSetups.has(reading.setupName)) continue
    const station = canonical(reading.setupName)
    if (!sequenceStations.has(station)) continue
    let occupation = occupations.get(reading.setupRecordId)
    if (!occupation) {
      occupation = {
        recordId: reading.setupRecordId,
        station,
        firstTimestamp: reading.timestamp,
        observations: [],
      }
      occupations.set(reading.setupRecordId, occupation)
    }
    if (occupation.station !== station) {
      throw new Error("Conflicting station names for JXL setup " + reading.setupRecordId)
    }
    occupation.observations.push(reading)
  }
  const ordered = [...occupations.values()].sort((a, b) =>
    a.firstTimestamp.localeCompare(b.firstTimestamp) || a.recordId.localeCompare(b.recordId),
  )
  const usedOccupations = new Set<string>()
  const warnings: string[] = []

  const angleAt = (station: string, fromTarget: string, toTarget: string) => {
    const suitable = ordered.filter((occupation) =>
      occupation.station === station &&
      !usedOccupations.has(occupation.recordId) &&
      occupation.observations.some((reading) => canonical(reading.target) === fromTarget) &&
      occupation.observations.some((reading) => canonical(reading.target) === toTarget),
    )
    if (suitable.length === 0) {
      throw new Error(
        "JXL requires readings from " + station + " to both " + fromTarget +
        " and " + toTarget + " in the same instrument occupation. Check the station sequence, aliases and excluded setups.",
      )
    }
    if (suitable.length > 1) {
      warnings.push(
        station + ": " + suitable.length + " suitable occupations found; using the earliest (" +
        suitable[0].recordId + "). Review repeated setups before relying on closure.",
      )
    }
    const selected = suitable[0]
    usedOccupations.add(selected.recordId)
    const back = reduceReadings(selected.observations.filter((reading) => canonical(reading.target) === fromTarget))
    const forward = reduceReadings(selected.observations.filter((reading) => canonical(reading.target) === toTarget))
    if (!(forward.zenithDeg > 0 && forward.zenithDeg < 180) || !(forward.slopeM > 0)) {
      throw new Error("Invalid slope distance or zenith angle for " + station + " to " + toTarget)
    }
    return {
      angleDeg: positiveDegrees(forward.hzDeg - back.hzDeg),
      horizontalDistance: forward.slopeM * Math.sin(forward.zenithDeg * RAD),
      slopeM: forward.slopeM,
      zenithDeg: forward.zenithDeg,
      instrumentHeightM: forward.instrumentHeightM,
      targetHeightM: forward.targetHeightM,
      deltaHeightM: forward.instrumentHeightM + forward.slopeM * Math.cos(forward.zenithDeg * RAD) - forward.targetHeightM,
    }
  }

  const stations: TraverseStation[] = []
  const heightLegs: TrigHeightLeg[] = []
  for (let index = 0; index < names.length - 1; index++) {
    const station = names[index]
    const previous = index === 0 ? startBack : names[index - 1]
    const next = names[index + 1]
    const observation = angleAt(station, previous, next)
    if (!(observation.horizontalDistance > 0)) {
      throw new Error("Horizontal traverse distance must be positive at " + station)
    }
    stations.push({ angleDeg: observation.angleDeg, distance: observation.horizontalDistance })
    heightLegs.push({
      from: station, to: next,
      slopeM: observation.slopeM,
      zenithDeg: observation.zenithDeg,
      instrumentHeightM: observation.instrumentHeightM,
      targetHeightM: observation.targetHeightM,
      deltaHeightM: observation.deltaHeightM,
    })
  }
  // The final station is independent orientation control: back to the previous
  // traverse station, forward to the known end orientation point.
  const endAngle = angleAt(names[names.length - 1], names[names.length - 2], endBack)
  const startControl = coordinates.get(names[0])
  const endControl = coordinates.get(names[names.length - 1])
  let heightClosure: TrigHeightClosure | null = null
  if (startControl?.fixedHeight && endControl?.fixedHeight) {
    const totalRiseM = heightLegs.reduce((sum, leg) => sum + leg.deltaHeightM, 0)
    const computedEndElevationM = startControl.elevation + totalRiseM
    heightClosure = {
      startElevationM: startControl.elevation,
      knownEndElevationM: endControl.elevation,
      computedEndElevationM, totalRiseM,
      misclosureM: computedEndElevationM - endControl.elevation,
      legs: heightLegs,
    }
  } else {
    warnings.push("Trigonometric height closure unavailable: enter fixed Z control for both start and end stations. Approximate JXL elevations are not accepted as control.")
  }
  return {
    input: {
      start,
      startBacksight,
      stations,
      end,
      endBacksight,
      endAngleDeg: endAngle.angleDeg,
      angleStdDevSec: closure.angleStdDevSec,
      minimumPrecisionDenominator: closure.minimumPrecisionDenominator,
    },
    heightClosure,
    warnings,
  }
}
