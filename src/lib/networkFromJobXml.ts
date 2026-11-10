/**
 * Builds network adjustment observations straight from a JobXML field book.
 *
 * Each occupation (one setup of the instrument) is handled on its own. Angles only
 * relate targets seen from the same occupation, so the orientation of one occupation
 * never mixes with another. Repeated occupations of the same station therefore add
 * their own observations instead of being dropped.
 *
 * Coordinates are fixed only where the coordinate table says so. Points that are not in
 * the table take the controller's stored coordinates as approximate starting values and
 * stay free.
 */

import type { ObservationData, JobObservation } from "./observationModel"
import type { NetworkObservation, NetworkPoint } from "./networkAdjustment"
import type { BuildOptions, BuiltNetwork } from "./networkFromRaw"

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** Circular mean of angles in degrees, result in [0, 360). */
export function circularMeanDeg(values: number[]): number {
  let sin = 0
  let cos = 0
  for (const value of values) {
    sin += Math.sin(value * RAD)
    cos += Math.cos(value * RAD)
  }
  return (((Math.atan2(sin, cos) * DEG) % 360) + 360) % 360
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length

/** Face I equivalent horizontal and zenith angles, both in degrees. */
function faceOneEquivalent(o: JobObservation): { hzDeg: number; vDeg: number } {
  if (o.face === "Face2") {
    return { hzDeg: (o.hzDeg + 180) % 360, vDeg: 360 - o.vDeg }
  }
  return { hzDeg: o.hzDeg, vDeg: o.vDeg }
}

type Occupation = {
  setupRecordId: string;
  setupName: string;
  observations: JobObservation[];
};

/** Coordinates the controller stored for each name. Used only as approximate values. */
export function approximatePoints(data: ObservationData): NetworkPoint[] {
  const found = new Map<string, NetworkPoint>()
  const add = (id: string, easting: number | null, northing: number | null, elevation: number | null) => {
    if (!id || found.has(id) || easting === null || northing === null || elevation === null) return
    found.set(id, { id, easting, northing, elevation, fixedHorizontal: false, fixedHeight: false })
  }
  for (const setup of data.setups) add(setup.name, setup.easting, setup.northing, setup.elevation)
  for (const o of data.observations) add(o.target, o.targetE, o.targetN, o.targetZ)
  return [...found.values()]
}

/** Coordinate table entries win. Approximate points are added only for names not in the table. */
export function mergeCoordinates(table: NetworkPoint[], approximate: NetworkPoint[]): NetworkPoint[] {
  const ids = new Set(table.map((p) => p.id))
  return [...table, ...approximate.filter((p) => !ids.has(p.id))]
}

export function networkFromJobXml(
  data: ObservationData,
  options: BuildOptions & { includeDeleted: boolean },
): BuiltNetwork {
  const { aliases, excludedSetups, coordinates, includeDeleted } = options
  const canonical = (name: string) => aliases.get(name) ?? name
  const known = new Set(coordinates.map((p) => p.id))
  const dropped: string[] = []
  const warnings: string[] = []

  const usable = data.observations.filter((o) => includeDeleted || !o.deleted)

  // One group per occupation, in the order the setups were made.
  const occupations = new Map<string, Occupation>()
  for (const o of usable) {
    const group = occupations.get(o.setupRecordId)
    if (group) group.observations.push(o)
    else occupations.set(o.setupRecordId, { setupRecordId: o.setupRecordId, setupName: o.setupName, observations: [o] })
  }

  const observations: NetworkObservation[] = []

  for (const occupation of [...occupations.values()]) {
    if (excludedSetups.has(occupation.setupName)) {
      dropped.push(`setup ${occupation.setupName} excluded by user`)
      continue
    }
    const station = canonical(occupation.setupName)
    if (!known.has(station)) {
      dropped.push(`setup ${occupation.setupName} has no coordinates`)
      continue
    }

    // Mean of every reading to each target within this occupation.
    const byTarget = new Map<string, JobObservation[]>()
    for (const o of occupation.observations) {
      const target = canonical(o.target)
      if (target === station) continue
      const list = byTarget.get(target)
      if (list) list.push(o)
      else byTarget.set(target, [o])
    }

    const targets: Array<{ name: string; hzDeg: number; vDeg: number; slopeM: number; hi: number; ht: number }> = []
    for (const [name, list] of byTarget) {
      if (!known.has(name)) {
        dropped.push(`target ${name} from ${occupation.setupName} has no coordinates`)
        continue
      }
      const reduced = list.map(faceOneEquivalent)
      targets.push({
        name,
        hzDeg: circularMeanDeg(reduced.map((r) => r.hzDeg)),
        vDeg: mean(reduced.map((r) => r.vDeg)),
        slopeM: mean(list.map((o) => o.slopeM)),
        hi: mean(list.map((o) => o.instrumentHeightM)),
        ht: mean(list.map((o) => o.targetHeightM)),
      })
    }

    for (const target of targets) {
      observations.push({
        kind: "slope",
        from: station,
        to: target.name,
        instrumentHeight: target.hi,
        targetHeight: target.ht,
        slopeDistance: target.slopeM,
      })
      observations.push({
        kind: "zenith",
        from: station,
        to: target.name,
        instrumentHeight: target.hi,
        targetHeight: target.ht,
        zenithDeg: target.vDeg,
      })
    }

    // Horizontal angles between every pair of targets seen from this occupation.
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        observations.push({
          kind: "angle",
          station,
          backsight: targets[i].name,
          foresight: targets[j].name,
          angleDeg: (((targets[j].hzDeg - targets[i].hzDeg) % 360) + 360) % 360,
        })
      }
    }
  }

  if (observations.length === 0) {
    warnings.push("No field book observations matched the coordinate table. Check the point names and aliases.")
  }
  return { points: coordinates.map((p) => ({ ...p })), observations, dropped, warnings }
}
