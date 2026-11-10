/**
 * Works out the traverse chain from the setups of a job.
 *
 * Rule: the first observation of a setup, in time order, is the backsight. When that
 * backsight is the station occupied just before, the chain continues from it. Repeated
 * occupations of the same name (the same station set up again) are grouped with the
 * station they repeat. A chain is closed when the last station has the same name as the
 * first station.
 */

import type { JobObservation, ObservationData, PlanSetup } from "./observationModel"

export type ChainLink = "known" | "chain" | "break" | "none"

export type ChainOccupation = {
  recordId: string;
  label: string;
  timestamp: string;
  backsight: string | null;
  observationCount: number;
};

export type ChainStation = {
  name: string;
  occupations: ChainOccupation[];
  /** Backsight of the first occupation, or null when the station has no observations. */
  backsight: string | null;
  link: ChainLink;
};

export type TraverseChain = {
  stations: ChainStation[];
  closed: boolean;
  /** Points observed from the first station that are not the next station in the chain. */
  knownPoints: string[];
  warnings: string[];
};

type Options = { includeDeleted: boolean };

function firstTarget(observations: JobObservation[]): string | null {
  if (observations.length === 0) return null;
  const sorted = [...observations].sort(
    (a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.observationNumber - b.observationNumber),
  );
  return sorted[0].target;
}

export function buildTraverseChain(data: ObservationData, options: Options): TraverseChain {
  const setups = [...data.setups].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
  const stations: ChainStation[] = []
  let firstObservations: JobObservation[] = []

  const observationsFor = (setup: PlanSetup) =>
    data.observations.filter((o) => o.setupRecordId === setup.recordId && (options.includeDeleted || !o.deleted))

  // Link of the station at `index`, judged from its backsight.
  const linkFor = (backsight: string | null, index: number): ChainLink => {
    if (backsight === null) return "none"
    if (index === 0) return "known"
    return backsight === stations[index - 1].name ? "chain" : "break"
  }

  for (const setup of setups) {
    const observations = observationsFor(setup)
    if (stations.length === 0 && observations.length > 0) firstObservations = observations
    const backsight = firstTarget(observations)
    const occupation: ChainOccupation = {
      recordId: setup.recordId,
      label: setup.label,
      timestamp: setup.timestamp,
      backsight,
      observationCount: observations.length,
    }

    const last = stations[stations.length - 1]
    if (last && last.name === setup.name) {
      // Same station set up again: group it with the station it repeats. An occupation
      // without observations can still supply the backsight for the station.
      last.occupations.push(occupation)
      if (last.backsight === null && backsight !== null) {
        last.backsight = backsight
        last.link = linkFor(backsight, stations.length - 1)
      }
      continue
    }

    stations.push({ name: setup.name, occupations: [occupation], backsight, link: linkFor(backsight, stations.length) })
  }

  const warnings: string[] = []
  for (const station of stations) {
    if (station.link === "none") warnings.push(`${station.name}: no observations, backsight unknown.`)
    if (station.link === "break") {
      const index = stations.indexOf(station)
      warnings.push(`${station.name}: backsight ${station.backsight} is not the previous station ${stations[index - 1].name}.`)
    }
  }

  const first = stations[0]
  const lastStation = stations[stations.length - 1]
  const closed = stations.length > 1 && lastStation.name === first.name

  // Known points: targets observed from the first station, excluding the next station in the chain.
  const nextName = stations.length > 1 ? stations[1].name : null
  const firstTargets = new Set<string>()
  for (const o of firstObservations) {
    if (o.target !== nextName) firstTargets.add(o.target)
  }
  const knownPoints = [...firstTargets].sort()

  return { stations, closed, knownPoints, warnings }
}
