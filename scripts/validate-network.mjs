import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { adjustNetwork, angleDifference, secondsToRadians } from "../src/lib/networkAdjustment.ts"
import { chiSquareQuantile } from "../src/lib/networkMath.ts"
import { networkExample } from "../src/lib/networkExamples.ts"
import { defaultNetworkSettings, editObservationInclusion, networkCsv, parseNetwork, parseNetworkAngle } from "../src/lib/networkInput.ts"
import { networkPointRows, networkResidualRows, networkCovarianceCsv } from "../src/lib/networkReports.ts"
import { parseProjectFile, workspaceId } from "../src/lib/projectWorkspace.ts"

const near = (a, b, tolerance = 1e-7, message = "reference comparison") => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} != ${b} (tol ${tolerance})`)
const reference = JSON.parse(fs.readFileSync("scripts/data/network-reference.json", "utf8"))
const outputs = []
for (const c of reference.cases) {
  const before = structuredClone(c.input), result = adjustNetwork(c.input)
  for (const p of result.points) {
    if (p.fixed) { const original = c.input.points.find(q => q.id === p.id); assert.equal(p.easting, original.easting); assert.equal(p.northing, original.northing); assert.equal(p.height, original.height) }
    else if (c.input.mode === "level") near(p.height, c.coordinates[p.id][0], 1e-8)
    else { near(p.easting, c.coordinates[p.id][0], 2e-7); near(p.northing, c.coordinates[p.id][1], 2e-7) }
  }
  near(result.statistics.weightedSum, c.weightedSum, 2e-7, "independent residual objective")
  const active = result.residuals.filter(r => r.enabled)
  for (let i = 0; i < active.length; i++) { near(active[i].residual, c.residuals[i], active[i].type === "HD" || active[i].type === "DH" ? 2e-7 : 2e-9); near(active[i].redundancy, c.redundancy[i], 1e-5) }
  near(active.reduce((s, r) => s + r.redundancy, 0), result.statistics.dof, 1e-7, "redundancy sum")
  for (let i = 0; i < result.covariance.length; i++) for (let j = 0; j < result.covariance.length; j++) near(result.covariance[i][j], c.covariance[i][j], Math.max(1e-15, Math.abs(c.covariance[i][j]) * 1e-5), "independent covariance")
  for (let i = 0; i < c.orientations.length; i++) near(angleDifference(result.orientations[i].degrees * Math.PI / 180 - c.orientations[i]), 0, 2e-9)
  near(result.statistics.chiLower, c.chiBounds[0], 1e-10); near(result.statistics.chiUpper, c.chiBounds[1], 1e-10)
  assert.deepEqual(c.input, before, "adjustment must not change the source network")
  assert.equal(result.statistics.globalTest, "pass", "synthetic examples demonstrate a consistent network")
  outputs.push({ input: c.input, result })
}
for (const q of reference.chiSquareQuantiles) near(chiSquareQuantile(q.p, q.dof), q.value, Math.max(1e-10, q.value * 1e-11), "SciPy chi-square quantile")

// Closed-form unequal-weight benchmark tie, independent of either implementation.
const level = parseNetwork("Point,RL,Fixed\nA,100,true\nB,,false\nC,101,true", "ID,Type,From,To,Value,Sigma\na,DH,A,B,0.4,1\nb,DH,B,C,0.602,2", defaultNetworkSettings)
const lr = adjustNetwork(level)
near(lr.points[1].height, 100.3996, 1e-10); near(lr.covariance[0][0], 8e-7, 1e-16)
near(lr.residuals[0].residual, -.0004, 1e-12); near(lr.residuals[1].residual, -.0016, 1e-12); near(lr.statistics.weightedSum, .8, 1e-9)
near(lr.closures[0].misclosure, .002, 1e-12); assert.equal(lr.statistics.dof, 1)
const reversed = structuredClone(level)
for (const o of reversed.observations) { [o.from, o.to] = [o.to, o.from]; o.value *= -1 }
near(adjustNetwork(reversed).points[1].height, lr.points[1].height, 1e-10)
const excluded = structuredClone(level); excluded.observations[0].enabled = false
const er = adjustNetwork(excluded); assert.equal(er.statistics.dof, 0); assert.equal(er.statistics.globalTest, "unavailable"); assert.equal(er.statistics.varianceFactor, null); assert.equal(er.residuals[0].flag, "excluded"); assert.equal(er.residuals[1].standardized, null)
const allFixed = structuredClone(level); allFixed.points[1].fixed = true; allFixed.points[1].height = 100.4
assert.equal(adjustNetwork(allFixed).statistics.unknowns, 0)
const blunder = structuredClone(level); blunder.observations[1].value += .1
const br = adjustNetwork(blunder); assert.equal(br.statistics.globalTest, "high"); assert.ok(br.statistics.reviewCount > 0); assert.equal(br.statistics.observations, 2, "never silently remove a blunder")

const noControl = structuredClone(level); noControl.points.forEach(p => { p.fixed = false }); assert.throws(() => adjustNetwork(noControl), /fixed control/)
const disconnected = structuredClone(level); disconnected.points.push({ id: "UNSEEN", easting: null, northing: null, height: null, fixed: false }); assert.throws(() => adjustNetwork(disconnected), /Unobserved|Insufficient/)
const floatingComponent = structuredClone(level); floatingComponent.points.push({ id: "X", easting: null, northing: null, height: 0, fixed: false }, { id: "Y", easting: null, northing: null, height: 1, fixed: false }); floatingComponent.observations.push({ ...floatingComponent.observations[0], id: "floating", from: "X", to: "Y", value: 1 }, { ...floatingComponent.observations[0], id: "floating2", from: "X", to: "Y", value: 1 }); assert.throws(() => adjustNetwork(floatingComponent), /not independently constrained/)
const he = networkExample("horizontal"), horizontal = parseNetwork(he.points, he.observations, he.settings)
const insufficient = structuredClone(horizontal); insufficient.observations = insufficient.observations.slice(0, 1); assert.throws(() => adjustNetwork(insufficient), /Insufficient/)
const collinear = parseNetwork("Point,Easting,Northing,Fixed\nA,0,0,true\nB,100,0,true\nP,50,0,false", "ID,Type,From,To,Value,Sigma\na,HD,A,P,50,1\nb,HD,B,P,50,1", he.settings)
assert.throws(() => adjustNetwork(collinear), /Unobserved|not independently constrained/)
const coincident = structuredClone(horizontal); coincident.points[2].easting = coincident.points[0].easting; coincident.points[2].northing = coincident.points[0].northing; assert.throws(() => adjustNetwork(coincident), /separate|coincide/i)
const impossible = structuredClone(collinear); impossible.points[2].northing = 20; impossible.observations.forEach(o => { o.value = 10 }); assert.throws(() => adjustNetwork(impossible), /converge|constrained|Unobserved/)

// Circular wrap at north, rather than a 360-degree artificial misclosure.
const wrap = parseNetwork("Point,Easting,Northing,Fixed\nA,0,0,true\nB,0,100,true\nP,-0.01,100,false", "ID,Type,From,To,Value,Sigma\na,HD,A,P,100,1\nb,AZ,A,P,359.99995,0.1\nc,AZ,A,B,0,1", he.settings)
const wr = adjustNetwork(wrap); near(wr.points[2].easting, -.0000872664626, 1e-7); near(wr.points[2].northing, 100, 1e-7)
// Same Set ID at different stations must mean two independent orientations.
const twoSet = structuredClone(horizontal)
for (const [i, to] of ["A", "P1", "P2"].entries()) { const truth = { A: [1000, 1000], P1: [1050, 1080], P2: [1150, 1120] }[to]; twoSet.observations.push({ ...horizontal.observations.find(o => o.type === "DIR"), id: "BSET" + i, from: "B", to, set: "SET1", value: (Math.atan2(truth[0] - 1200, truth[1] - 1000) - 123 * Math.PI / 180 + Math.PI * 4) % (Math.PI * 2) }) }
const tr = adjustNetwork(twoSet); assert.equal(tr.orientations.length, 2); assert.equal(tr.statistics.unknowns, 6); near(tr.orientations.find(o => o.station === "B").degrees, 123, .001)

near(parseNetworkAngle("123:45:06.7") * 180 / Math.PI, 123 + 45 / 60 + 6.7 / 3600, 1e-11)
for (const text of ["90:60:00", "90:00:60", "400", "NaN", "90x"]) assert.throws(() => parseNetworkAngle(text))
assert.throws(() => parseNetwork("Point,RL,Fixed\nA,100,true\nB,101,false", "ID,Type,From,To,Value\na,DH,A,B,1", defaultNetworkSettings), /Sigma.*Length_km/)
assert.throws(() => parseNetwork(he.points, he.observations.replace("D1,", "D2,"), he.settings), /Duplicate/)
assert.throws(() => parseNetwork(he.points.replace("Easting", "Eest"), he.observations, he.settings), /headers/)
assert.throws(() => parseNetwork(he.points, he.observations.replace("D1,HD", "D1,SD"), he.settings), /use DH/)
const defaults = horizontal.observations[0]; near(defaults.sigma, (2 + defaults.value * .002) * .001, 1e-12)
const quadrature = parseNetwork(he.points, he.observations, { ...he.settings, edmModel: "quadrature" }); near(quadrature.observations[0].sigma, Math.hypot(2, defaults.value * .002) * .001, 1e-12)
const edited = editObservationInclusion(he.observations, "D1", false), editedInput = parseNetwork(he.points, edited, he.settings)
assert.equal(editedInput.observations[0].enabled, false); assert.equal(editedInput.observations[0].weightSource, defaults.weightSource)
assert.ok(networkPointRows(horizontal, outputs[1].result)[0].includes("Source RL (not adjusted)")); assert.equal(networkResidualRows(br).length, 3); assert.match(networkCovarianceCsv(lr), /A priori covariance/)
const injected = structuredClone(level); injected.points[1].id = "=B"; injected.observations.forEach(o => { if (o.from === "B") o.from = "=B"; if (o.to === "B") o.to = "=B" }); assert.match(networkCsv(networkPointRows(injected, adjustNetwork(injected))), /'=B/)
const project = { format: "surveytool-project", version: 1, id: workspaceId(), tool: "network", title: "Synthetic network", savedAt: new Date().toISOString(), state: { settings: he.settings, pointsText: he.points, observationsText: edited } }
const restored = parseProjectFile(JSON.stringify(project)); assert.equal(restored.tool, "network"); assert.deepEqual(adjustNetwork(parseNetwork(restored.state.pointsText, restored.state.observationsText, restored.state.settings)), adjustNetwork(editedInput))

// Maximum supported point/observation count, with an anchored level chain.
const maximum = structuredClone(level); maximum.points = Array.from({ length: 80 }, (_, i) => ({ id: "P" + i, easting: null, northing: null, height: i, fixed: !i })); maximum.observations = Array.from({ length: 2000 }, (_, i) => ({ ...level.observations[0], id: "M" + i, from: "P" + (i % 79), to: "P" + (i % 79 + 1), value: 1, sigma: .001 }))
const mr = adjustNetwork(maximum); near(mr.points[79].height, 79); assert.equal(mr.statistics.observations, 2000); assert.equal(mr.statistics.unknowns, 79)

// Exercise worker message handling and expected data-validation failures.
const priorSelf = globalThis.self; let message
try { globalThis.self = { postMessage: m => { message = m } }; await import("../src/workers/network.worker.ts"); self.onmessage({ data: level }); assert.equal(message.result.points.length, 3); self.onmessage({ data: noControl }); assert.match(message.error, /fixed control/) }
finally { globalThis.self = priorSelf }
if (process.env.SURVEYTOOL_NETWORK_QA_DIR) { const folder = process.env.SURVEYTOOL_NETWORK_QA_DIR; fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, "reference-results.json"), JSON.stringify(outputs, null, 2)) }
console.log(JSON.stringify({ passed: true, independentReferenceNetworks: reference.cases.length, chiSquareQuantiles: reference.chiSquareQuantiles.length, maximumPoints: 80, maximumObservations: 2000, checks: "closed-form weights, SciPy coordinates/covariance/residuals, angle wrapping, separate setups, singularity, nonconvergence, exclusions, backups and worker" }))
