import assert from "node:assert/strict"
import { calculateLeveling, parseLevelCsv } from "../src/lib/geometricLeveling.ts"

const sample = [
  "setup,point,sight,reading_m,distance_m",
  "S1,BM_A,BS,1.455,30",
  "S1,TP1,FS,1.115,35",
  "S2,TP1,BS,1.630,42",
  "S2,P101,IS,1.755,20",
  "S2,BM_B,FS,1.425,43",
].join("\n")

const close = (actual, expected, epsilon = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, "Expected " + expected + " but got " + actual)

// 1. Tied levelling line: arithmetic, computed and adjusted end RL and tolerance.
const parsed = parseLevelCsv(sample)
assert.equal(parsed.length, 5)
const result = calculateLeveling(parsed, {
  startElevationM: 100, knownEndElevationM: 100.543, toleranceMmSqrtKm: 12, method: "distance",
})
assert.equal(result.startPoint, "BM_A")
assert.equal(result.endPoint, "BM_B")
assert.equal(result.methodUsed, "distance")
assert.equal(result.legs.length, 2)
assert.equal(result.rows.length, 5)
assert.equal(result.totalDistanceM, 150)
close(result.sumBSM - result.sumFSM, .545)
close(result.computedEndElevationM, 100.545)
close(result.misclosureM, .002)
close(result.adjustedEndElevationM, 100.543)
close(result.legs[0].rawToElevationM, 100.34)
close(result.legs[0].correctionM, -.002 * (65 / 150))
close(result.rows[3].rawElevationM, 100.215)
close(result.rows[3].adjustedElevationM, 100.215 - .002 * (65 / 150))
assert.equal(result.withinTolerance, true)
close(result.toleranceMm, 12 * Math.sqrt(.15))

// 2. IS side shots do not contribute to BS-FS closure.
const withoutIS = calculateLeveling(parsed.filter((r) => r.sight !== "IS"), {
  startElevationM: 100, knownEndElevationM: 100.543,
})
close(withoutIS.misclosureM, result.misclosureM)
close(withoutIS.computedEndElevationM, result.computedEndElevationM)

// 3. Closed loop: returning to same benchmark infers known end RL.
const loop = parseLevelCsv([
  "setup,point,sight,reading_m,distance_m",
  "S1,A,BS,1.0,20",
  "S1,B,FS,0.9,20",
  "S2,B,BS,1.0,20",
  "S2,A,FS,1.1,20",
].join("\n"))
const loopResult = calculateLeveling(loop, { startElevationM: 10 })
close(loopResult.misclosureM, 0)
close(loopResult.adjustedEndElevationM, 10)
assert.throws(() => calculateLeveling(loop, {
  startElevationM: 10, knownEndElevationM: 11,
}), /must match/)

// 4. Open line: no known end means no correction/tolerance assertion.
const open = calculateLeveling(parsed, { startElevationM: 100 })
assert.equal(open.misclosureM, null)
assert.equal(open.withinTolerance, null)
close(open.rows.at(-1).adjustedElevationM, 100.545)

// 5. Default is explicitly equal per setup, never an automatic switch.
const missingDistance = parseLevelCsv(sample.replace("S1,TP1,FS,1.115,35", "S1,TP1,FS,1.115,"))
const fallback = calculateLeveling(missingDistance, { startElevationM: 100, knownEndElevationM: 100.543 })
assert.equal(fallback.methodUsed, "setups")
assert.equal(fallback.toleranceMm, null)
assert.equal(fallback.withinTolerance, null)
close(fallback.legs[0].correctionM, -.001)
assert.throws(() => calculateLeveling(missingDistance, {
  startElevationM: 100, knownEndElevationM: 100.543, method: "distance",
}), /need both BS and FS sight distances/)

// 6. Both explicitly selected methods share the same closure but allocate it differently.
const equalMethod = calculateLeveling(parsed, {
  startElevationM: 100, knownEndElevationM: 100.543, method: "setups",
})
assert.equal(equalMethod.methodUsed, "setups")
close(equalMethod.legs[0].correctionM, -.001)
close(equalMethod.legs[1].correctionM, -.002)
close(result.legs[0].correctionM, -.002 * (65 / 150))
close(result.legs[1].correctionM, -.002)
assert.notEqual(equalMethod.legs[0].correctionM, result.legs[0].correctionM)
close(equalMethod.misclosureM, result.misclosureM)
close(equalMethod.adjustedEndElevationM, result.adjustedEndElevationM)
close(result.rows[2].correctionM, result.legs[0].correctionM)
close(equalMethod.rows[2].correctionM, equalMethod.legs[0].correctionM)
assert.throws(() => calculateLeveling(parsed, {
  startElevationM: 100, knownEndElevationM: 100.543, method: "auto",
}), /Choose correction distribution/)

// 7. User-selected tolerance and failure warning.
const failure = calculateLeveling(parsed, {
  startElevationM: 100, knownEndElevationM: 100.53, toleranceMmSqrtKm: 12,
})
assert.equal(failure.withinTolerance, false)
assert.ok(failure.notes.some((note) => note.includes("exceeds")))

// 8. Broken BS/FS chain must be rejected.
const badChain = parsed.map((r) => r.setup === "S2" && r.sight === "BS" ? { ...r, point: "WRONG" } : r)
assert.throws(() => calculateLeveling(badChain, { startElevationM: 100 }), /does not match previous turning point/)

// 9. Each setup must have exactly one BS followed by a final FS.
assert.throws(() => calculateLeveling(parsed.map((r) =>
  r.setup === "S1" && r.sight === "FS" ? { ...r, sight: "IS" } : r,
), { startElevationM: 100 }), /start with BS and end with FS/)

// 10. Quoted fields and semicolon delimiters.
const quoted = parseLevelCsv([
  "setup;point;type;reading_m;distance_m",
  'S1;"BM, A";BS;1.500;20',
  "S1;TP;FS;1.000;20",
].join("\n"))
assert.equal(quoted[0].point, "BM, A")
close(calculateLeveling(quoted, { startElevationM: 12 }).computedEndElevationM, 12.5)

// 11. Non-consecutive reused setup ID is rejected.
const duplicateSetup = parsed.map((r, i) => i === 4 ? { ...r, setup: "S1" } : r)
assert.throws(() => calculateLeveling(duplicateSetup, { startElevationM: 100 }), /separate blocks/)

// 12. Explicit zero and bad readings checked; blank reading is invalid.
assert.equal(parseLevelCsv("setup,point,sight,reading\nS1,A,BS,0\nS1,B,FS,1")[0].readingM, 0)
assert.throws(() => parseLevelCsv("setup,point,sight,reading\nS1,A,BS,\nS1,B,FS,1"), /invalid staff reading/)

console.log("validate-geometric-leveling: all checks passed")
