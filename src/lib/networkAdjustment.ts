import { chiSquareQuantile, networkLeastSquares } from "./networkMath"

export type NetworkMode = "level" | "horizontal"
export type ObservationType = "DH" | "HD" | "AZ" | "HA" | "DIR"
export type NetworkPoint = { id: string; easting: number | null; northing: number | null; height: number | null; fixed: boolean }
export type NetworkObservation = { id: string; type: ObservationType; from: string; to: string; back: string; set: string; value: number; sigma: number; lengthKm: number | null; enabled: boolean; weightSource: string }
export type NetworkInput = { name: string; mode: NetworkMode; grid: string; datum: string; points: NetworkPoint[]; observations: NetworkObservation[] }
export type AdjustedPoint = NetworkPoint & { deltaE: number | null; deltaN: number | null; deltaH: number | null; sigmaE: number | null; sigmaN: number | null; sigmaH: number | null; ellipseMajor95: number | null; ellipseMinor95: number | null; ellipseBearing: number | null }
export type NetworkResidual = NetworkObservation & { computed: number | null; prefit: number | null; residual: number | null; redundancy: number | null; standardized: number | null; flag: "ok" | "review" | "weak" | "uncontrolled" | "excluded" }
export type LevelClosure = { observation: string; path: string; misclosure: number; sigma: number; lengthKm: number | null }
export type NetworkResult = { points: AdjustedPoint[]; residuals: NetworkResidual[]; orientations: Array<{ station: string; set: string; degrees: number; sigmaSeconds: number }>; closures: LevelClosure[]; covariance: number[][]; parameters: string[]; statistics: { observations: number; unknowns: number; dof: number; iterations: number; weightedSum: number; varianceFactor: number | null; chiLower: number | null; chiUpper: number | null; globalTest: "pass" | "high" | "low" | "unavailable"; reviewCount: number; diagonalRatio: number }; warnings: string[] }
export const secondsToRadians = Math.PI / 648000
export const wrapAngle = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
export const angleDifference = (x: number) => { const a = wrapAngle(x + Math.PI) - Math.PI; return a }
export const isAngular = (type: ObservationType) => type === "AZ" || type === "HA" || type === "DIR"
export const residualUnits = (o: NetworkObservation) => isAngular(o.type) ? "arcsec" : "mm"
export const displayResidual = (value: number, type: ObservationType) => isAngular(type) ? value / secondsToRadians : value * 1000
export const displayObservation = (value: number, type: ObservationType) => isAngular(type) ? wrapAngle(value) * 180 / Math.PI : value

export function validateNetwork(input: NetworkInput) {
  if (!input || !["level", "horizontal"].includes(input.mode) || !Array.isArray(input.points) || !Array.isArray(input.observations)) throw new Error("Invalid network data.")
  if (input.points.length < 2 || input.points.length > 80 || input.observations.length > 2000) throw new Error("Use 2–80 points and no more than 2,000 observations in this release.")
  if (![input.name, input.grid, input.datum].every(s => typeof s === "string" && s.length <= 200 && !/[\x00-\x1f]/.test(s))) throw new Error("Use single-line project and datum names of up to 200 characters.")
  const pointIds = new Set<string>(), observationIds = new Set<string>()
  const validId = (s: unknown) => typeof s === "string" && s.trim() === s && s.length > 0 && s.length <= 64 && !/[\x00-\x1f\x7f]/.test(s)
  for (const p of input.points) {
    if (!validId(p.id) || pointIds.has(p.id)) throw new Error(`Duplicate or invalid point ID: ${p.id}. IDs are case-sensitive.`)
    pointIds.add(p.id)
    if (typeof p.fixed !== "boolean") throw new Error(`Choose fixed or free for ${p.id}.`)
    for (const v of [p.easting, p.northing, p.height]) if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e9)) throw new Error(`Invalid coordinate for ${p.id}.`)
    if (input.mode === "horizontal" && (p.easting === null || p.northing === null)) throw new Error(`Approximate easting and northing are required for ${p.id}.`)
    if (input.mode === "level" && p.fixed && p.height === null) throw new Error(`Fixed benchmark ${p.id} needs an RL.`)
  }
  if (!input.points.some(p => p.fixed)) throw new Error("At least one fixed control point is required. Free-network datum constraints are not supported.")
  for (const o of input.observations) {
    if (!validId(o.id) || observationIds.has(o.id)) throw new Error(`Duplicate or invalid observation ID: ${o.id}.`)
    observationIds.add(o.id)
    if (!(input.mode === "level" ? ["DH"] : ["HD", "AZ", "HA", "DIR"]).includes(o.type)) throw new Error(`Observation ${o.id}: ${o.type} is not supported in this adjustment mode.`)
    if (!pointIds.has(o.from) || !pointIds.has(o.to) || o.from === o.to || o.type === "HA" && (!pointIds.has(o.back) || o.back === o.from || o.back === o.to)) throw new Error(`Observation ${o.id}: check From, To and Back point IDs.`)
    if (o.type === "DIR" && !validId(o.set)) throw new Error(`Direction ${o.id} needs a Set ID for its instrument setup.`)
    if (!Number.isFinite(o.value) || Math.abs(o.value) > 1e9 || o.type === "HD" && o.value <= 0) throw new Error(`Observation ${o.id} has an invalid measured value.`)
    if (!Number.isFinite(o.sigma) || o.sigma < (isAngular(o.type) ? 1e-12 : 1e-9) || o.sigma > (isAngular(o.type) ? Math.PI : 1e6)) throw new Error(`Observation ${o.id} needs a positive, realistic 1-sigma standard deviation.`)
    if (typeof o.enabled !== "boolean" || typeof o.weightSource !== "string" || o.weightSource.length > 100 || o.lengthKm !== null && (!Number.isFinite(o.lengthKm) || o.lengthKm <= 0)) throw new Error(`Observation ${o.id} has invalid weighting metadata.`)
  }
  if (!input.observations.some(o => o.enabled)) throw new Error("Include at least one observation before adjusting.")
}

/** Independent cycle/tie checks from a spanning tree. Fixed heights are exact. */
export function levelClosures(input: NetworkInput): LevelClosure[] {
  if (input.mode !== "level") return []
  type Edge = { to: string; dh: number; variance: number; length: number | null; id: string }
  const root = "\0control", graph = new Map<string, Edge[]>(), closures: LevelClosure[] = []
  const add = (from: string, to: string, dh: number, variance: number, length: number | null, id: string) => { graph.set(from, [...(graph.get(from) ?? []), { to, dh, variance, length, id }]); graph.set(to, [...(graph.get(to) ?? []), { to: from, dh: -dh, variance, length, id }]) }
  for (const p of input.points.filter(p => p.fixed)) add(root, p.id, p.height!, 0, 0, `control:${p.id}`)
  for (const o of input.observations.filter(o => o.enabled)) {
    const visited = new Set([o.from]), queue = [{ at: o.from, dh: 0, variance: 0, length: 0 as number | null, ids: [] as string[] }]
    let found: typeof queue[number] | undefined
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]
      if (current.at === o.to) { found = current; break }
      for (const edge of graph.get(current.at) ?? []) if (!visited.has(edge.to)) { visited.add(edge.to); queue.push({ at: edge.to, dh: current.dh + edge.dh, variance: current.variance + edge.variance, length: current.length === null || edge.length === null ? null : current.length + edge.length, ids: [...current.ids, edge.id] }) }
    }
    if (found) closures.push({ observation: o.id, path: found.ids.join(" → "), misclosure: o.value - found.dh, sigma: Math.sqrt(o.sigma ** 2 + found.variance), lengthKm: o.lengthKm === null || found.length === null ? null : o.lengthKm + found.length })
    else add(o.from, o.to, o.value, o.sigma ** 2, o.lengthKm, o.id)
  }
  return closures
}

export function adjustNetwork(input: NetworkInput): NetworkResult {
  validateNetwork(input)
  const observations = input.observations.filter(o => o.enabled), points = new Map(input.points.map(p => [p.id, p]))
  const indices = new Map<string, { e: number; n: number; h: number }>(), labels: string[] = [], orientationIndices = new Map<string, number>(), orientationGroups = new Map<string, NetworkObservation[]>(), orientationPositions = new Set<number>()
  let values: number[] = []
  for (const p of input.points) {
    const ix = { e: -1, n: -1, h: -1 }
    if (!p.fixed) {
      if (input.mode === "level") { ix.h = labels.length; labels.push(`${p.id}:H`); values.push(p.height ?? 0) }
      else { ix.e = labels.length; labels.push(`${p.id}:E`); values.push(p.easting!); ix.n = labels.length; labels.push(`${p.id}:N`); values.push(p.northing!) }
    }
    indices.set(p.id, ix)
  }
  for (const o of observations.filter(o => o.type === "DIR")) { const key = JSON.stringify([o.from, o.set]); orientationGroups.set(key, [...(orientationGroups.get(key) ?? []), o]) }
  const position = (id: string, x: number[]) => { const p = points.get(id)!, ix = indices.get(id)!; return { e: ix.e < 0 ? p.easting! : x[ix.e], n: ix.n < 0 ? p.northing! : x[ix.n], h: ix.h < 0 ? p.height! : x[ix.h] } }
  for (const [key, group] of orientationGroups) {
    let sin = 0, cos = 0
    for (const o of group) { const a = position(o.from, values), b = position(o.to, values), theta = Math.atan2(b.e - a.e, b.n - a.n) - o.value; const weight = 1 / o.sigma ** 2; sin += Math.sin(theta) * weight; cos += Math.cos(theta) * weight }
    const ix = labels.length; orientationIndices.set(key, ix); orientationPositions.add(ix); labels.push(`${group[0].from}:orientation:${group[0].set}`); values.push(Math.atan2(sin, cos))
  }
  if (labels.length > 200) throw new Error("This release supports up to 200 coordinate and direction-orientation unknowns. Split the network into a smaller checked network.")
  function equation(o: NetworkObservation, x: number[]) {
    const a = position(o.from, x), b = position(o.to, x), gradient = Array(labels.length).fill(0) as number[]
    const add = (id: string, e: number, n: number, h = 0) => { const ix = indices.get(id)!; if (ix.e >= 0) gradient[ix.e] += e; if (ix.n >= 0) gradient[ix.n] += n; if (ix.h >= 0) gradient[ix.h] += h }
    if (o.type === "DH") { add(o.from, 0, 0, -1); add(o.to, 0, 0, 1); return { predicted: b.h - a.h, gradient } }
    const bearing = (to: string, factor: number) => {
      const target = position(to, x), de = target.e - a.e, dn = target.n - a.n, square = de * de + dn * dn
      if (square < 1e-8) throw new Error(`Observation ${o.id}: points ${o.from} and ${to} coincide or are too close for an angular observation. Check approximate coordinates.`)
      const e = dn / square * factor, n = -de / square * factor
      add(to, e, n); add(o.from, -e, -n)
      return Math.atan2(de, dn)
    }
    if (o.type === "HD") {
      const de = b.e - a.e, dn = b.n - a.n, d = Math.hypot(de, dn)
      if (d < 1e-4) throw new Error(`Observation ${o.id}: separate the approximate From and To positions.`)
      add(o.from, -de / d, -dn / d); add(o.to, de / d, dn / d)
      return { predicted: d, gradient }
    }
    let predicted = bearing(o.to, 1)
    if (o.type === "HA") predicted -= bearing(o.back, -1)
    if (o.type === "DIR") { const ix = orientationIndices.get(JSON.stringify([o.from, o.set]))!; predicted -= x[ix]; gradient[ix] = -1 }
    return { predicted: wrapAngle(predicted), gradient }
  }
  function system(x: number[]) {
    const equations = observations.map(o => equation(o, x)), misclosures = equations.map((e, i) => isAngular(observations[i].type) ? angleDifference(observations[i].value - e.predicted) : observations[i].value - e.predicted)
    const right = misclosures.map((r, i) => r / observations[i].sigma), design = equations.map((e, i) => e.gradient.map(v => v / observations[i].sigma))
    return { equations, misclosures, right, design, cost: right.reduce((s, v) => s + v * v, 0) }
  }
  const initial = system(values), small = (step: number[]) => step.every((v, i) => Math.abs(v) < (orientationPositions.has(i) ? 1e-10 : 1e-7))
  let current = initial, iterations = 0, converged = labels.length === 0
  for (; iterations < 30 && !converged; iterations++) {
    const { correction } = networkLeastSquares(current.design, current.right, labels)
    if (small(correction)) { converged = true; break }
    let step = 1, candidate: number[] = [], next: ReturnType<typeof system> | null = null
    for (let attempt = 0; attempt < 24; attempt++) {
      candidate = values.map((v, i) => orientationPositions.has(i) ? wrapAngle(v + correction[i] * step) : v + correction[i] * step)
      try { const trial = system(candidate); if (Number.isFinite(trial.cost) && trial.cost <= current.cost + Math.max(1e-12, current.cost * 1e-13)) { next = trial; break } } catch { /* An invalid trial is never accepted. */ }
      step /= 2
    }
    if (!next) throw new Error("The adjustment did not converge. Check approximate coordinates, angular units, point order and gross observation errors.")
    values = candidate; current = next
  }
  if (!converged) throw new Error("The adjustment did not converge within 30 iterations. No adjusted coordinates have been accepted.")
  const solved = networkLeastSquares(current.design, current.right, labels), q = solved.covariance, dof = observations.length - labels.length, sum = current.cost
  const lower = dof > 0 ? chiSquareQuantile(.025, dof) : null, upper = dof > 0 ? chiSquareQuantile(.975, dof) : null
  const activeResiduals = new Map<string, NetworkResidual>()
  for (let k = 0; k < observations.length; k++) {
    const o = observations[k], row = current.design[k]
    let leverage = 0
    for (let i = 0; i < labels.length; i++) if (row[i]) for (let j = 0; j < labels.length; j++) leverage += row[i] * q[i][j] * row[j]
    if (leverage < -1e-6 || leverage > 1 + 1e-6) throw new Error("Residual covariance is unstable. Check network geometry and weights; no result has been accepted.")
    const redundancy = Math.max(0, Math.min(1, 1 - leverage)), residual = -current.misclosures[k], standardized = redundancy > 1e-8 ? residual / o.sigma / Math.sqrt(redundancy) : null
    activeResiduals.set(o.id, { ...o, computed: current.equations[k].predicted, prefit: initial.misclosures[k], residual, redundancy, standardized, flag: standardized !== null && Math.abs(standardized) > 3 ? "review" : redundancy < 1e-8 ? "uncontrolled" : redundancy < .05 ? "weak" : "ok" })
  }
  const resultPoints: AdjustedPoint[] = input.points.map(p => {
    const ix = indices.get(p.id)!, at = position(p.id, values), sigma = (i: number) => i < 0 ? 0 : Math.sqrt(Math.max(0, q[i][i]))
    const sigmaE = input.mode === "horizontal" ? sigma(ix.e) : null, sigmaN = input.mode === "horizontal" ? sigma(ix.n) : null, sigmaH = input.mode === "level" ? sigma(ix.h) : null
    let major = null, minor = null, bearing = null
    if (input.mode === "horizontal") {
      const ee = sigmaE! ** 2, nn = sigmaN! ** 2, en = p.fixed ? 0 : q[ix.e][ix.n], c = Math.hypot(ee - nn, 2 * en), factor = Math.sqrt(5.991464547107979)
      major = Math.sqrt(Math.max(0, (ee + nn + c) / 2)) * factor; minor = Math.sqrt(Math.max(0, (ee + nn - c) / 2)) * factor
      bearing = major > 0 && c > 1e-20 ? ((90 - .5 * Math.atan2(2 * en, ee - nn) * 180 / Math.PI) % 180 + 180) % 180 : 0
    }
    return { ...p, easting: input.mode === "horizontal" ? at.e : p.easting, northing: input.mode === "horizontal" ? at.n : p.northing, height: input.mode === "level" ? at.h : p.height, deltaE: input.mode === "horizontal" ? at.e - p.easting! : null, deltaN: input.mode === "horizontal" ? at.n - p.northing! : null, deltaH: input.mode === "level" && p.height !== null ? at.h - p.height : null, sigmaE, sigmaN, sigmaH, ellipseMajor95: major, ellipseMinor95: minor, ellipseBearing: bearing }
  })
  const residuals = input.observations.map(o => activeResiduals.get(o.id) ?? { ...o, computed: null, prefit: null, residual: null, redundancy: null, standardized: null, flag: "excluded" as const })
  const warnings: string[] = []
  if (!dof) warnings.push("No redundancy: the coordinates can be solved, but there is no independent statistical check or variance-factor estimate.")
  if (sum > (upper ?? Infinity)) warnings.push("The 95% global chi-square test is high. Check gross errors, constraints, reductions and standard deviations before using the coordinates.")
  if (sum < (lower ?? 0)) warnings.push("The 95% global chi-square test is low. Standard deviations may be conservative, or observations may be correlated. This is not proof of survey accuracy.")
  const uncontrolled = residuals.filter(r => r.flag === "weak" || r.flag === "uncontrolled").length
  if (uncontrolled) warnings.push(`${uncontrolled} observation${uncontrolled === 1 ? " has" : "s have"} less than 5% redundancy. Small residuals on these observations do not establish reliability.`)
  const excluded = residuals.filter(r => !r.enabled).length
  if (excluded) warnings.push(`${excluded} observation${excluded === 1 ? " was" : "s were"} explicitly excluded and remain${excluded === 1 ? "s" : ""} listed in the report.`)
  if (input.mode === "horizontal" && resultPoints.some(p => Math.hypot(p.deltaE ?? 0, p.deltaN ?? 0) > 1)) warnings.push("One or more approximate positions moved by over 1 m. Inspect the solution geometry; nonlinear adjustment depends on reasonable initial positions.")
  if (solved.diagonalRatio > 1e6) warnings.push("The network geometry is weak after column scaling. Review its precision and independent checks.")
  const orientations = [...orientationGroups].map(([key, group]) => { const i = orientationIndices.get(key)!; return { station: group[0].from, set: group[0].set, degrees: wrapAngle(values[i]) * 180 / Math.PI, sigmaSeconds: Math.sqrt(q[i][i]) / secondsToRadians } })
  return { points: resultPoints, residuals, orientations, closures: levelClosures(input), parameters: labels, covariance: q, statistics: { observations: observations.length, unknowns: labels.length, dof, iterations, weightedSum: sum, varianceFactor: dof > 0 ? Math.sqrt(sum / dof) : null, chiLower: lower, chiUpper: upper, globalTest: !dof ? "unavailable" : sum > upper! ? "high" : sum < lower! ? "low" : "pass", reviewCount: residuals.filter(r => r.flag === "review").length, diagonalRatio: solved.diagonalRatio }, warnings }
}
