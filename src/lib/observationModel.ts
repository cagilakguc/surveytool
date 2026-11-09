/**
 * Shared model for total-station observations read from a job export (CSV or JobXML).
 *
 * Coordinates are the controller values stored with each observation, before any
 * adjustment. Setup positions are the coordinates the controller held for the setup
 * point at the time of the setup: the last sample before it, or the first one after.
 */

export type JobObservation = {
  observationNumber: number;
  timestamp: string;
  setupRecordId: string;
  setupName: string;
  instrumentHeightM: number;
  target: string;
  pointCode: string;
  classification: string;
  face: string;
  hzDeg: number;
  vDeg: number;
  slopeM: number;
  targetHeightM: number;
  deleted: boolean;
  /** Target coordinates at the time of the observation, or null when unknown. */
  targetE: number | null;
  targetN: number | null;
  targetZ: number | null;
};

/** Mean turned angle summary for one target from one setup. Not used in the adjustment. */
export type MeanAngle = {
  setupRecordId: string;
  setupName: string;
  timestamp: string;
  target: string;
  pointCode: string;
  hzDeg: number;
  vDeg: number;
  slopeM: number;
  count: number;
  deleted: boolean;
};

export type PlanSetup = {
  recordId: string;
  name: string;
  /** 1 for the first occupation of this name, 2 for the next, and so on. */
  occurrence: number;
  label: string;
  timestamp: string;
  easting: number | null;
  northing: number | null;
  elevation: number | null;
  instrumentHeightM: number;
  observationCount: number;
};

export type ObservationData = {
  observations: JobObservation[];
  means: MeanAngle[];
  setups: PlanSetup[];
  qc: {
    rowCount: number;
    deletedCount: number;
    meanRowCount: number;
    unknownTargetCoordinates: number;
  };
  warnings: string[];
};

/** One source row or record, already read into plain values. NaN marks a missing number. */
export type ObservationRecord = {
  observationNumber: number;
  timestamp: string;
  method: string;
  setupRecordId: string;
  setupName: string;
  instrumentHeightM: number;
  target: string;
  pointCode: string;
  classification: string;
  face: string;
  hzDeg: number;
  vDeg: number;
  slopeM: number;
  targetHeightM: number;
  deleted: boolean;
  /** Target coordinates stored with this record; NaN when absent. */
  ownE: number;
  ownN: number;
  ownZ: number;
  /** Number of direct readings behind a mean turned angle. */
  meanCount: number;
};

type CoordinateSample = { timestamp: string; e: number; n: number; z: number };

/** Latest sample at or before the time; otherwise the earliest sample after it. */
export function coordinateAt(samples: CoordinateSample[] | undefined, timestamp: string): CoordinateSample | null {
  if (!samples || samples.length === 0) return null;
  let found: CoordinateSample | null = null;
  for (const sample of samples) {
    if (sample.timestamp <= timestamp) found = sample;
    else break;
  }
  return found ?? samples[0];
}

export function buildObservationData(records: ObservationRecord[]): ObservationData {
  // Coordinate history per point from live records that carry computed coordinates.
  const history = new Map<string, CoordinateSample[]>();
  for (const record of records) {
    if (record.deleted) continue;
    if (!record.target || ![record.ownE, record.ownN, record.ownZ].every(Number.isFinite)) continue;
    const list = history.get(record.target) ?? [];
    list.push({ timestamp: record.timestamp, e: record.ownE, n: record.ownN, z: record.ownZ });
    history.set(record.target, list);
  }
  for (const list of history.values()) {
    list.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  }

  const warnings: string[] = [];
  const observations: JobObservation[] = [];
  const means: MeanAngle[] = [];
  let deletedCount = 0;
  let unknownTargetCoordinates = 0;

  for (const record of records) {
    if (record.deleted) deletedCount++;
    if (record.method === "MeanTurnedAngle") {
      means.push({
        setupRecordId: record.setupRecordId,
        setupName: record.setupName,
        timestamp: record.timestamp,
        target: record.target,
        pointCode: record.pointCode,
        hzDeg: record.hzDeg,
        vDeg: record.vDeg,
        slopeM: record.slopeM,
        count: record.meanCount,
        deleted: record.deleted,
      });
      continue;
    }

    let e = record.ownE;
    let n = record.ownN;
    let z = record.ownZ;
    if (![e, n, z].every(Number.isFinite)) {
      const fallback = coordinateAt(history.get(record.target), record.timestamp);
      if (fallback) ({ e, n, z } = fallback);
      else ({ e, n, z } = { e: NaN, n: NaN, z: NaN });
    }
    const known = [e, n, z].every(Number.isFinite);
    if (!known) unknownTargetCoordinates++;

    observations.push({
      observationNumber: record.observationNumber,
      timestamp: record.timestamp,
      setupRecordId: record.setupRecordId,
      setupName: record.setupName,
      instrumentHeightM: record.instrumentHeightM,
      target: record.target,
      pointCode: record.pointCode,
      classification: record.classification,
      face: record.face,
      hzDeg: record.hzDeg,
      vDeg: record.vDeg,
      slopeM: record.slopeM,
      targetHeightM: record.targetHeightM,
      deleted: record.deleted,
      targetE: known ? e : null,
      targetN: known ? n : null,
      targetZ: known ? z : null,
    });
  }

  // Setups: one per setup record. The same name can be occupied more than once.
  const setupsById = new Map<string, PlanSetup>();
  const occurrenceByName = new Map<string, number>();
  const liveCount = new Map<string, number>();
  for (const observation of observations) {
    if (!setupsById.has(observation.setupRecordId)) {
      const occurrence = (occurrenceByName.get(observation.setupName) ?? 0) + 1;
      occurrenceByName.set(observation.setupName, occurrence);
      const position = coordinateAt(history.get(observation.setupName), observation.timestamp);
      setupsById.set(observation.setupRecordId, {
        recordId: observation.setupRecordId,
        name: observation.setupName,
        occurrence,
        label: occurrence > 1 ? `${observation.setupName} (${occurrence})` : observation.setupName,
        timestamp: observation.timestamp,
        easting: position?.e ?? null,
        northing: position?.n ?? null,
        elevation: position?.z ?? null,
        instrumentHeightM: observation.instrumentHeightM,
        observationCount: 0,
      });
    }
    if (!observation.deleted) {
      liveCount.set(observation.setupRecordId, (liveCount.get(observation.setupRecordId) ?? 0) + 1);
    }
  }
  const setups = [...setupsById.values()];
  for (const setup of setups) {
    setup.observationCount = liveCount.get(setup.recordId) ?? 0;
    if (setup.easting === null || setup.northing === null) {
      warnings.push(`No coordinates found for setup ${setup.label}; its lines are not drawn.`);
    }
  }
  if (unknownTargetCoordinates > 0) {
    warnings.push(`${unknownTargetCoordinates} observation(s) have no target coordinates and are not drawn.`);
  }
  if (means.length > 0) {
    warnings.push(`${means.length} mean-angle summary row(s) are listed separately and not drawn as lines.`);
  }

  return {
    observations,
    means,
    setups,
    qc: { rowCount: records.length, deletedCount, meanRowCount: means.length, unknownTargetCoordinates },
    warnings,
  };
}
