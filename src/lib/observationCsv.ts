/**
 * Reader for Trimble Access / JobXML "all observations" CSV exports.
 * Rows are mapped to the shared observation model; see observationModel.ts.
 */

import { buildObservationData } from "./observationModel";
import type { ObservationData, ObservationRecord } from "./observationModel";

export type { JobObservation, MeanAngle, ObservationData, PlanSetup } from "./observationModel";

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

/** Parses an all-observations CSV. Throws when required columns are missing. */
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

  const records: ObservationRecord[] = lines.slice(1).map((line, position) => {
    const row = splitCsvLine(line, ",");
    const cell = (column: (typeof REQUIRED_COLUMNS)[number]) => row[index[column]] ?? "";
    return {
      observationNumber: Number(cell("observation_number")) || position + 1,
      timestamp: cell("timestamp"),
      method: cell("method"),
      setupRecordId: cell("station_record_id"),
      setupName: cell("station_name"),
      instrumentHeightM: toNumber(cell("instrument_height_m")),
      target: cell("target_point"),
      pointCode: cell("point_code"),
      classification: cell("classification"),
      face: cell("face"),
      hzDeg: toNumber(cell("horizontal_circle_deg")),
      vDeg: toNumber(cell("vertical_circle_deg")),
      slopeM: toNumber(cell("slope_distance_m")),
      targetHeightM: toNumber(cell("target_height_m")),
      deleted: cell("deleted") === "TRUE",
      ownE: toNumber(cell("computed_easting_m")),
      ownN: toNumber(cell("computed_northing_m")),
      ownZ: toNumber(cell("computed_elevation_m")),
      meanCount: 0,
    };
  });

  return buildObservationData(records);
}
