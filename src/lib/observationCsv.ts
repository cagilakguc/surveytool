/**
 * Reader for Trimble Access / JobXML "all observations" CSV exports.
 *
 * Each row is one observation. The controller stores the computed coordinates of
 * the target at the moment of the observation (computed_northing_m, computed_easting_m,
 * computed_elevation_m). These are the coordinates before any network adjustment, so
 * a plan built from them shows the position used when the measurement was taken.
 *
 * Setup positions are not stored on the rows. They are taken from the coordinates
 * the controller held for the setup point at the time of the setup: the last
 * observation of that point before the setup (or the first one after it, if none).
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
  observationCount: number;
};

export type ObservationData = {
  observations: JobObservation[];
  setups: PlanSetup[];
  qc: {
    rowCount: number;
    deletedCount: number;
    meanRowCount: number;
    unknownTargetCoordinates: number;
  };
  warnings: string[];
};

type CoordinateSample = { timestamp: string; e: number; n: number; z: number };

const REQUIRED_COLUMNS = [
  "observation_number",
  "timestamp",
  "method",
  "deleted",
  "classification",
  "station_name",
  "station_record_id",
  "instrument_height_m",
  "target_point",
  "point_code",
  "face",
  "horizontal_circle_deg",
  "vertical_circle_deg",
  "slope_distance_m",
  "target_height_m",
  "computed_northing_m",
  "computed_easting_m",
  "computed_elevation_m",
] as const;

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

const toNumber = (value: string | undefined) => (value === undefined || value === "" ? NaN : Number(value));

/** Latest sample at or before the time; otherwise the earliest sample after it. */
function coordinateAt(samples: CoordinateSample[] | undefined, timestamp: string): CoordinateSample | null {
  if (!samples || samples.length === 0) return null;
  let found: CoordinateSample | null = null;
  for (const sample of samples) {
    if (sample.timestamp <= timestamp) found = sample;
    else break;
  }
  return found ?? samples[0];
}

export function parseObservationCsv(text: string): ObservationData {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) throw new Error("The file has no observation rows.");

  const headers = splitCsvLine(lines[0], ",");
  const index = {} as Record<(typeof REQUIRED_COLUMNS)[number], number>;
  const missing: string[] = [];
  for (const column of REQUIRED_COLUMNS) {
    const position = headers.indexOf(column);
    if (position < 0) missing.push(column);
    else index[column] = position;
  }
  if (missing.length > 0) {
    throw new Error(`The CSV is missing required column(s): ${missing.join(", ")}.`);
  }

  const rows = lines.slice(1).map((line) => splitCsvLine(line, ","));
  const cell = (row: string[], column: (typeof REQUIRED_COLUMNS)[number]) => row[index[column]] ?? "";

  // Coordinate history per point, from rows that carry computed coordinates.
  // Deleted rows are left out of the history.
  const history = new Map<string, CoordinateSample[]>();
  for (const row of rows) {
    if (cell(row, "deleted") === "TRUE") continue;
    const target = cell(row, "target_point");
    const e = toNumber(cell(row, "computed_easting_m"));
    const n = toNumber(cell(row, "computed_northing_m"));
    const z = toNumber(cell(row, "computed_elevation_m"));
    if (!target || ![e, n, z].every(Number.isFinite)) continue;
    const list = history.get(target) ?? [];
    list.push({ timestamp: cell(row, "timestamp"), e, n, z });
    history.set(target, list);
  }
  for (const list of history.values()) {
    list.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  }

  const warnings: string[] = [];
  const observations: JobObservation[] = [];
  let deletedCount = 0;
  let meanRowCount = 0;
  let unknownTargetCoordinates = 0;

  for (const row of rows) {
    const deleted = cell(row, "deleted") === "TRUE";
    if (deleted) deletedCount++;
    if (cell(row, "method") === "MeanTurnedAngle") {
      // Mean turned angles summarise the direct readings; they are not plotted as separate lines.
      meanRowCount++;
      continue;
    }

    const timestamp = cell(row, "timestamp");
    const target = cell(row, "target_point");
    const own = {
      e: toNumber(cell(row, "computed_easting_m")),
      n: toNumber(cell(row, "computed_northing_m")),
      z: toNumber(cell(row, "computed_elevation_m")),
    };
    let coordinates: { e: number; n: number; z: number } | null = null;
    if ([own.e, own.n, own.z].every(Number.isFinite)) {
      coordinates = own;
    } else {
      const fallback = coordinateAt(history.get(target), timestamp);
      if (fallback) coordinates = { e: fallback.e, n: fallback.n, z: fallback.z };
    }
    if (!coordinates) unknownTargetCoordinates++;

    observations.push({
      observationNumber: Number(cell(row, "observation_number")),
      timestamp,
      setupRecordId: cell(row, "station_record_id"),
      setupName: cell(row, "station_name"),
      instrumentHeightM: toNumber(cell(row, "instrument_height_m")),
      target,
      pointCode: cell(row, "point_code"),
      classification: cell(row, "classification"),
      face: cell(row, "face"),
      hzDeg: toNumber(cell(row, "horizontal_circle_deg")),
      vDeg: toNumber(cell(row, "vertical_circle_deg")),
      slopeM: toNumber(cell(row, "slope_distance_m")),
      targetHeightM: toNumber(cell(row, "target_height_m")),
      deleted,
      targetE: coordinates?.e ?? null,
      targetN: coordinates?.n ?? null,
      targetZ: coordinates?.z ?? null,
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
  if (meanRowCount > 0) {
    warnings.push(`${meanRowCount} mean-angle summary row(s) were left out; the direct readings are used.`);
  }

  return {
    observations,
    setups,
    qc: { rowCount: rows.length, deletedCount, meanRowCount, unknownTargetCoordinates },
    warnings,
  };
}
