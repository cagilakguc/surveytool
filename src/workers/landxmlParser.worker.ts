import type {
  LandXmlAlignment,
  LandXmlDocument,
  LandXmlFace,
  LandXmlSurface,
  PlanPoint,
} from "../lib/landxml"

type WorkerRequest = {
  buffer: ArrayBuffer
  fileName: string
}

type TagBlock = {
  attributes: Record<string, string>
  body: string
}

function postProgress(stage: string, percent: number) {
  self.postMessage({ type: "progress", stage, percent })
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

function parseAttributes(source: string) {
  const attributes: Record<string, string> = {}
  const expression = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null

  while ((match = expression.exec(source)) !== null) {
    const rawName = match[1]
    const name = rawName.includes(":")
      ? rawName.slice(rawName.lastIndexOf(":") + 1)
      : rawName
    attributes[name] = decodeXml(match[2] ?? match[3] ?? "")
  }

  return attributes
}

function tagBlocks(source: string, localName: string) {
  const name = escapeRegExp(localName)
  const expression = new RegExp(
    `<(?:[\\w.-]+:)?${name}\\b([^>]*)>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}\\s*>`,
    "gi",
  )
  const blocks: TagBlock[] = []
  let match: RegExpExecArray | null

  while ((match = expression.exec(source)) !== null) {
    blocks.push({
      attributes: parseAttributes(match[1]),
      body: match[2],
    })
  }

  return blocks
}

function firstTagBlock(source: string, localName: string) {
  return tagBlocks(source, localName)[0] ?? null
}

function firstTagAttributes(source: string, localName: string) {
  const name = escapeRegExp(localName)
  const expression = new RegExp(
    `<(?:[\\w.-]+:)?${name}\\b([^>]*)\\/?>`,
    "i",
  )
  const match = expression.exec(source)
  return match ? parseAttributes(match[1]) : null
}

function textValues(source: string, localName: string) {
  return tagBlocks(source, localName).map((block) => decodeXml(block.body.trim()))
}

function parseNumber(value: string | undefined) {
  if (!value?.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parsePointText(text: string | null | undefined): PlanPoint | null {
  const values = (text ?? "")
    .replace(/<[^>]*>/g, " ")
    .trim()
    .split(/[\s,]+/)
    .map(Number)

  if (
    values.length < 2 ||
    !Number.isFinite(values[0]) ||
    !Number.isFinite(values[1])
  ) {
    return null
  }

  return {
    northing: values[0],
    easting: values[1],
    elevation:
      values.length > 2 && Number.isFinite(values[2])
        ? values[2]
        : null,
  }
}

function pointFromTag(source: string, localName: string) {
  return parsePointText(firstTagBlock(source, localName)?.body)
}

function pointsMatch(a: PlanPoint, b: PlanPoint) {
  return (
    Math.abs(a.easting - b.easting) < 0.000001 &&
    Math.abs(a.northing - b.northing) < 0.000001
  )
}

function pushPoint(points: PlanPoint[], point: PlanPoint | null) {
  if (!point) return
  const previous = points[points.length - 1]
  if (!previous || !pointsMatch(previous, point)) points.push(point)
}

function sampleCurve(body: string, attributes: Record<string, string>) {
  const start = pointFromTag(body, "Start")
  const center = pointFromTag(body, "Center")
  const end = pointFromTag(body, "End")

  if (!start || !center || !end) {
    return [start, end].filter((point): point is PlanPoint => point !== null)
  }

  const startAngle = Math.atan2(
    start.northing - center.northing,
    start.easting - center.easting,
  )
  let endAngle = Math.atan2(
    end.northing - center.northing,
    end.easting - center.easting,
  )
  const rotation = (attributes.rot ?? "ccw").toLowerCase()

  if (rotation.includes("cw")) {
    while (endAngle >= startAngle) endAngle -= Math.PI * 2
  } else {
    while (endAngle <= startAngle) endAngle += Math.PI * 2
  }

  const delta = endAngle - startAngle
  const radius = Math.hypot(
    start.easting - center.easting,
    start.northing - center.northing,
  )
  const steps = Math.min(
    96,
    Math.max(8, Math.ceil(Math.abs(delta) / (Math.PI / 24))),
  )

  return Array.from({ length: steps + 1 }, (_, index) => {
    const ratio = index / steps
    const angle = startAngle + delta * ratio
    return {
      easting: center.easting + Math.cos(angle) * radius,
      northing: center.northing + Math.sin(angle) * radius,
      elevation:
        start.elevation !== null && end.elevation !== null
          ? start.elevation + (end.elevation - start.elevation) * ratio
          : null,
    }
  })
}

function parseAlignmentPoints(alignmentBody: string) {
  const coordGeom = firstTagBlock(alignmentBody, "CoordGeom")
  if (!coordGeom) return []

  const points: PlanPoint[] = []
  const geometryExpression = /<(?:[\w.-]+:)?(Line|Curve|Spiral|IrregularLine)\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?\1\s*>/gi
  let geometry: RegExpExecArray | null

  while ((geometry = geometryExpression.exec(coordGeom.body)) !== null) {
    const geometryType = geometry[1].toLowerCase()
    const attributes = parseAttributes(geometry[2])
    const body = geometry[3]

    if (geometryType === "curve") {
      sampleCurve(body, attributes).forEach((point) => pushPoint(points, point))
      continue
    }

    if (geometryType === "irregularline") {
      const list = firstTagBlock(body, "PntList2D")
      const values = (list?.body ?? "")
        .replace(/<[^>]*>/g, " ")
        .trim()
        .split(/[\s,]+/)
        .map(Number)

      for (let index = 0; index + 1 < values.length; index += 2) {
        if (Number.isFinite(values[index]) && Number.isFinite(values[index + 1])) {
          pushPoint(points, {
            northing: values[index],
            easting: values[index + 1],
            elevation: null,
          })
        }
      }
      continue
    }

    pushPoint(points, pointFromTag(body, "Start"))
    pushPoint(points, pointFromTag(body, "PI"))
    pushPoint(points, pointFromTag(body, "End"))
  }

  if (points.length === 0) {
    const list = firstTagBlock(coordGeom.body, "PntList2D")
    const values = (list?.body ?? "")
      .replace(/<[^>]*>/g, " ")
      .trim()
      .split(/[\s,]+/)
      .map(Number)

    for (let index = 0; index + 1 < values.length; index += 2) {
      if (Number.isFinite(values[index]) && Number.isFinite(values[index + 1])) {
        pushPoint(points, {
          northing: values[index],
          easting: values[index + 1],
          elevation: null,
        })
      }
    }
  }

  return points
}

function parseSurface(block: TagBlock, index: number): LandXmlSurface {
  const definition = firstTagBlock(block.body, "Definition")
  const source = definition?.body ?? block.body
  const points: Record<string, PlanPoint> = {}
  const pointContainer = firstTagBlock(source, "Pnts")?.body ?? source
  const pointExpression = /<(?:[\w.-]+:)?P\b([^>]*)>([^<]*)<\/(?:[\w.-]+:)?P\s*>/gi
  let pointMatch: RegExpExecArray | null
  let pointIndex = 0

  while ((pointMatch = pointExpression.exec(pointContainer)) !== null) {
    const point = parsePointText(pointMatch[2])
    if (!point) continue
    const attributes = parseAttributes(pointMatch[1])
    points[attributes.id ?? String(pointIndex + 1)] = point
    pointIndex += 1
  }

  const faces: LandXmlFace[] = []
  const faceContainer = firstTagBlock(source, "Faces")?.body ?? source
  const faceExpression = /<(?:[\w.-]+:)?F\b[^>]*>([^<]*)<\/(?:[\w.-]+:)?F\s*>/gi
  let faceMatch: RegExpExecArray | null

  while ((faceMatch = faceExpression.exec(faceContainer)) !== null) {
    const ids = faceMatch[1].trim().split(/\s+/)
    if (ids.length >= 3) faces.push([ids[0], ids[1], ids[2]])
  }

  let minElevation: number | null = null
  let maxElevation: number | null = null
  Object.values(points).forEach((point) => {
    if (point.elevation === null) return
    minElevation = minElevation === null
      ? point.elevation
      : Math.min(minElevation, point.elevation)
    maxElevation = maxElevation === null
      ? point.elevation
      : Math.max(maxElevation, point.elevation)
  })

  return {
    name: block.attributes.name ?? `Surface ${index + 1}`,
    points,
    faces,
    minElevation,
    maxElevation,
  }
}

function parseLandXmlText(xmlText: string, fileName: string): LandXmlDocument {
  if (!/<(?:[\w.-]+:)?LandXML\b/i.test(xmlText)) {
    throw new Error("This does not appear to be a LandXML file.")
  }

  const rootAttributes = firstTagAttributes(xmlText, "LandXML") ?? {}
  const project = firstTagAttributes(xmlText, "Project") ?? {}
  const application = firstTagAttributes(xmlText, "Application") ?? {}
  const metric = firstTagAttributes(xmlText, "Metric")
  const imperial = firstTagAttributes(xmlText, "Imperial")
  const unit = metric ?? imperial

  postProgress("Reading TIN surfaces", 30)
  const surfaceBlocks = tagBlocks(xmlText, "Surface")
  const surfaces = surfaceBlocks.map((block, index) => {
    if (index % 4 === 0) {
      postProgress(
        `Reading surface ${index + 1} of ${surfaceBlocks.length}`,
        30 + Math.round(((index + 1) / Math.max(surfaceBlocks.length, 1)) * 45),
      )
    }
    return parseSurface(block, index)
  })

  postProgress("Reading alignments", 80)
  const alignments: LandXmlAlignment[] = tagBlocks(xmlText, "Alignment").map(
    (block, index) => ({
      name: block.attributes.name ?? `Alignment ${index + 1}`,
      length: parseNumber(block.attributes.length),
      startStation: parseNumber(block.attributes.staStart),
      points: parseAlignmentPoints(block.body),
    }),
  )

  postProgress("Reading COGO points", 90)
  const cogoPoints = tagBlocks(xmlText, "CgPoint")
    .map((block, index) => {
      const point = parsePointText(block.body)
      return point
        ? {
            ...point,
            name: block.attributes.name ?? block.attributes.oID ?? String(index + 1),
          }
        : null
    })
    .filter(
      (point): point is PlanPoint & { name: string } => point !== null,
    )

  const warnings: string[] = []
  if (surfaces.length === 0 && alignments.length === 0 && cogoPoints.length === 0) {
    warnings.push("No supported surfaces, alignments or COGO points were found.")
  }
  surfaces.forEach((surface) => {
    if (Object.keys(surface.points).length === 0) {
      warnings.push(`${surface.name} contains no readable TIN points.`)
    }
    if (surface.faces.length === 0 && Object.keys(surface.points).length > 0) {
      warnings.push(`${surface.name} contains points but no readable TIN faces.`)
    }
  })

  return {
    fileName,
    version: rootAttributes.version ?? "Unknown",
    projectName: project.name ?? "Unnamed project",
    applicationName: application.name ?? application.manufacturer ?? "Not specified",
    units: unit?.linearUnit ?? (metric ? "metric" : imperial ? "imperial" : "Unknown"),
    surfaces,
    alignments,
    cogoPoints,
    warnings,
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    postProgress("Opening file", 5)
    const text = new TextDecoder("utf-8").decode(event.data.buffer)
    postProgress("Reading LandXML structure", 15)
    const document = parseLandXmlText(text, event.data.fileName)
    postProgress("Finalising", 98)
    self.postMessage({ type: "result", document })
  } catch (error) {
    self.postMessage({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "The LandXML file could not be read.",
    })
  }
}
