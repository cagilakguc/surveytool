import assert from "node:assert/strict";
import { adjustNetwork } from "../src/lib/networkAdjustment.ts";
import { checkTraverseClosure } from "../src/lib/traverseClosure.ts";

const precision = {
  distanceConstantM: 0.001,
  distancePpm: 2,
  angleStdDevSec: 5,
};
const ARCSEC_DEG = 1 / 3600;
const HI = 1.5;
const HT = 1.6;

// Deterministic pseudo-random generator so the results are repeatable.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random) {
  const u = Math.max(random(), 1e-12);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Truth: three fixed control points (horizontal and height) and three free points.
const truth = {
  A: { easting: 0, northing: 0, elevation: 10, fixed: true },
  B: { easting: 300, northing: 0, elevation: 12, fixed: true },
  C: { easting: 150, northing: 260, elevation: 11, fixed: true },
  D: { easting: 120, northing: 90, elevation: 10.5, fixed: false },
  E: { easting: 200, northing: 130, elevation: 12.2, fixed: false },
  F: { easting: 90, northing: 200, elevation: 11.4, fixed: false },
};
const ids = Object.keys(truth);
const freeIds = ids.filter((id) => !truth[id].fixed);

const azimuthDeg = (from, to) =>
  (Math.atan2(to.easting - from.easting, to.northing - from.northing) * 180) /
  Math.PI;

const angleDeg = (station, backsight, foresight) =>
  (((azimuthDeg(station, foresight) - azimuthDeg(station, backsight)) % 360) +
    360) %
  360;

const horizontal = (a, b) =>
  Math.hypot(b.easting - a.easting, b.northing - a.northing);

const slopeOf = (a, b) => {
  const dz = b.elevation + HT - (a.elevation + HI);
  return Math.hypot(horizontal(a, b), dz);
};

const zenithOf = (a, b) => {
  const dz = b.elevation + HT - (a.elevation + HI);
  return (Math.atan2(horizontal(a, b), dz) * 180) / Math.PI;
};

function buildObservations(random, noisy) {
  const observations = [];
  const gauss = (sigma) => (noisy ? sigma * gaussian(random) : 0);

  for (const from of ids) {
    for (const to of ids) {
      if (from === to) continue;
      const a = truth[from];
      const b = truth[to];
      const s = slopeOf(a, b);
      const sigmaS = Math.hypot(precision.distanceConstantM, precision.distancePpm * 1e-6 * s);
      observations.push({
        kind: "slope",
        from,
        to,
        instrumentHeight: HI,
        targetHeight: HT,
        slopeDistance: s + gauss(sigmaS),
      });
      observations.push({
        kind: "zenith",
        from,
        to,
        instrumentHeight: HI,
        targetHeight: HT,
        zenithDeg: zenithOf(a, b) + gauss(5 * ARCSEC_DEG),
      });
    }
  }

  for (const station of freeIds) {
    const others = ids.filter((id) => id !== station);
    for (let i = 0; i < others.length; i++) {
      for (let j = i + 1; j < others.length; j++) {
        const value =
          angleDeg(truth[station], truth[others[i]], truth[others[j]]) +
          gauss(5 * ARCSEC_DEG);
        observations.push({
          kind: "angle",
          station,
          backsight: others[i],
          foresight: others[j],
          angleDeg: ((value % 360) + 360) % 360,
        });
      }
    }
  }
  return observations;
}

function pointsWithApproximations() {
  return ids.map((id) => {
    const t = truth[id];
    const free = !t.fixed;
    return {
      id,
      easting: t.easting + (free ? 4 : 0),
      northing: t.northing + (free ? -3 : 0),
      elevation: t.elevation + (free ? 0.5 : 0),
      fixedHorizontal: t.fixed,
      fixedHeight: t.fixed,
    };
  });
}

// 1. Noise-free observations must recover the truth, including heights.
{
  const result = adjustNetwork(
    pointsWithApproximations(),
    buildObservations(mulberry32(1), false),
    precision,
  );
  for (const point of result.points) {
    const t = truth[point.id];
    assert.ok(Math.abs(point.easting - t.easting) < 1e-6, `${point.id} easting`);
    assert.ok(Math.abs(point.northing - t.northing) < 1e-6, `${point.id} northing`);
    assert.ok(Math.abs(point.elevation - t.elevation) < 1e-6, `${point.id} elevation`);
  }
  assert.ok(result.sigma0 < 1e-4, `sigma0 should be ~0, got ${result.sigma0}`);
  assert.equal(result.flaggedCount, 0);
}

// 2. Noisy observations: plausible sigma0, redundancy sums to the degrees of freedom, heights have uncertainty.
{
  const sigma0s = [];
  for (let seed = 2; seed < 17; seed++) {
    const result = adjustNetwork(
      pointsWithApproximations(),
      buildObservations(mulberry32(seed), true),
      precision,
    );
    sigma0s.push(result.sigma0);
    const redundancySum = result.observations.reduce((sum, o) => sum + o.redundancy, 0);
    assert.ok(
      Math.abs(redundancySum - result.degreesOfFreedom) < 1e-6,
      `redundancy sum ${redundancySum} must equal degrees of freedom ${result.degreesOfFreedom}`,
    );
    for (const point of result.points) {
      if (point.fixedHeight) continue;
      assert.ok(point.elevationStdDev > 0 && point.elevationStdDev < 0.05);
    }
  }
  const mean = sigma0s.reduce((a, b) => a + b, 0) / sigma0s.length;
  assert.ok(mean > 0.6 && mean < 1.4, `mean sigma0 should be near 1, got ${mean}`);
}

// 3. A gross slope-distance blunder must be flagged.
{
  const observations = buildObservations(mulberry32(42), true);
  const blunderIndex = observations.findIndex((o) => o.kind === "slope");
  observations[blunderIndex] = {
    ...observations[blunderIndex],
    slopeDistance: observations[blunderIndex].slopeDistance + 0.3,
  };
  const result = adjustNetwork(pointsWithApproximations(), observations, precision);
  assert.ok(result.observations[blunderIndex].flagged, "blunder should be flagged");
}

// 4. Invalid input must produce clear errors.
{
  const observations = buildObservations(mulberry32(7), true);

  const oneHorizontal = pointsWithApproximations().map((p) => ({
    ...p,
    fixedHorizontal: p.id === "A",
  }));
  assert.throws(
    () => adjustNetwork(oneHorizontal, observations, precision),
    /two points with fixed easting and northing/,
  );

  const noHeight = pointsWithApproximations().map((p) => ({ ...p, fixedHeight: false }));
  assert.throws(
    () => adjustNetwork(noHeight, observations, precision),
    /fixed elevation/,
  );

  assert.throws(
    () =>
      adjustNetwork(
        pointsWithApproximations(),
        [{ kind: "slope", from: "A", to: "Z", instrumentHeight: HI, targetHeight: HT, slopeDistance: 10 }],
        precision,
      ),
    /unknown to point "Z"|unknown \w+ point "Z"/,
  );

  assert.throws(
    () =>
      adjustNetwork(
        pointsWithApproximations(),
        [{ kind: "zenith", from: "A", to: "B", instrumentHeight: HI, targetHeight: HT, zenithDeg: 200 }],
        precision,
      ),
    /zenith angle between 0 and 180/,
  );

  assert.throws(
    () =>
      adjustNetwork(
        pointsWithApproximations(),
        [{ kind: "slope", from: "A", to: "B", instrumentHeight: HI, targetHeight: HT, slopeDistance: 300 }],
        precision,
      ),
    /Not enough observations/,
  );
}

// 5. Traverse closure. Known start and end, square-ish polygon with a clean geometry.
//    Start (0,0) with backsight (0,-100); legs east, north, west, south to end (0,50).
const cleanTraverse = {
  start: { e: 0, n: 0 },
  startBacksight: { e: 0, n: -100 },
  stations: [
    { angleDeg: 270, distance: 100 },
    { angleDeg: 90, distance: 100 },
    { angleDeg: 90, distance: 100 },
    { angleDeg: 90, distance: 50 },
  ],
  end: { e: 0, n: 50 },
  endBacksight: { e: 50, n: 50 },
  endAngleDeg: 90,
  angleStdDevSec: 5,
};
{
  const exact = checkTraverseClosure(cleanTraverse);
  assert.ok(exact.linearMisclosure < 1e-9, `linear ${exact.linearMisclosure}`);
  assert.ok(Math.abs(exact.angularMisclosureSec) < 1e-6, `angular ${exact.angularMisclosureSec}`);
  assert.equal(exact.precisionDenominator, Infinity);
  assert.equal(exact.warnings.length, 0);
}
{
  // A 0.02 m distance error on one leg: the end misclosure is 0.02 m, precision 1:17500.
  const small = checkTraverseClosure({
    ...cleanTraverse,
    stations: cleanTraverse.stations.map((s, i) => (i === 1 ? { ...s, distance: s.distance + 0.02 } : s)),
  });
  assert.ok(Math.abs(small.linearMisclosure - 0.02) < 1e-9, `linear ${small.linearMisclosure}`);
  assert.ok(small.precisionDenominator > 5000);
  assert.equal(small.precisionWarning, false);
}
{
  // A 0.2 m distance error drops the precision below 1:5000.
  const large = checkTraverseClosure({
    ...cleanTraverse,
    stations: cleanTraverse.stations.map((s, i) => (i === 1 ? { ...s, distance: s.distance + 0.2 } : s)),
  });
  assert.ok(large.precisionDenominator < 5000);
  assert.equal(large.precisionWarning, true);
}
{
  // A 0.01° (36") angle error at one station exceeds 3σ√n for 5" angles over 5 measurements.
  const bad = checkTraverseClosure({
    ...cleanTraverse,
    stations: cleanTraverse.stations.map((s, i) => (i === 1 ? { ...s, angleDeg: s.angleDeg + 0.01 } : s)),
  });
  assert.ok(Math.abs(bad.angularMisclosureSec - 36) < 0.5, `angular ${bad.angularMisclosureSec}`);
  assert.equal(bad.angularWarning, true);
}

console.log("Network adjustment and traverse closure validation passed.");
