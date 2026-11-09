import assert from "node:assert/strict";
import { parseObservationCsv } from "../src/lib/observationCsv.ts";

const HEADER = [
  "observation_number", "record_id", "timestamp", "observation_type", "method", "deleted", "round",
  "station_name", "station_record_id", "station_type", "instrument_model", "instrument_serial",
  "instrument_height_m", "target_point", "point_code", "classification", "face",
  "horizontal_circle_deg", "vertical_circle_deg", "slope_distance_m",
  "target_name", "target_record_id", "target_height_m", "prism_type", "prism_constant_m",
  "backsight_point", "computed_northing_m", "computed_easting_m", "computed_elevation_m",
];

let counter = 0;
function row(fields) {
  counter++;
  const base = Object.fromEntries(HEADER.map((h) => [h, ""]));
  Object.assign(base, {
    observation_number: String(counter),
    record_id: `r${counter}`,
    observation_type: "RawCircle",
    method: "DirectReading",
    deleted: "FALSE",
    instrument_height_m: "1.5",
    target_height_m: "1.5",
    face: "Face1",
    horizontal_circle_deg: "10",
    vertical_circle_deg: "90",
    slope_distance_m: "100",
  }, fields);
  return HEADER.map((h) => base[h]).join(",");
}

const csv = [
  HEADER.join(","),
  // Setup S1 (record a1) at 10:00. Target T1 has its own coordinates.
  row({ timestamp: "2026-09-27T10:00:10", station_name: "S1", station_record_id: "a1", target_point: "T1", computed_northing_m: "200", computed_easting_m: "100", computed_elevation_m: "10" }),
  // Deleted observation to T2 at 10:01. Kept in the list but flagged.
  row({ timestamp: "2026-09-27T10:01:00", station_name: "S1", station_record_id: "a1", target_point: "T2", deleted: "TRUE", computed_northing_m: "210", computed_easting_m: "110", computed_elevation_m: "10" }),
  // Mean turned angle summary: left out of the observations.
  row({ timestamp: "2026-09-27T10:02:00", method: "MeanTurnedAngle", observation_type: "MeanTurnedAngle", station_name: "S1", station_record_id: "a1", target_point: "T1", computed_northing_m: "200", computed_easting_m: "100", computed_elevation_m: "10" }),
  // S1 known earlier from another setup (09:50): S1 is at (50, 60, 5).
  row({ timestamp: "2026-09-27T09:50:00", station_name: "X", station_record_id: "x0", target_point: "S1", computed_northing_m: "60", computed_easting_m: "50", computed_elevation_m: "5" }),
  // S2 (record b2) at 11:00. S2 is seen from S1 at 10:30 with coordinates (300, 400, 12).
  row({ timestamp: "2026-09-27T10:30:00", station_name: "S1", station_record_id: "a1", target_point: "S2", computed_northing_m: "400", computed_easting_m: "300", computed_elevation_m: "12" }),
  // T3 seen from S1 at 10:20 with coordinates (150, 250, 9); later observed from S2 without its own coordinates.
  row({ timestamp: "2026-09-27T10:20:00", station_name: "S1", station_record_id: "a1", target_point: "T3", computed_northing_m: "250", computed_easting_m: "150", computed_elevation_m: "9" }),
  row({ timestamp: "2026-09-27T11:00:30", station_name: "S2", station_record_id: "b2", target_point: "S1", computed_northing_m: "", computed_easting_m: "", computed_elevation_m: "" }),
  row({ timestamp: "2026-09-27T11:10:00", station_name: "S2", station_record_id: "b2", target_point: "T3", computed_northing_m: "", computed_easting_m: "", computed_elevation_m: "" }),
  // S1 seen again from S2 at 11:05 with its updated coordinates (55, 65, 5).
  row({ timestamp: "2026-09-27T11:05:00", station_name: "S2", station_record_id: "b2", target_point: "S1", computed_northing_m: "65", computed_easting_m: "55", computed_elevation_m: "5" }),
  // Second occupation of the name S1 (record c3) at 12:00.
  row({ timestamp: "2026-09-27T12:00:00", station_name: "S1", station_record_id: "c3", target_point: "T1", computed_northing_m: "201", computed_easting_m: "101", computed_elevation_m: "10" }),
  // Target with no coordinates anywhere.
  row({ timestamp: "2026-09-27T12:01:00", station_name: "S1", station_record_id: "c3", target_point: "T9", computed_northing_m: "", computed_easting_m: "", computed_elevation_m: "" }),
].join("\n");

const data = parseObservationCsv(csv);

// Row accounting.
assert.equal(data.qc.rowCount, 11);
assert.equal(data.qc.meanRowCount, 1);
assert.equal(data.qc.deletedCount, 1);
assert.equal(data.observations.length, data.qc.rowCount - 1, "all rows except the mean summary are observations");

// Deleted observation is kept and flagged.
const deleted = data.observations.find((o) => o.target === "T2");
assert.equal(deleted.deleted, true);

// Target coordinates use the observation's own values when present.
const t1 = data.observations.find((o) => o.target === "T1" && o.setupRecordId === "a1");
assert.equal(t1.targetE, 100);
assert.equal(t1.targetN, 200);

// Target without its own coordinates falls back to the coordinates known at that time.
const t3 = data.observations.find((o) => o.target === "T3" && o.setupRecordId === "b2");
assert.equal(t3.targetE, 150);
assert.equal(t3.targetN, 250);

// Unknown target coordinates are reported, not invented.
const t9 = data.observations.find((o) => o.target === "T9");
assert.equal(t9.targetE, null);
assert.equal(data.qc.unknownTargetCoordinates, 1);
assert.ok(data.warnings.some((w) => w.includes("no target coordinates")));

// Setups: one per record; the second occupation of a name is labelled and keeps its own position.
// Setups: a1 (S1), x0 (X), b2 (S2) and c3 (second S1).
assert.equal(data.setups.length, 4);
const s1 = data.setups.find((s) => s.recordId === "a1");
assert.equal(s1.label, "S1");
assert.equal(s1.easting, 50, "S1 at 10:00 uses the 09:50 coordinates");
assert.equal(s1.northing, 60);

const s2 = data.setups.find((s) => s.recordId === "b2");
assert.equal(s2.label, "S2");
assert.equal(s2.easting, 300, "S2 at 11:00 uses the coordinates seen from S1 at 10:30");
assert.equal(s2.northing, 400);

const s1b = data.setups.find((s) => s.recordId === "c3");
assert.equal(s1b.label, "S1 (2)");
assert.equal(s1b.easting, 55, "second S1 at 12:00 uses the latest coordinates seen before it");
assert.equal(s1b.northing, 65);

// Live observation counts ignore deleted rows.
// Rows 1, 5 and 6 are live from setup a1; row 2 (deleted) and the mean row are not counted.
assert.equal(s1.observationCount, 3);

// Missing required column is reported by name.
assert.throws(
  () => parseObservationCsv("observation_number,timestamp\n1,2026"),
  /missing required column\(s\)/,
);

console.log("Observation CSV validation passed.");
