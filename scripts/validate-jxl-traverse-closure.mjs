import assert from "node:assert/strict"
import { buildJobXmlClosureInput } from "../src/lib/jobXmlTraverseClosure.ts"
import { checkTraverseClosure } from "../src/lib/traverseClosure.ts"

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const p = (id, easting, northing, elevation = 10) => ({ id, easting, northing, elevation })
const X = p("X", 0, 0, 11)
const A = p("A", 100, 0, 10)
const D = p("D", 145, 75, 10.3)
const E = p("E", 225, 90, 10.8)
const B = p("B", 300, 45, 11.1)
const Y = p("Y", 375, 110, 9.9)
const targets = { X, A, D, E, B, Y }
const sequence = ["A", "D", "E", "B"]
const control = [X, A, B, Y].map((point) => ({
  ...point, fixedHorizontal: true, fixedHeight: true,
}))
const precision = {
  distanceConstantM: 0.001, distancePpm: 1.5,
  angleStdDevSec: 1.62, zenithStdDevSec: 3.24,
}
const options = {
  aliases: new Map(),
  excludedSetups: new Set(),
  coordinates: control,
  precision,
}
const closure = {
  sequence,
  startBacksight: "X",
  endBacksight: "Y",
  angleStdDevSec: precision.angleStdDevSec,
  minimumPrecisionDenominator: 5000,
}

let counter = 0
function reading(setupRecordId, setup, target, face, deleted = false) {
  const s = targets[setup]
  const t = targets[target]
  const dE = t.easting - s.easting
  const dN = t.northing - s.northing
  const dZ = t.elevation - s.elevation
  const hz = ((Math.atan2(dE, dN) * DEG) % 360 + 360) % 360
  const v = Math.atan2(Math.hypot(dE, dN), dZ) * DEG
  counter++
  return {
    observationNumber: counter,
    timestamp: new Date(1794440000000 + counter * 1000).toISOString(),
    setupRecordId,
    setupName: setup,
    instrumentHeightM: 1.5,
    target,
    pointCode: "",
    classification: "Normal",
    face,
    hzDeg: face === "Face2" ? (hz + 180) % 360 : hz,
    vDeg: face === "Face2" ? 360 - v : v,
    slopeM: Math.hypot(dE, dN, dZ),
    targetHeightM: 1.5,
    deleted,
    targetE: t.easting,
    targetN: t.northing,
    targetZ: t.elevation,
  }
}
const legs = [
  ["A", "X", "D"],
  ["D", "A", "E"],
  ["E", "D", "B"],
  ["B", "E", "Y"],
]
const observations = []
const setups = []
for (const [setup, previous, next] of legs) {
  const recordId = "occ-" + setup
  setups.push({
    recordId, name: setup, occurrence: 1, label: setup,
    timestamp: new Date(1794440000000 + (setups.length * 60_000)).toISOString(),
    easting: targets[setup].easting, northing: targets[setup].northing,
    elevation: targets[setup].elevation,
    instrumentHeightM: 1.5, observationCount: 4,
  })
  for (const target of [previous, next]) {
    observations.push(reading(recordId, setup, target, "Face1"))
    observations.push(reading(recordId, setup, target, "Face2"))
  }
}
const data = {
  observations, setups, means: [], warnings: [],
  qc: { rowCount: observations.length, deletedCount: 0, meanRowCount: 0, unknownTargetCoordinates: 0 },
}

// 1. Perfect tied traverse: elevations vary but reduced horizontal lengths are correct.
const built = buildJobXmlClosureInput(data, options, closure)
assert.equal(built.input.stations.length, 3)
assert.equal(built.warnings.length, 0)
const result = checkTraverseClosure(built.input)
assert.ok(result.linearMisclosure < 1e-7, "perfect traverse closes in plan")
assert.ok(Math.abs(result.angularMisclosureSec) < 1e-5, "orientation check closes")
assert.equal(result.angularWarning, false)
assert.equal(result.precisionWarning, false)

// 2. A known endpoint offset produces the corresponding pre-adjustment misclosure.
const offset = buildJobXmlClosureInput(data, {
  ...options,
  coordinates: control.map((point) => point.id === "B" ? { ...point, easting: point.easting + 0.15 } : point),
}, closure)
const offsetResult = checkTraverseClosure(offset.input)
assert.ok(Math.abs(offsetResult.linearMisclosure - 0.15) < 1e-7)

// 3. No controller approximate coordinates may stand in for fixed XY control.
assert.throws(() => buildJobXmlClosureInput(data, {
  ...options, coordinates: control.filter((point) => point.id !== "Y"),
}, closure), /fixed XY control/)
assert.throws(() => buildJobXmlClosureInput(data, {
  ...options, coordinates: control.map((point) => point.id === "B" ? { ...point, fixedHorizontal: false } : point),
}, closure), /fixed XY control/)

// 4. Readings of a turned angle must belong to the same occupation.
const split = data.observations.map((obs) =>
  obs.setupName === "D" && obs.target === "E" ? { ...obs, setupRecordId: "new-occupation" } : obs,
)
assert.throws(() => buildJobXmlClosureInput({ ...data, observations: split }, options, closure), /same instrument occupation/)

// 5. Deleted end-orientation readings must not be used.
const withoutOrientation = data.observations.map((obs) =>
  obs.setupName === "B" && obs.target === "Y" ? { ...obs, deleted: true } : obs,
)
assert.throws(() => buildJobXmlClosureInput({ ...data, observations: withoutOrientation }, options, closure), /same instrument occupation/)

// 6. Repeated complete occupations raise a warning and use the first deterministically.
const repeats = data.observations
  .filter((obs) => obs.setupName === "D")
  .map((obs) => ({ ...obs, setupRecordId: "later-D", timestamp: "2026-11-12T14:00:00Z" }))
const withRepeats = buildJobXmlClosureInput(
  { ...data, observations: [...data.observations, ...repeats] }, options, closure,
)
assert.equal(withRepeats.warnings.length, 1)
assert.match(withRepeats.warnings[0], /suitable occupations/)

// 7. Explicit aliases apply to the closure sequence and target observations.
const aliased = data.observations.map((obs) =>
  obs.target === "D" ? { ...obs, target: "D-old" } : obs,
)
const aliasedBuilt = buildJobXmlClosureInput(
  { ...data, observations: aliased },
  { ...options, aliases: new Map([["D-old", "D"]]) },
  closure,
)
assert.ok(checkTraverseClosure(aliasedBuilt.input).linearMisclosure < 1e-7)

// 8. Orientation target cannot be the adjacent traverse station.
assert.throws(() => buildJobXmlClosureInput(data, options, {
  ...closure, endBacksight: "E",
}), /orientation point must differ/)

// 9. Trigonometric height closure uses slope, zenith and instrument/target heights.
assert.ok(built.heightClosure, "start/end fixed heights allow height closure")
assert.equal(built.heightClosure.legs.length, 3)
assert.ok(Math.abs(built.heightClosure.totalRiseM - (B.elevation - A.elevation)) < 1e-8)
assert.ok(Math.abs(built.heightClosure.misclosureM) < 1e-8)

// 10. End control Z offset is detected as vertical misclosure.
const raisedControl = buildJobXmlClosureInput(data, {
  ...options,
  coordinates: control.map((point) => point.id === "B" ? { ...point, elevation: point.elevation + .02 } : point),
}, closure)
assert.ok(Math.abs(raisedControl.heightClosure.misclosureM + .02) < 1e-8)

// 11. Starting and ending height control must be explicitly fixed, not approximate.
const missingFixedHeight = buildJobXmlClosureInput(data, {
  ...options,
  coordinates: control.map((point) => point.id === "B" ? { ...point, fixedHeight: false } : point),
}, closure)
assert.equal(missingFixedHeight.heightClosure, null)
assert.match(missingFixedHeight.warnings[0], /fixed Z control/)

// 12. A deliberate +10 mm change in HI propagates into the height misclosure.
const hiShift = {
  ...data,
  observations: data.observations.map((obs) =>
    obs.setupName === "A" && obs.target === "D"
      ? { ...obs, instrumentHeightM: obs.instrumentHeightM + .01 }
      : obs,
  ),
}
const shiftedHeight = buildJobXmlClosureInput(hiShift, options, closure)
assert.ok(Math.abs(shiftedHeight.heightClosure.misclosureM - .01) < 1e-8)

console.log("validate-jxl-traverse-closure: all checks passed")
