/**
 * Offline DXF hatch/road-marking converter for Trimble Access.
 * Keeps untouched CAD entities and BLOCK/INSERT transforms as-is. Replaces
 * HATCH and optional SOLID/TRACE entities in both BLOCKS and ENTITIES.
 * ASCII DXF only; no coordinate or datum transformations are performed.
 */
export type HatchOutputMode = "full" | "outlines"

export type HatchConvertOptions = {
  mode: HatchOutputMode
  spacing: number
  convertSolids: boolean
}

export type HatchConvertResult = {
  dxf: string
  hatches: number
  solids: number
  generatedLines: number
  generatedOutlines: number
  blocksUpdated: number
  warnings: string[]
}

type Tag = { code: number; value: string }
type Point = { x: number; y: number }
type Loop = Point[]

const finite = (value: string | undefined, fallback = 0) => {
  const n = Number(value)
  return value !== undefined && Number.isFinite(n) ? n : fallback
}
const first = (tags: Tag[], code: number, fallback = "") =>
  tags.find((tag) => tag.code === code)?.value ?? fallback
const get = (tags: Tag[], code: number, fallback = 0) =>
  finite(first(tags, code, String(fallback)), fallback)
const point = (x: number, y: number): Point => ({ x, y })
const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-7
const number = (value: number) => Number.isFinite(value) ? value.toFixed(7).replace(/\.?0+$/, "") || "0" : "0"
const tag = (code: number, value: string | number): Tag => ({ code, value: String(value) })
const radians = (degrees: number) => degrees * Math.PI / 180

function normalizeSweep(start: number, end: number, ccw: boolean, turn: number) {
  let delta = end - start
  if (ccw) {
    while (delta < 0) delta += turn
    if (delta < 1e-8) delta = turn
  } else {
    while (delta > 0) delta -= turn
    if (delta > -1e-8) delta = -turn
  }
  return Math.max(-turn, Math.min(turn, delta))
}

function sampleArc(center: Point, radius: number, startDeg: number, endDeg: number, ccw: boolean): Loop {
  if (radius <= 0) return []
  const sweep = normalizeSweep(startDeg, endDeg, ccw, 360)
  const steps = Math.max(2, Math.min(250, Math.ceil(Math.abs(sweep) / 6), Math.ceil(Math.abs(radians(sweep) * radius) / 0.12)))
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = radians(startDeg + sweep * index / steps)
    return point(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius)
  })
}

function sampleEllipse(tags: Tag[]): Loop {
  const center = point(get(tags, 10), get(tags, 20))
  const major = point(get(tags, 11), get(tags, 21))
  const ratio = get(tags, 40, 1)
  const start = get(tags, 50)
  const sweep = normalizeSweep(start, get(tags, 51), get(tags, 73, 1) !== 0, Math.PI * 2)
  const steps = Math.max(12, Math.min(300, Math.ceil(Math.abs(sweep) * 24)))
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = start + sweep * index / steps
    return point(center.x + major.x * Math.cos(t) - major.y * ratio * Math.sin(t),
      center.y + major.y * Math.cos(t) + major.x * ratio * Math.sin(t))
  })
}

function sampleBulge(start: Point, end: Point, bulge: number): Loop {
  if (Math.abs(bulge) < 1e-9 || same(start, end)) return [start, end]
  const theta = 4 * Math.atan(bulge)
  const chord = Math.hypot(end.x - start.x, end.y - start.y)
  const d = chord / (2 * Math.tan(theta / 2))
  const mid = point((start.x + end.x) / 2, (start.y + end.y) / 2)
  const center = point(mid.x - (end.y - start.y) * d / chord, mid.y + (end.x - start.x) * d / chord)
  const radius = Math.hypot(start.x - center.x, start.y - center.y)
  const a = Math.atan2(start.y - center.y, start.x - center.x)
  const steps = Math.max(2, Math.min(200, Math.ceil(Math.abs(theta) / radians(6))))
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = a + theta * index / steps
    return point(center.x + Math.cos(t) * radius, center.y + Math.sin(t) * radius)
  })
}

function sampleSpline(tags: Tag[]): Loop {
  // Clamped B-spline (including rational weights); no arbitrary control-point shortcuts.
  const degree = Math.max(1, Math.floor(get(tags, 94, 3)))
  const knots = tags.filter((t) => t.code === 40).map((t) => finite(t.value))
  const xs = tags.filter((t) => t.code === 10).map((t) => finite(t.value))
  const ys = tags.filter((t) => t.code === 20).map((t) => finite(t.value))
  const ws = tags.filter((t) => t.code === 42).map((t) => finite(t.value, 1))
  const n = Math.min(xs.length, ys.length, Math.floor(get(tags, 96, xs.length)))
  if (n < 2 || knots.length < n + degree + 1 || degree >= n) return []
  const lower = knots[degree]
  const upper = knots[n]
  if (!(upper > lower)) return []
  const samples = Math.min(200, Math.max(16, n * 6))
  const out: Loop = []
  for (let s = 0; s <= samples; s++) {
    const t = s === samples ? upper - 1e-10 : lower + (upper - lower) * s / samples
    let span = degree
    while (span < n - 1 && t >= knots[span + 1]) span++
    const weights = Array.from({ length: degree + 1 }, (_, i) => {
      const k = span - degree + i
      const w = ws[k] ?? 1
      return [xs[k] * w, ys[k] * w, w]
    })
    for (let level = 1; level <= degree; level++) {
      for (let i = degree; i >= level; i--) {
        const k = span - degree + i
        const denominator = knots[k + degree - level + 1] - knots[k]
        const alpha = denominator ? (t - knots[k]) / denominator : 0
        for (let v = 0; v < 3; v++) weights[i][v] = weights[i - 1][v] * (1 - alpha) + weights[i][v] * alpha
      }
    }
    if (weights[degree][2]) out.push(point(weights[degree][0] / weights[degree][2], weights[degree][1] / weights[degree][2]))
  }
  if (out.length) out[out.length - 1] = point(xs[n - 1], ys[n - 1])
  return out
}

function joinEdges(segments: Loop[]): Loop {
  const out: Loop = []
  for (const original of segments) {
    if (!original.length) continue
    const segment = out.length && same(out[out.length - 1], original[original.length - 1]) ? [...original].reverse() : original
    for (const vertex of segment) {
      if (!out.length || !same(out[out.length - 1], vertex)) out.push(vertex)
    }
  }
  if (out.length > 1 && same(out[0], out[out.length - 1])) out.pop()
  return out
}

function readHatchLoops(tags: Tag[], warnings: string[]): Loop[] {
  const start = tags.findIndex((t) => t.code === 91)
  if (start < 0) return []
  const count = Math.min(500, Math.floor(finite(tags[start].value)))
  const paths: Loop[] = []
  let i = start + 1
  for (let path = 0; path < count; path++) {
    while (i < tags.length && tags[i].code !== 92) i++
    if (i >= tags.length) break
    const flags = finite(tags[i++].value)
    if (flags & 2) {
      while (i < tags.length && tags[i].code !== 93 && tags[i].code !== 92) i++
      if (tags[i]?.code !== 93) continue
      const n = Math.min(100000, Math.floor(finite(tags[i++].value)))
      const vertices: { p: Point; bulge: number }[] = []
      for (let v = 0; v < n; v++) {
        while (i < tags.length && tags[i].code !== 10 && tags[i].code !== 92) i++
        if (tags[i]?.code !== 10) break
        const x = finite(tags[i++].value)
        if (tags[i]?.code !== 20) break
        const y = finite(tags[i++].value)
        const bulge = tags[i]?.code === 42 ? finite(tags[i++].value) : 0
        vertices.push({ p: point(x, y), bulge })
      }
      const loop: Loop = []
      for (let v = 0; v < vertices.length; v++) {
        const current = vertices[v]
        const next = vertices[(v + 1) % vertices.length]
        const samples = sampleBulge(current.p, next.p, current.bulge)
        loop.push(...samples.slice(0, -1))
      }
      if (loop.length >= 3) paths.push(loop)
    } else {
      while (i < tags.length && tags[i].code !== 93 && tags[i].code !== 92) i++
      if (tags[i]?.code !== 93) continue
      const n = Math.min(100000, Math.floor(finite(tags[i++].value)))
      const edges: Loop[] = []
      for (let e = 0; e < n; e++) {
        while (i < tags.length && tags[i].code !== 72 && tags[i].code !== 92) i++
        if (tags[i]?.code !== 72) break
        const type = finite(tags[i++].value)
        const props: Tag[] = []
        while (i < tags.length && ![72, 92, 97, 75, 76, 98].includes(tags[i].code)) props.push(tags[i++])
        if (type === 1) edges.push([point(get(props, 10), get(props, 20)), point(get(props, 11), get(props, 21))])
        else if (type === 2) edges.push(sampleArc(point(get(props, 10), get(props, 20)), get(props, 40), get(props, 50), get(props, 51), get(props, 73, 1) !== 0))
        else if (type === 3) edges.push(sampleEllipse(props))
        else if (type === 4) {
          const sampled = sampleSpline(props)
          if (sampled.length) edges.push(sampled)
          else warnings.push("A spline hatch boundary could not be sampled.")
        } else warnings.push("Unsupported hatch edge type " + type + ".")
      }
      const loop = joinEdges(edges)
      if (loop.length >= 3) paths.push(loop)
    }
  }
  return paths
}

function stripes(loops: Loop[], spacingRequested: number, angleDegrees: number, limit: number): [Point, Point][] {
  const vertices = loops.flat()
  if (!vertices.length) return []
  const angle = radians(angleDegrees)
  const ux = Math.cos(angle), uy = Math.sin(angle)
  const vx = -uy, vy = ux
  const v = (p: Point) => p.x * vx + p.y * vy
  const u = (p: Point) => p.x * ux + p.y * uy
  const projections = vertices.map(v)
  const min = Math.min(...projections), max = Math.max(...projections)
  const range = max - min
  if (!(range > 1e-8)) return []
  const spacing = Math.max(spacingRequested, range / 900)
  const output: [Point, Point][] = []
  for (let t = Math.ceil(min / spacing) * spacing; t < max && output.length < limit; t += spacing) {
    const intersections: number[] = []
    for (const loop of loops) {
      for (let k = 0; k < loop.length; k++) {
        const a = loop[k], b = loop[(k + 1) % loop.length]
        const aV = v(a), bV = v(b)
        if ((aV <= t && bV > t) || (bV <= t && aV > t)) {
          const alpha = (t - aV) / (bV - aV)
          intersections.push(u(a) + (u(b) - u(a)) * alpha)
        }
      }
    }
    intersections.sort((a, b) => a - b)
    for (let k = 0; k + 1 < intersections.length && output.length < limit; k += 2) {
      const start = intersections[k], end = intersections[k + 1]
      if (end - start > 1e-6) output.push([
        point(ux * start + vx * t, uy * start + vy * t),
        point(ux * end + vx * t, uy * end + vy * t),
      ])
    }
  }
  return output
}

function solidLoop(tags: Tag[]): Loop {
  const p = (xCode: number, yCode: number) => point(get(tags, xCode), get(tags, yCode))
  const result = [p(10, 20), p(11, 21), p(13, 23), p(12, 22)]
  if (same(result[2], result[3])) result.pop()
  return result
}

function sourceMeta(tags: Tag[]) {
  const layer = first(tags, 8, "0")
  const owner = first(tags, 330)
  const color = tags.find((t) => t.code === 62)
  const rgb = tags.find((t) => t.code === 420)
  const elevation = get(tags, 30)
  return { layer, owner, color, rgb, elevation }
}

function compatiblePlane(tags: Tag[]) {
  return get(tags, 210) === 0 && get(tags, 220) === 0 && get(tags, 230, 1) === 1
}

function formatEntity(kind: "LINE" | "LWPOLYLINE", geometry: Loop, meta: ReturnType<typeof sourceMeta>, handle: string): Tag[] {
  const out: Tag[] = [tag(0, kind), tag(5, handle)]
  if (meta.owner) out.push(tag(330, meta.owner))
  out.push(tag(100, "AcDbEntity"), tag(8, meta.layer))
  if (meta.color && meta.color.value !== "256") out.push(meta.color)
  if (meta.rgb) out.push(meta.rgb)
  if (kind === "LINE") {
    out.push(tag(100, "AcDbLine"))
    out.push(tag(10, number(geometry[0].x)), tag(20, number(geometry[0].y)), tag(30, number(meta.elevation)))
    out.push(tag(11, number(geometry[1].x)), tag(21, number(geometry[1].y)), tag(31, number(meta.elevation)))
  } else {
    out.push(tag(100, "AcDbPolyline"), tag(90, geometry.length), tag(70, 1))
    if (meta.elevation) out.push(tag(38, number(meta.elevation)))
    for (const p of geometry) out.push(tag(10, number(p.x)), tag(20, number(p.y)))
  }
  return out
}

function parseAscii(text: string): Tag[] {
  if (text.includes("\0") || text.startsWith("AutoCAD Binary DXF")) throw new Error("Binary DXF is not supported. Save an ASCII DXF and try again.")
  const lines = text.split(/\r\n|\n|\r/)
  while (lines.length && lines[lines.length - 1] === "") lines.pop()
  if (lines.length % 2) throw new Error("Invalid ASCII DXF: group-code/value pairs are incomplete.")
  const tags: Tag[] = []
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim())
    if (!Number.isInteger(code)) throw new Error("Invalid DXF group code near line " + (i + 1) + ".")
    tags.push(tag(code, lines[i + 1]))
  }
  if (!tags.some((t) => t.code === 0 && t.value === "EOF")) throw new Error("DXF has no EOF marker.")
  return tags
}

export function convertDxfHatches(input: string, options: HatchConvertOptions): HatchConvertResult {
  if (!(options.spacing > 0) || !Number.isFinite(options.spacing)) throw new Error("Hatch spacing must be a positive drawing-unit distance.")
  const tags = parseAscii(input)
  let maxHandle = 0
  for (const t of tags) if (t.code === 5 && /^[0-9A-F]+$/i.test(t.value)) maxHandle = Math.max(maxHandle, Number.parseInt(t.value, 16))
  if (!Number.isSafeInteger(maxHandle)) throw new Error("DXF handle range is too large.")
  const handle = () => (++maxHandle).toString(16).toUpperCase()
  let section = "", block = ""
  let hatches = 0, solids = 0, generatedLines = 0, generatedOutlines = 0
  const updatedBlocks = new Set<string>()
  const warnings: string[] = []
  const output: Tag[] = []
  for (let i = 0; i < tags.length;) {
    const current = tags[i]
    if (current.code === 0 && current.value === "SECTION") section = tags[i + 1]?.code === 2 ? tags[i + 1].value : ""
    if (current.code === 0 && current.value === "ENDSEC") section = ""
    if (current.code === 0 && current.value === "BLOCK" && section === "BLOCKS") {
      block = ""
      for (let j = i + 1; j < tags.length && tags[j].code !== 0; j++) if (tags[j].code === 2) { block = tags[j].value; break }
    }
    if (current.code === 0 && current.value === "ENDBLK") block = ""
    const isGeometrySection = section === "ENTITIES" || section === "BLOCKS"
    const isHatch = current.code === 0 && current.value === "HATCH"
    const isSolid = current.code === 0 && (current.value === "SOLID" || current.value === "TRACE") && options.convertSolids
    if (!isGeometrySection || (!isHatch && !isSolid)) {
      output.push(current)
      i++
      continue
    }
    let end = i + 1
    while (end < tags.length && tags[end].code !== 0) end++
    const entity = tags.slice(i, end)
    if (!compatiblePlane(entity)) {
      output.push(...entity)
      warnings.push("Skipped an entity with a non-horizontal extrusion direction.")
      i = end
      continue
    }
    const loops = isSolid ? [solidLoop(entity)] : readHatchLoops(entity, warnings)
    const valid = loops.filter((loop) => loop.length >= 3 && loop.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
    if (!valid.length) {
      output.push(...entity)
      warnings.push("A hatch or solid had no usable closed boundary and was retained unchanged.")
      i = end
      continue
    }
    const meta = sourceMeta(entity)
    // HATCH path vertices are in the source drawing's local block or model coordinates.
    // Keeping INSERTs unchanged makes arrows, symbols and repeated blocks transform normally.
    for (const loop of valid) {
      output.push(...formatEntity("LWPOLYLINE", loop, meta, handle()))
      generatedOutlines++
    }
    if (options.mode === "full") {
      const patternAngle = !isSolid && get(entity, 70, 1) === 0 ? get(entity, 53, 45) : 45
      const remaining = Math.max(0, 250000 - generatedLines)
      const lines = remaining ? stripes(valid, options.spacing, patternAngle, Math.min(18000, remaining)) : []
      for (const line of lines) output.push(...formatEntity("LINE", line, meta, handle()))
      generatedLines += lines.length
      if (!remaining || lines.length === 18000) warnings.push("Line-density safety limit reached for one or more fills. Outlines remain available.")
    }
    if (isHatch) hatches++
    else solids++
    if (section === "BLOCKS") updatedBlocks.add(block)
    i = end
  }
  if (hatches + solids === 0) warnings.push("No convertible HATCH or SOLID entities were found.")
  // Make the new handles available to subsequent editors.
  const handseed = output.findIndex((t) => t.code === 9 && t.value === "$HANDSEED")
  if (handseed >= 0 && output[handseed + 1]?.code === 5) output[handseed + 1] = tag(5, (maxHandle + 1).toString(16).toUpperCase())
  return {
    dxf: output.map((t) => t.code + "\r\n" + t.value).join("\r\n") + "\r\n",
    hatches, solids, generatedLines, generatedOutlines, blocksUpdated: updatedBlocks.size,
    warnings: [...new Set(warnings)],
  }
}
