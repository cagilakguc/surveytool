import type { LandXmlDocument, LandXmlFace, LandXmlSurface, PlanPoint } from "./landxml"

// Arc/Info ASCII TIN: TIN / BEGT / TNAM / VERT <count> / TRI <count> / ENDT.
// A .tin extension alone is not a format: Autodesk/Trimble binary TINs require
// their own decoder and must never be interpreted as rows of survey points.
const maximumVertices = 500_000
const maximumFaces = 1_000_000

function tokenLines(text: string) {
  return text.replace(/^\uFEFF/, "").split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").replace(/#.*$/, "").trim())
    .filter(Boolean)
}

function countFrom(line: string, keyword: string, maximum: number) {
  const fields = line.split(/\s+/)
  const count = Number(fields[1])
  if (fields[0].toUpperCase() !== keyword || fields.length !== 2 || !Number.isSafeInteger(count) || count < 1 || count > maximum) {
    throw new Error(`${keyword} needs a positive count of at most ${maximum.toLocaleString()} in this ASCII TIN.`)
  }
  return count
}

export function parseTinAscii(text: string, fileName: string): LandXmlDocument {
  if (text.includes("\0") || text.slice(0, 256).includes("\uFFFD")) {
    throw new Error("This appears to be a binary TIN. Please export the surface as LandXML, or provide a sample so its native format can be supported.")
  }
  const lines = tokenLines(text)
  if (lines[0]?.toUpperCase() !== "TIN") {
    throw new Error("Unsupported .tin format. This importer currently reads Arc/Info ASCII TIN (TIN / BEGT / VERT / TRI); binary TIN formats need a sample or LandXML export.")
  }
  const surfaces: LandXmlSurface[] = []
  let index = 1
  while (index < lines.length) {
    if (lines[index++].toUpperCase() !== "BEGT") throw new Error("An ASCII TIN surface must begin with BEGT.")
    let name = `${fileName} · surface ${surfaces.length + 1}`
    let vertices: PlanPoint[] | null = null
    let triangles: number[][] | null = null
    let ended = false
    while (index < lines.length) {
      const line = lines[index++]
      const fields = line.split(/\s+/)
      const keyword = fields[0].toUpperCase()
      if (keyword === "ENDT") { ended = true; break }
      if (keyword === "TNAM") { name = line.slice(fields[0].length).trim() || name; continue }
      if (keyword === "MAT") continue
      if (keyword === "VERT") {
        if (vertices) throw new Error("Duplicate VERT block in the ASCII TIN.")
        const count = countFrom(line, "VERT", maximumVertices)
        if (index + count > lines.length) throw new Error("The ASCII TIN vertex list is incomplete.")
        vertices = []
        for (let n = 0; n < count; n++) {
          const coordinate = lines[index++].split(/\s+/).slice(0, 3).map(Number)
          if (coordinate.length < 3 || !coordinate.every(Number.isFinite)) throw new Error(`Invalid TIN vertex ${n + 1}. Expected Easting Northing Elevation.`)
          vertices.push({ easting: coordinate[0], northing: coordinate[1], elevation: coordinate[2] })
        }
        continue
      }
      if (keyword === "TRI") {
        if (triangles) throw new Error("Duplicate TRI block in the ASCII TIN.")
        const count = countFrom(line, "TRI", maximumFaces)
        if (index + count > lines.length) throw new Error("The ASCII TIN triangle list is incomplete.")
        triangles = []
        for (let n = 0; n < count; n++) {
          const indices = lines[index++].split(/\s+/).slice(0, 3).map(Number)
          if (indices.length < 3 || !indices.every(Number.isSafeInteger)) throw new Error(`Invalid TIN triangle ${n + 1}. Expected three vertex indices.`)
          triangles.push(indices)
        }
        continue
      }
      throw new Error(`Unexpected ASCII TIN record: ${keyword}.`)
    }
    if (!ended || !vertices?.length || !triangles?.length) throw new Error("The ASCII TIN needs complete VERT and TRI blocks followed by ENDT.")
    // Arc/Info files are normally 1-based; permit an unambiguous 0-based variant.
    const zeroBased = triangles.some((face) => face.includes(0))
    const offset = zeroBased ? 0 : 1
    const points: Record<string, PlanPoint> = {}
    vertices.forEach((point, n) => { points[String(n + 1)] = point })
    const faces: LandXmlFace[] = triangles.map((triangle, n) => {
      const ids = triangle.map((v) => v - offset + 1)
      if (ids.some((v) => v < 1 || v > vertices!.length) || new Set(ids).size !== 3) {
        throw new Error(`TIN triangle ${n + 1} references invalid or duplicate vertices.`)
      }
      return ids.map(String) as LandXmlFace
    })
    surfaces.push({ name, points, faces, minElevation: vertices[0].elevation, maxElevation: vertices[0].elevation })
    // Full scan avoids spreading hundreds of thousands of arguments to Math.min/max.
    const surface = surfaces[surfaces.length - 1]
    for (const point of vertices) {
      const elevation = point.elevation!
      surface.minElevation = Math.min(surface.minElevation!, elevation)
      surface.maxElevation = Math.max(surface.maxElevation!, elevation)
    }
  }
  if (!surfaces.length) throw new Error("This ASCII TIN contains no surfaces.")
  return {
    fileName, version: "Arc/Info ASCII TIN", projectName: fileName,
    applicationName: "Arc/Info ASCII TIN import", units: "meter", surfaces,
    alignments: [], cogoPoints: [],
    warnings: ["ASCII TIN does not declare units or a coordinate system. Metres are assumed; confirm the source grid and vertical datum before conformance checks."],
  }
}
