/** LINZ GTX grids: NZGD2000 ellipsoid -> NZVD2016, and NZVD2016 -> Auckland 1946.
 * https://github.com/linz/proj-datumgrid-nz/blob/master/files/README.proj-datumgrid-nz.md
 * Grids are sampled bilinearly at the point, never with a regional mean offset.
 */
export type NzHeightDatum = "NZVD2016" | "AUCK46"
export type HeightGrid = { south: number; west: number; dy: number; dx: number; rows: number; columns: number; values: Float32Array }

export function readHeightGrid(buffer: ArrayBuffer): HeightGrid {
  if (buffer.byteLength < 56 || buffer.byteLength > 32 * 1024 * 1024) throw new Error("Invalid height grid size.")
  const view = new DataView(buffer)
  const south = view.getFloat64(0), west = view.getFloat64(8), dy = view.getFloat64(16), dx = view.getFloat64(24)
  const rows = view.getInt32(32), columns = view.getInt32(36)
  if (![south, west, dy, dx].every(Number.isFinite) || south < -90 || south > 90 || west < -180 || west > 360 || dy <= 0 || dx <= 0 || rows < 2 || columns < 2 || rows * columns > 8_000_000 || buffer.byteLength !== 40 + 4 * rows * columns) throw new Error("Invalid GTX height grid header.")
  const values = new Float32Array(rows * columns)
  for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(40 + i * 4)
  return { south, west, dy, dx, rows, columns, values }
}

export function sampleHeightGrid(grid: HeightGrid, latitude: number, longitude: number) {
  const y = (latitude - grid.south) / grid.dy, x = (longitude - grid.west) / grid.dx
  if (![x, y].every(Number.isFinite) || x < -1e-9 || y < -1e-9 || x > grid.columns - 1 + 1e-9 || y > grid.rows - 1 + 1e-9) throw new Error("A point is outside the selected LINZ height model. No extrapolated height has been exported.")
  const xx = Math.max(0, Math.min(grid.columns - 1, x)), yy = Math.max(0, Math.min(grid.rows - 1, y))
  const c = Math.min(Math.floor(xx), grid.columns - 2), r = Math.min(Math.floor(yy), grid.rows - 2), u = xx - c, v = yy - r
  const a = grid.values[r * grid.columns + c], b = grid.values[r * grid.columns + c + 1], d = grid.values[(r + 1) * grid.columns + c], e = grid.values[(r + 1) * grid.columns + c + 1]
  if (![a, b, d, e].every((n) => Number.isFinite(n) && Math.abs(n) < 10_000)) throw new Error("The LINZ height model has no valid coverage at a point. No replacement height has been invented.")
  return (1 - v) * ((1 - u) * a + u * b) + v * ((1 - u) * d + u * e)
}

const models = {
  geoid: { path: "/height-models/nzgeoid2016.gtx.gz", sha256: "081040dd085bf4da6995c927ca69fd1c6043dc9ae708b8ccbf1b59f81525981f" },
  auckland: { path: "/height-models/auckht1946-nzvd2016.gtx.gz", sha256: "dfc462636f48d5ceaaebee1a5caa333ea5ccdcbdbce8a4b29ad775ff45efa5d8" },
} as const
const cached = new Map<string, Promise<HeightGrid>>()
async function readLimited(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader(), parts: Uint8Array[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.length
    if (total > 32 * 1024 * 1024) { await reader.cancel(); throw new Error("The height model exceeds its supported size.") }
    parts.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return bytes
}
export function loadNzHeightGrid(name: keyof typeof models) {
  if (!cached.has(name)) cached.set(name, (async () => {
    const model = models[name]
    // Public model bytes only. Survey inputs and point coordinates never enter
    // this cache; the checksum makes a saved model reusable across app updates.
    const key = `${model.path}?sha256=${model.sha256}`
    const cache = typeof caches === "undefined" ? null : await caches.open("surveytool-height-models-v1").catch(() => null)
    const saved = await cache?.match(key).catch(() => undefined)
    const response = saved ?? await fetch(model.path)
    if (!response.ok) throw new Error("The LINZ height model could not be loaded. Connect to the internet and prepare the points again.")
    if (!response.body) throw new Error("The height model download was empty.")
    const copy = response.clone(), received = await readLimited(response.body)
    // A host may set Content-Encoding:gzip, in which case fetch has already
    // decoded the resource. Inspect bytes, then verify the same raw GTX hash.
    let bytes = received
    if (received[0] === 0x1f && received[1] === 0x8b) {
      if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot open the height models. Use a current Chrome, Edge, Firefox or Safari browser.")
      bytes = await readLimited(new Blob([received]).stream().pipeThrough(new DecompressionStream("gzip")))
    }
    const buffer = bytes.buffer
    if (typeof crypto === "undefined" || !crypto.subtle) throw new Error("Height conversion needs a secure HTTPS connection. Open SurveyTool.io using HTTPS and prepare the points again.")
    const digest = await crypto.subtle.digest("SHA-256", buffer)
    const hash = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("")
    if (hash !== model.sha256) { await cache?.delete(key); throw new Error("The downloaded LINZ height model did not pass its integrity check. No heights have been exported.") }
    const grid = readHeightGrid(buffer)
    if (!saved) await cache?.put(key, copy).catch(() => undefined)
    return grid
  })().catch((error) => { cached.delete(name); throw error }))
  return cached.get(name)!
}
