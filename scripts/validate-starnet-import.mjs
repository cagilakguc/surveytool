import assert from "node:assert/strict";
import { parseStarnetRaw } from "../src/lib/starnetRaw.ts";
import {
  buildNetworkInput,
  parseAliases,
  parseCoordinateTable,
} from "../src/lib/networkFromRaw.ts";
import { adjustNetwork } from "../src/lib/networkAdjustment.ts";

const HI = 1.5;
const HT = 1.6;
const precision = { distanceConstantM: 0.001, distancePpm: 2, angleStdDevSec: 5 };

// Truth in metres and heights.
const truth = {
  A: { e: 0, n: 0, h: 10, fixed: true },
  B: { e: 300, n: 0, h: 12, fixed: true },
  C: { e: 150, n: 260, h: 11, fixed: true },
  D: { e: 120, n: 90, h: 10.5, fixed: false },
  E: { e: 200, n: 130, h: 12.2, fixed: false },
  F: { e: 90, n: 200, h: 11.4, fixed: false },
};
const ids = Object.keys(truth);
const toGon = (deg) => (deg * 400) / 360;

const azimuthRad = (a, b) => Math.atan2(b.e - a.e, b.n - a.n);
const horizontal = (a, b) => Math.hypot(b.e - a.e, b.n - a.n);
const verticalDiff = (a, b) => b.h + HT - (a.h + HI);

/**
 * Writes a Starnet-style raw text. Every setup observes every other point in two faces.
 * `rename` maps a raw target name to an alternative spelling used only in the text.
 */
function rawText({ rename = {} } = {}) {
  const lines = ["# Starnet Traverse", "#  Job:  TEST JOB     Date: 01/01/2026       Time 10:00 hrs"];
  for (const setup of ids) {
    lines.push(`DB     ${rename[setup] ?? setup}`);
    for (const target of ids) {
      if (target === setup) continue;
      const a = truth[setup];
      const b = truth[target];
      const hd = horizontal(a, b);
      const sd = Math.hypot(hd, verticalDiff(a, b));
      const vzDeg = (Math.atan2(hd, verticalDiff(a, b)) * 180) / Math.PI;
      let hzDeg = (azimuthRad(a, b) * 180) / Math.PI;
      hzDeg = ((hzDeg % 360) + 360) % 360;
      const hzGon = toGon(hzDeg);
      const vzGon = toGon(vzDeg);
      const name = (rename[target] ?? target).padEnd(8);
      // Face I
      lines.push(
        `DM  ${name} ${hzGon.toFixed(6).padStart(10)}  ${sd.toFixed(4).padStart(10)}  ${vzGon.toFixed(6).padStart(10)}       ${HI.toFixed(3)}/${HT.toFixed(3)}      #      Round Prism`,
      );
      // Face II
      const hz2 = (hzGon + 200) % 400;
      const vz2 = 400 - vzGon;
      lines.push(
        `DM  ${name} ${hz2.toFixed(6).padStart(10)}  ${sd.toFixed(4).padStart(10)}  ${vz2.toFixed(6).padStart(10)}       ${HI.toFixed(3)}/${HT.toFixed(3)}      #      Round Prism`,
      );
    }
  }
  return lines.join("\r\n");
}

// 1. Parsing and face reduction.
{
  const raw = parseStarnetRaw(rawText());
  assert.equal(raw.qc.job, "TEST JOB");
  assert.equal(raw.readings.length, ids.length * (ids.length - 1) * 2);
  assert.equal(raw.pairs.length, ids.length * (ids.length - 1));
  assert.equal(raw.qc.unpairedFaces.length, 0);
  assert.equal(raw.qc.skippedLines.length, 0);
  // Both faces reduced to the same direction: spread should be essentially zero.
  for (const pair of raw.pairs) {
    assert.ok(pair.hzSpreadMgon < 1e-3, `hz spread ${pair.hzSpreadMgon}`);
  }
}

// 2. Full chain: raw text → network observations → adjustment recovers the truth.
{
  const raw = parseStarnetRaw(rawText());
  const coordinates = ids.map((id) => {
    const t = truth[id];
    const free = !t.fixed;
    return {
      id,
      easting: t.e + (free ? 4 : 0),
      northing: t.n + (free ? -3 : 0),
      elevation: t.h + (free ? 0.5 : 0),
      fixedHorizontal: t.fixed,
      fixedHeight: t.fixed,
    };
  });
  const built = buildNetworkInput(raw, {
    aliases: new Map(),
    excludedSetups: new Set(),
    coordinates,
    precision,
  });
  const result = adjustNetwork(built.points, built.observations, precision);
  for (const point of result.points) {
    const t = truth[point.id];
    assert.ok(Math.abs(point.easting - t.e) < 1e-4, `${point.id} E ${point.easting - t.e}`);
    assert.ok(Math.abs(point.northing - t.n) < 1e-4, `${point.id} N ${point.northing - t.n}`);
    assert.ok(Math.abs(point.elevation - t.h) < 1e-4, `${point.id} H ${point.elevation - t.h}`);
  }
}

// 3. Alias: a target written as "D_A" in the raw file is mapped back to "D".
{
  const raw = parseStarnetRaw(rawText({ rename: { D: "D_A" } }));
  const coordinates = ids.map((id) => ({
    id,
    easting: truth[id].e + (truth[id].fixed ? 0 : 3),
    northing: truth[id].n + (truth[id].fixed ? 0 : -2),
    elevation: truth[id].h + (truth[id].fixed ? 0 : 0.3),
    fixedHorizontal: truth[id].fixed,
    fixedHeight: truth[id].fixed,
  }));
  const aliases = parseAliases("D_A = D");
  const built = buildNetworkInput(raw, {
    aliases,
    excludedSetups: new Set(),
    coordinates,
    precision,
  });
  const result = adjustNetwork(built.points, built.observations, precision);
  const d = result.points.find((p) => p.id === "D");
  assert.ok(Math.abs(d.easting - truth.D.e) < 1e-4);
  assert.ok(Math.abs(d.elevation - truth.D.h) < 1e-4);
}

// 4. Excluded setups and targets without coordinates are reported, not silently used.
{
  const raw = parseStarnetRaw(rawText());
  const coordinates = ids
    .filter((id) => id !== "F")
    .map((id) => ({
      id,
      easting: truth[id].e,
      northing: truth[id].n,
      elevation: truth[id].h,
      fixedHorizontal: true,
      fixedHeight: true,
    }));
  const built = buildNetworkInput(raw, {
    aliases: new Map(),
    excludedSetups: new Set(["E"]),
    coordinates,
    precision,
  });
  assert.ok(built.dropped.some((d) => d.includes("excluded by user")));
  assert.ok(built.dropped.some((d) => d.includes("F")));
  assert.ok(!built.observations.some((o) => (o.from ?? o.station) === "E"));
}

// 5. Coordinate table parsing.
{
  const points = parseCoordinateTable("id,easting,northing,elevation,fixed\nA,0,0,10,XYZ\nD,120,90,10.5,\nB,300,0,12,Z");
  assert.equal(points.length, 3);
  assert.equal(points[0].fixedHorizontal, true);
  assert.equal(points[0].fixedHeight, true);
  assert.equal(points[1].fixedHorizontal, false);
  assert.equal(points[2].fixedHorizontal, false);
  assert.equal(points[2].fixedHeight, true);
}

console.log("Starnet import validation passed.");
