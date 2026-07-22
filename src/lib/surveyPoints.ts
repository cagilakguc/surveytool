export type SurveyPoint = {
  id: string
  easting: number
  northing: number
  elevation: number
  code: string
}

export type SurveyPointLayer = {
  name: string
  format: "CSV" | "TXT" | "DXF"
  points: SurveyPoint[]
  warnings: string[]
}

const maximumPoints = 500_000

const aliases = {
  id: ["id", "pointid", "point", "pointno", "pointnumber", "ptno", "number", "name"],
  easting: ["easting", "east", "e", "x", "coordx", "xcoordinate"],
  northing: ["northing", "north", "n", "y", "coordy", "ycoordinate"],
  elevation: ["elevation", "level", "rl", "z", "height", "reducedlevel"],
  code: ["code", "featurecode", "description", "desc", "layer", "string"],
}

function normalise(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function splitDelimitedLine(line: string, delimiter: string) {
  if (delimiter === "whitespace") return line.trim().split(/\s+/)

  const values: string[] = []
  let value = ""
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === delimiter && !quoted) {
      values.push(value.trim())
      value = ""
    } else {
      value += character
    }
  }

  values.push(value.trim())
  return values
}

function detectDelimiter(line: string) {
  const candidates = [",", "\t", ";"]
    .map((delimiter) => ({
      delimiter,
      count: splitDelimitedLine(line, delimiter).length,
    }))
    .sort((a, b) => b.count - a.count)

  return candidates[0] && candidates[0].count > 1
    ? candidates[0].delimiter
    : "whitespace"
}

function findHeaderIndex(headers: string[], candidates: string[]) {
  return headers.findIndex((header) => candidates.includes(header))
}

function finiteNumber(value: string | undefined) {
  if (value === undefined || value.trim() === "") return null
  const parsed = Number(value.replace(/,/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function parseDelimited(text: string, fileName: string): SurveyPointLayer {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("//"))

  if (lines.length === 0) throw new Error(`${fileName} does not contain readable point rows.`)

  const delimiter = detectDelimiter(lines[0])
  const firstRow = splitDelimitedLine(lines[0], delimiter)
  const headers = firstRow.map(normalise)
  const eastingHeader = findHeaderIndex(headers, aliases.easting)
  const northingHeader = findHeaderIndex(headers, aliases.northing)
  const elevationHeader = findHeaderIndex(headers, aliases.elevation)
  const hasHeader = eastingHeader >= 0 && northingHeader >= 0 && elevationHeader >= 0

  let idIndex = hasHeader ? findHeaderIndex(headers, aliases.id) : -1
  let eastingIndex = eastingHeader
  let northingIndex = northingHeader
  let elevationIndex = elevationHeader
  let codeIndex = hasHeader ? findHeaderIndex(headers, aliases.code) : -1
  let startIndex = hasHeader ? 1 : 0

  if (!hasHeader) {
    if (firstRow.length >= 4 && finiteNumber(firstRow[1]) !== null && finiteNumber(firstRow[2]) !== null && finiteNumber(firstRow[3]) !== null) {
      idIndex = 0
      eastingIndex = 1
      northingIndex = 2
      elevationIndex = 3
      codeIndex = firstRow.length >= 5 ? 4 : -1
    } else if (firstRow.length >= 3 && finiteNumber(firstRow[0]) !== null && finiteNumber(firstRow[1]) !== null && finiteNumber(firstRow[2]) !== null) {
      eastingIndex = 0
      northingIndex = 1
      elevationIndex = 2
      codeIndex = firstRow.length >= 4 ? 3 : -1
    } else {
      throw new Error(`${fileName} needs Easting, Northing and Elevation/RL columns.`)
    }
  }

  const points: SurveyPoint[] = []
  let skipped = 0

  for (let rowIndex = startIndex; rowIndex < lines.length; rowIndex += 1) {
    const row = splitDelimitedLine(lines[rowIndex], delimiter)
    const easting = finiteNumber(row[eastingIndex])
    const northing = finiteNumber(row[northingIndex])
    const elevation = finiteNumber(row[elevationIndex])

    if (easting === null || northing === null || elevation === null) {
      skipped += 1
      continue
    }

    points.push({
      id: idIndex >= 0 && row[idIndex] ? row[idIndex] : `P${points.length + 1}`,
      easting,
      northing,
      elevation,
      code: codeIndex >= 0 && row[codeIndex] ? row[codeIndex] : "",
    })

    if (points.length > maximumPoints) {
      throw new Error(`${fileName} contains more than ${maximumPoints.toLocaleString("en-NZ")} points.`)
    }
  }

  if (points.length === 0) throw new Error(`${fileName} does not contain valid XYZ survey points.`)

  return {
    name: fileName,
    format: fileName.toLowerCase().endsWith(".csv") ? "CSV" : "TXT",
    points,
    warnings: skipped > 0 ? [`${skipped.toLocaleString("en-NZ")} invalid row${skipped === 1 ? " was" : "s were"} skipped.`] : [],
  }
}

type DxfPair = { code: number; value: string }

function parseDxfPairs(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/)
  const pairs: DxfPair[] = []
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index].trim())
    if (Number.isFinite(code)) pairs.push({ code, value: lines[index + 1].trim() })
  }
  return pairs
}

function entityValue(entity: DxfPair[], code: number) {
  return entity.find((pair) => pair.code === code)?.value
}

function entityNumbers(entity: DxfPair[], code: number) {
  return entity
    .filter((pair) => pair.code === code)
    .map((pair) => Number(pair.value))
    .filter(Number.isFinite)
}

function parseDxf(text: string, fileName: string): SurveyPointLayer {
  if (/AutoCAD Binary DXF/i.test(text.slice(0, 64))) {
    throw new Error(`${fileName} is a binary DXF. Export it as ASCII DXF first.`)
  }

  const pairs = parseDxfPairs(text)
  const points: SurveyPoint[] = []
  let current: DxfPair[] = []
  let entityType = ""

  function addPoint(easting: number | undefined, northing: number | undefined, elevation: number | undefined, id: string, code: string) {
    if (!Number.isFinite(easting) || !Number.isFinite(northing) || !Number.isFinite(elevation)) return
    points.push({ id, easting: easting as number, northing: northing as number, elevation: elevation as number, code })
  }

  function flush() {
    if (!entityType || current.length === 0) return
    const layer = entityValue(current, 8) ?? ""
    const handle = entityValue(current, 5) ?? `${points.length + 1}`

    if (entityType === "POINT" || entityType === "INSERT" || entityType === "VERTEX") {
      addPoint(
        Number(entityValue(current, 10)),
        Number(entityValue(current, 20)),
        Number(entityValue(current, 30) ?? 0),
        entityValue(current, 1) ?? `${entityType}-${handle}`,
        layer,
      )
    } else if (entityType === "LINE") {
      addPoint(Number(entityValue(current, 10)), Number(entityValue(current, 20)), Number(entityValue(current, 30) ?? 0), `LINE-${handle}-1`, layer)
      addPoint(Number(entityValue(current, 11)), Number(entityValue(current, 21)), Number(entityValue(current, 31) ?? 0), `LINE-${handle}-2`, layer)
    } else if (entityType === "LWPOLYLINE") {
      const eastings = entityNumbers(current, 10)
      const northings = entityNumbers(current, 20)
      const elevation = Number(entityValue(current, 38) ?? entityValue(current, 30) ?? 0)
      const count = Math.min(eastings.length, northings.length)
      for (let index = 0; index < count; index += 1) {
        addPoint(eastings[index], northings[index], elevation, `LWPOLYLINE-${handle}-${index + 1}`, layer)
      }
    }
  }

  for (const pair of pairs) {
    if (pair.code === 0) {
      flush()
      entityType = pair.value.toUpperCase()
      current = []
    } else {
      current.push(pair)
    }
  }
  flush()

  if (points.length === 0) {
    throw new Error(`${fileName} has no readable 3D POINT, INSERT, VERTEX, LINE or LWPOLYLINE geometry.`)
  }
  if (points.length > maximumPoints) {
    throw new Error(`${fileName} contains more than ${maximumPoints.toLocaleString("en-NZ")} extracted points.`)
  }

  return { name: fileName, format: "DXF", points, warnings: [] }
}

export async function parseSurveyPointFile(file: File): Promise<SurveyPointLayer> {
  const extension = file.name.toLowerCase().split(".").pop()
  if (!extension || !["csv", "txt", "dxf"].includes(extension)) {
    throw new Error(`${file.name} is not a supported CSV, TXT or DXF point file.`)
  }

  const text = await file.text()
  return extension === "dxf" ? parseDxf(text, file.name) : parseDelimited(text, file.name)
}
