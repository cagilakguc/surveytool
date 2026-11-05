/** Column-scaled, column-pivoted Householder QR. No normal-equation inversion. */
export function networkLeastSquares(design: number[][], rhs: number[], labels: string[]) {
  const m = design.length, n = labels.length
  if (rhs.length !== m || design.some(r => r.length !== n) || !rhs.every(Number.isFinite) || design.some(r => !r.every(Number.isFinite))) throw new Error("Non-finite adjustment equations.")
  if (m < n) throw new Error(`Insufficient observations: ${m} equations for ${n} unknowns. Add independent measurements or fixed control.`)
  if (!n) return { correction: [] as number[], covariance: [] as number[][], diagonalRatio: 1 }
  const scale = labels.map((_, j) => Math.hypot(...design.map(r => r[j])))
  if (scale.some(v => v < 1e-20 || !Number.isFinite(v))) throw new Error(`Unobserved unknown: ${labels[scale.findIndex(v => v < 1e-20 || !Number.isFinite(v))]}. Connect every adjusted point and direction set.`)
  const a = design.map(r => r.map((v, j) => v / scale[j])), b = [...rhs], order = labels.map((_, i) => i)
  for (let k = 0; k < n; k++) {
    let pivot = k, maximum = -1
    for (let j = k; j < n; j++) {
      let norm = 0
      for (let i = k; i < m; i++) norm = Math.hypot(norm, a[i][j])
      if (norm > maximum) { maximum = norm; pivot = j }
    }
    if (maximum < 1e-10) throw new Error(`Network is not independently constrained near ${labels[order[pivot]]}. Check fixed control, disconnected points, collinearity and direction-set orientation.`)
    if (pivot !== k) { for (const row of a) [row[k], row[pivot]] = [row[pivot], row[k]]; [order[k], order[pivot]] = [order[pivot], order[k]] }
    const v = a.slice(k).map(r => r[k]), alpha = v[0] >= 0 ? -maximum : maximum
    v[0] -= alpha
    const norm = Math.hypot(...v)
    for (let i = 0; i < v.length; i++) v[i] /= norm
    for (let j = k; j < n; j++) {
      let dot = 0
      for (let i = k; i < m; i++) dot += v[i - k] * a[i][j]
      for (let i = k; i < m; i++) a[i][j] -= 2 * v[i - k] * dot
    }
    let dot = 0
    for (let i = k; i < m; i++) dot += v[i - k] * b[i]
    for (let i = k; i < m; i++) b[i] -= 2 * v[i - k] * dot
    a[k][k] = alpha
    for (let i = k + 1; i < m; i++) a[i][k] = 0
  }
  const solve = (right: number[]) => {
    const x = Array(n).fill(0) as number[]
    for (let i = n - 1; i >= 0; i--) { let value = right[i]; for (let j = i + 1; j < n; j++) value -= a[i][j] * x[j]; x[i] = value / a[i][i] }
    return x
  }
  const y = solve(b), correction = Array(n).fill(0) as number[], inverse = Array.from({ length: n }, () => Array(n).fill(0) as number[])
  for (let j = 0; j < n; j++) { const column = solve(labels.map((_, i) => Number(i === j))); for (let i = 0; i < n; i++) inverse[i][j] = column[i] }
  const covariance = Array.from({ length: n }, () => Array(n).fill(0) as number[])
  for (let i = 0; i < n; i++) {
    correction[order[i]] = y[i] / scale[order[i]]
    for (let j = 0; j <= i; j++) {
      let sum = 0
      for (let k = 0; k < n; k++) sum += inverse[i][k] * inverse[j][k]
      const value = sum / scale[order[i]] / scale[order[j]]
      covariance[order[i]][order[j]] = covariance[order[j]][order[i]] = value
    }
  }
  if (!correction.every(Number.isFinite) || covariance.some(r => !r.every(Number.isFinite))) throw new Error("The network is numerically unstable. Check its geometry and observation standard deviations.")
  const diagonal = labels.map((_, i) => Math.abs(a[i][i]))
  return { correction, covariance, diagonalRatio: Math.max(...diagonal) / Math.min(...diagonal) }
}

// Lanczos log Γ and regularized lower incomplete Γ; quantiles are bracketed,
// then bisected. Tested against scipy.stats.chi2 across the supported DOF range.
function logGamma(z: number): number {
  const c = [676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7]
  if (z < .5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z)
  z -= 1
  let x = .9999999999998099
  for (let i = 0; i < c.length; i++) x += c[i] / (z + i + 1)
  const t = z + 7.5
  return .5 * Math.log(2 * Math.PI) + (z + .5) * Math.log(t) - t + Math.log(x)
}
export function chiSquareCdf(x: number, degrees: number) {
  if (!(degrees > 0) || !Number.isFinite(degrees) || Number.isNaN(x)) throw new Error("Invalid chi-square arguments.")
  if (x <= 0) return 0
  if (x === Infinity) return 1
  const a = degrees / 2, z = x / 2, factor = Math.exp(-z + a * Math.log(z) - logGamma(a))
  if (z < a + 1) {
    let term = 1 / a, sum = term
    for (let i = 1; i < 10000; i++) { term *= z / (a + i); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-14) return Math.min(1, Math.max(0, sum * factor)) }
  } else {
    const tiny = 1e-300
    let b = z + 1 - a, c = 1 / tiny, d = 1 / b, h = d
    for (let i = 1; i < 10000; i++) {
      const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < tiny) d = tiny
      c = b + an / c; if (Math.abs(c) < tiny) c = tiny
      d = 1 / d; const delta = d * c; h *= delta
      if (Math.abs(delta - 1) < 1e-14) return Math.min(1, Math.max(0, 1 - factor * h))
    }
  }
  throw new Error("The statistical calculation did not converge.")
}
export function chiSquareQuantile(probability: number, degrees: number) {
  if (!(probability > 0 && probability < 1)) throw new Error("Invalid chi-square probability.")
  let low = 0, high = Math.max(1, degrees)
  while (chiSquareCdf(high, degrees) < probability) high *= 2
  for (let i = 0; i < 100; i++) { const middle = (low + high) / 2; if (chiSquareCdf(middle, degrees) < probability) low = middle; else high = middle }
  return (low + high) / 2
}
