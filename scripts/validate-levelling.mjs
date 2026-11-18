import assert from "node:assert/strict";
import { adjustLevelling, parseLevellingCsv } from "../src/lib/levelling.ts";

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-10, `${message}: ${actual} ≠ ${expected}`);
const run = {
  start: "BM1", end: "BM2", startElevation: 100, endElevation: 100.5,
  legs: [
    { to: "TP1", backsight: 1.255, foresight: 1.005, setups: 1, distance: 120 },
    { to: "BM2", backsight: 1.380, foresight: 1.125, setups: 2, distance: 180 },
  ],
};

// 505 mm observed rise against 500 mm known rise: 5 mm must be removed.
const bySetups = adjustLevelling({ ...run, method: "setups", toleranceMm: 4 });
close(bySetups.misclosure, 0.005, "closure");
close(bySetups.legs[0].correction, -0.005 / 3, "one-setup correction");
close(bySetups.legs[1].correction, -0.010 / 3, "two-setup correction");
close(bySetups.legs[0].adjustedElevation, 100.25 - 0.005 / 3, "first adjusted RL");
close(bySetups.legs[1].adjustedElevation, 100.5, "end benchmark");
assert.equal(bySetups.totalSetups, 3);
assert.equal(bySetups.withinTolerance, false);

const byDistance = adjustLevelling({ ...run, method: "distance", toleranceMm: 5 });
close(byDistance.legs[0].correction, -0.002, "120 m correction");
close(byDistance.legs[1].correction, -0.003, "180 m correction");
close(byDistance.legs[0].adjustedElevation, 100.248, "first distance-adjusted RL");
close(byDistance.legs[1].adjustedElevation, 100.5, "distance-adjusted end benchmark");
assert.equal(byDistance.withinTolerance, true);

// A loop can close onto its own start benchmark. Distance is optional in setup mode.
const loop = adjustLevelling({ start: "BM", end: "BM", startElevation: 50, endElevation: 50, method: "setups", legs: [{ to: "BM", backsight: 1.23, foresight: 1.23, setups: 1, distance: null }] });
close(loop.misclosure, 0, "loop closure");
assert.equal(loop.totalDistance, null);
assert.equal(loop.withinTolerance, null);

assert.throws(() => adjustLevelling({ ...run, method: "distance", legs: [{ ...run.legs[0], distance: null }, run.legs[1] ] }), /distance/i);
assert.throws(() => adjustLevelling({ ...run, method: "setups", legs: [{ ...run.legs[0], foresight: NaN }, run.legs[1] ] }), /foresight/i);
assert.throws(() => adjustLevelling({ ...run, method: "setups", legs: [{ ...run.legs[0], setups: 0 }, run.legs[1] ] }), /setup/i);
assert.throws(() => adjustLevelling({ ...run, method: "setups", legs: [{ ...run.legs[0], to: "BM2" }, run.legs[1] ] }), /repeated/i);
assert.throws(() => adjustLevelling({ ...run, method: "setups", legs: [{ ...run.legs[0], distance: -1 }, run.legs[1] ] }), /distance/i);

assert.deepEqual(parseLevellingCsv("to,bs,fs,setups,distance\nTP1,1.255,1.005,1,120\nBM2,1.380,1.125,2,180"), run.legs);
assert.deepEqual(parseLevellingCsv('"TP; 1";1.25;1.00\nBM2;1.35;1.10').map((x) => [x.to, x.setups, x.distance]), [["TP; 1", 1, null], ["BM2", 1, null]]);
assert.throws(() => parseLevellingCsv("to,bs,fs\nBM2,,1.2").reduce((_, leg) => adjustLevelling({ ...run, method: "setups", legs: [leg] }), null), /backsight/i);
console.log("Levelling: setup weighting, distance weighting, closed loop, validation and CSV import passed.");
