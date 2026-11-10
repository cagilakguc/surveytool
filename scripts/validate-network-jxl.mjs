import assert from "node:assert/strict";
import { networkFromJobXml, mergeCoordinates, approximatePoints, circularMeanDeg } from "../src/lib/networkFromJobXml.ts";
import { adjustNetwork } from "../src/lib/networkAdjustment.ts";

const DEG = 180 / Math.PI;
const precision = { distanceConstantM: 0.002, distancePpm: 2, angleStdDevSec: 1, zenithStdDevSec: 1 };
let recordSeq = 0;
let obsSeq = 0;

/** Exact reading from station to target, as a total station would record it (face I). */
function reading(station, target, hi, ht) {
  const dE = target.easting - station.easting;
  const dN = target.northing - station.northing;
  const hd = Math.hypot(dE, dN);
  const dZ = target.elevation + ht - (station.elevation + hi);
  return {
    hzDeg: (Math.atan2(dE, dN) * DEG + 360) % 360,
    vDeg: Math.atan2(hd, dZ) * DEG,
    slopeM: Math.hypot(hd, dZ),
  };
}

/** One observation row. Face II rows are the face I reading turned by 180 deg and 360 - V. */
function row(setupRecordId, setupName, target, r, face, hi, ht, extra = {}) {
  obsSeq += 1;
  const flip = face === "Face2";
  return {
    observationNumber: obsSeq,
    timestamp: `2026-01-01T10:${String(obsSeq % 60).padStart(2, "0")}:00`,
    setupRecordId,
    setupName,
    instrumentHeightM: hi,
    target,
    pointCode: "",
    classification: "Normal",
    face,
    hzDeg: flip ? (r.hzDeg + 180) % 360 : r.hzDeg,
    vDeg: flip ? 360 - r.vDeg : r.vDeg,
    slopeM: r.slopeM,
    targetHeightM: ht,
    deleted: false,
    targetE: null,
    targetN: null,
    targetZ: null,
    ...extra,
  };
}

const HI = 1.5;
const HT = 1.5;
const P1 = { id: "P1", easting: 1000, northing: 2000, elevation: 10 };
const P2 = { id: "P2", easting: 1100, northing: 2000, elevation: 11 };
const P3 = { id: "P3", easting: 1040, northing: 2070, elevation: 12.5 };

// --- 1. Face II reduction and circular mean -----------------------------------------
assert.ok(Math.abs(circularMeanDeg([359.9, 0.1]) - 0) < 1e-9 || Math.abs(circularMeanDeg([359.9, 0.1]) - 360) < 1e-9);
assert.ok(Math.abs(circularMeanDeg([10, 20]) - 15) < 1e-9);

// --- 2. Exact network: two occupations, face I and face II, P3 free -----------------
const readingsP1 = { P2: reading(P1, P2, HI, HT), P3: reading(P1, P3, HI, HT) };
const readingsP2 = { P1: reading(P2, P1, HI, HT), P3: reading(P2, P3, HI, HT) };
const observations = [];
for (const [station, sets] of [[P1, readingsP1], [P2, readingsP2]]) {
  const id = `rec${recordSeq++}`;
  for (const [target, r] of Object.entries(sets)) {
    observations.push(row(id, station.id, target, r, "Face1", HI, HT));
    observations.push(row(id, station.id, target, r, "Face2", HI, HT));
  }
}

const table = [
  { id: "P1", easting: P1.easting, northing: P1.northing, elevation: P1.elevation, fixedHorizontal: true, fixedHeight: true },
  { id: "P2", easting: P2.easting, northing: P2.northing, elevation: P2.elevation, fixedHorizontal: true, fixedHeight: false },
];
const data = { observations, means: [], setups: [], qc: { rowCount: 0, deletedCount: 0, meanRowCount: 0, unknownTargetCoordinates: 0 }, warnings: [] };
const built = networkFromJobXml(data, {
  aliases: new Map(),
  excludedSetups: new Set(),
  coordinates: mergeCoordinates(table, [{ id: "P3", easting: 1035, northing: 2065, elevation: 12, fixedHorizontal: false, fixedHeight: false }]),
  precision,
  includeDeleted: false,
});
assert.equal(built.dropped.length, 0, built.dropped.join("; "));
const slopes = built.observations.filter((o) => o.kind === "slope");
assert.equal(slopes.length, 4, "two occupations with two targets each give four slope observations");
const adjusted = adjustNetwork(built.points, built.observations, precision, {});
const p3 = adjusted.points.find((p) => p.id === "P3");
assert.ok(Math.abs(p3.easting - P3.easting) < 0.002, `P3 easting ${p3.easting}`);
assert.ok(Math.abs(p3.northing - P3.northing) < 0.002, `P3 northing ${p3.northing}`);
assert.ok(Math.abs(p3.elevation - P3.elevation) < 0.002, `P3 elevation ${p3.elevation}`);

// --- 3. Repeated occupation of P1 keeps its own observations ------------------------
const extraId = `rec${recordSeq++}`;
const extra = [row(extraId, "P1", "P3", readingsP1.P3, "Face1", HI, HT), row(extraId, "P1", "P3", readingsP1.P3, "Face2", HI, HT)];
const built2 = networkFromJobXml({ ...data, observations: [...observations, ...extra] }, {
  aliases: new Map(), excludedSetups: new Set(), coordinates: built.points, precision, includeDeleted: false,
});
assert.equal(built2.observations.filter((o) => o.kind === "slope").length, 5, "the repeated occupation adds its own slope");

// --- 4. Excluded setup and missing coordinates are reported ------------------------
const built3 = networkFromJobXml(data, {
  aliases: new Map(), excludedSetups: new Set(["P2"]), coordinates: table, precision, includeDeleted: false,
});
assert.ok(built3.dropped.some((d) => d.includes("P2") && d.includes("excluded")));
assert.ok(built3.dropped.some((d) => d.includes("P3") && d.includes("no coordinates")));

// --- 5. Table entries win over approximate values ----------------------------------
const approx = approximatePoints({
  ...data,
  setups: [{ recordId: "r", name: "P1", occurrence: 1, label: "P1", timestamp: "", easting: 1, northing: 1, elevation: 1, instrumentHeightM: 1.5, observationCount: 0 }],
  observations: [{ ...observations[0], target: "P3", targetE: 1040.1, targetN: 2070.1, targetZ: 12.4 }],
});
const merged = mergeCoordinates(table, approx);
assert.equal(merged.find((p) => p.id === "P1").easting, 1000, "table value kept for P1");
assert.equal(merged.find((p) => p.id === "P3").easting, 1040.1, "approximate value used for P3");
assert.equal(merged.find((p) => p.id === "P3").fixedHorizontal, false, "approximate points are never fixed");

// --- 6. An alias-only name with no observations does not leave the network undetermined ---
const withAlias = networkFromJobXml(data, {
  aliases: new Map([["P3ALT", "P3"]]),
  excludedSetups: new Set(),
  coordinates: mergeCoordinates(table, [
    { id: "P3", easting: 1035, northing: 2065, elevation: 12, fixedHorizontal: false, fixedHeight: false },
    { id: "P3ALT", easting: 1035, northing: 2065, elevation: 12, fixedHorizontal: false, fixedHeight: false },
  ]),
  precision,
  includeDeleted: false,
});
assert.ok(!withAlias.points.some((p) => p.id === "P3ALT"), "alias name is not an unknown point");
assert.ok(adjustNetwork(withAlias.points, withAlias.observations, precision, {}), "adjustment still solves");

console.log("validate-network-jxl: all checks passed");
