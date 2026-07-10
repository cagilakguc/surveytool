export type PlanPoint = {
  easting: number
  northing: number
  elevation: number | null
}

export type LandXmlFace = [string, string, string]

export type LandXmlSurface = {
  name: string
  points: Record<string, PlanPoint>
  faces: LandXmlFace[]
  minElevation: number | null
  maxElevation: number | null
}

export type LandXmlAlignment = {
  name: string
  length: number | null
  startStation: number | null
  points: PlanPoint[]
}

export type LandXmlDocument = {
  fileName: string
  version: string
  projectName: string
  applicationName: string
  units: string
  surfaces: LandXmlSurface[]
  alignments: LandXmlAlignment[]
  cogoPoints: Array<PlanPoint & { name: string }>
  warnings: string[]
}

function elementsByLocalName(
  parent: Document | Element,
  localName: string,
) {
  return Array.from(
    parent.getElementsByTagNameNS("*", localName),
  )
}

function firstElementByLocalName(
  parent: Document | Element,
  localName: string,
) {
  return elementsByLocalName(parent, localName)[0] ?? null
}

function parseNumber(value: string | null | undefined) {
  if (!value?.trim()) {
    return null
  }

  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function parsePointText(text: string | null): PlanPoint | null {
  const values = (text ?? "")
    .trim()
    .split(/\s+/)
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

function getGeometryPoint(
  geometry: Element,
  localName: string,
) {
  return parsePointText(
    firstElementByLocalName(geometry, localName)?.textContent ??
      null,
  )
}

function pointsMatch(a: PlanPoint, b: PlanPoint) {
  return (
    Math.abs(a.easting - b.easting) < 0.000001 &&
    Math.abs(a.northing - b.northing) < 0.000001
  )
}

function pushPoint(points: PlanPoint[], point: PlanPoint | null) {
  if (!point) {
    return
  }

  const previous = points[points.length - 1]
  if (!previous || !pointsMatch(previous, point)) {
    points.push(point)
  }
}

function sampleCurve(geometry: Element) {
  const start = getGeometryPoint(geometry, "Start")
  const center = getGeometryPoint(geometry, "Center")
  const end = getGeometryPoint(geometry, "End")

  if (!start || !center || !end) {
    return [start, end].filter(
      (point): point is PlanPoint => point !== null,
    )
  }

  const startAngle = Math.atan2(
    start.northing - center.northing,
    start.easting - center.easting,
  )
  let endAngle = Math.atan2(
    end.northing - center.northing,
    end.easting - center.easting,
  )

  const rotation = (
    geometry.getAttribute("rot") ?? "ccw"
  ).toLowerCase()

  if (rotation.includes("cw")) {
    while (endAngle >= startAngle) {
      endAngle -= Math.PI * 2
    }
  } else {
    while (endAngle <= startAngle) {
      endAngle += Math.PI * 2
    }
  }

  const delta = endAngle - startAngle
  const radius = Math.hypot(
    start.easting - center.easting,
    start.northing - center.northing,
  )
  const steps = Math.min(
    72,
    Math.max(8, Math.ceil(Math.abs(delta) / (Math.PI / 18))),
  )

  return Array.from({ length: steps + 1 }, (_, index) => {
    const ratio = index / steps
    const angle = startAngle + delta * ratio

    return {
      easting: center.easting + Math.cos(angle) * radius,
      northing: center.northing + Math.sin(angle) * radius,
      elevation:
        start.elevation !== null && end.elevation !== null
          ? start.elevation +
            (end.elevation - start.elevation) * ratio
          : null,
    }
  })
}

function parseAlignmentPoints(alignment: Element) {
  const coordGeom = firstElementByLocalName(
    alignment,
    "CoordGeom",
  )

  if (!coordGeom) {
    return []
  }

  const points: PlanPoint[] = []

  Array.from(coordGeom.children).forEach((geometry) => {
    const geometryType = geometry.localName.toLowerCase()

    if (geometryType === "curve") {
      sampleCurve(geometry).forEach((point) =>
        pushPoint(points, point),
      )
      return
    }

    if (geometryType === "irregularline") {
      const pointList = firstElementByLocalName(
        geometry,
        "PntList2D",
      )
      const values = (pointList?.textContent ?? "")
        .trim()
        .split(/\s+/)
        .map(Number)

      for (let index = 0; index + 1 < values.length; index += 2) {
        if (
          Number.isFinite(values[index]) &&
          Number.isFinite(values[index + 1])
        ) {
          pushPoint(points, {
            northing: values[index],
            easting: values[index + 1],
            elevation: null,
          })
        }
      }
      return
    }

    pushPoint(points, getGeometryPoint(geometry, "Start"))
    pushPoint(points, getGeometryPoint(geometry, "PI"))
    pushPoint(points, getGeometryPoint(geometry, "End"))
  })

  return points
}

function parseSurface(surface: Element, index: number) {
  const definition = firstElementByLocalName(
    surface,
    "Definition",
  )
  const points: Record<string, PlanPoint> = {}

  if (definition) {
    elementsByLocalName(definition, "P").forEach(
      (pointElement, pointIndex) => {
        const point = parsePointText(pointElement.textContent)
        if (!point) {
          return
        }

        const id =
          pointElement.getAttribute("id") ??
          String(pointIndex + 1)
        points[id] = point
      },
    )
  }

  const faces: LandXmlFace[] = definition
    ? elementsByLocalName(definition, "F")
        .map((face) =>
          (face.textContent ?? "").trim().split(/\s+/),
        )
        .filter((ids) => ids.length >= 3)
        .map((ids) => [ids[0], ids[1], ids[2]])
    : []

  const elevations = Object.values(points)
    .map((point) => point.elevation)
    .filter((value): value is number => value !== null)

  return {
    name:
      surface.getAttribute("name") ??
      `Surface ${index + 1}`,
    points,
    faces,
    minElevation:
      elevations.length > 0 ? Math.min(...elevations) : null,
    maxElevation:
      elevations.length > 0 ? Math.max(...elevations) : null,
  } satisfies LandXmlSurface
}

export function parseLandXml(
  xmlText: string,
  fileName: string,
): LandXmlDocument {
  const parser = new DOMParser()
  const xml = parser.parseFromString(xmlText, "application/xml")

  if (xml.getElementsByTagName("parsererror").length > 0) {
    throw new Error(
      "This file contains invalid XML and could not be read.",
    )
  }

  const root = xml.documentElement
  if (root.localName.toLowerCase() !== "landxml") {
    throw new Error(
      "This does not appear to be a LandXML file.",
    )
  }

  const project = firstElementByLocalName(xml, "Project")
  const application = firstElementByLocalName(
    xml,
    "Application",
  )
  const metric = firstElementByLocalName(xml, "Metric")
  const imperial = firstElementByLocalName(xml, "Imperial")
  const unitElement = metric ?? imperial

  const surfaces = elementsByLocalName(xml, "Surface").map(
    parseSurface,
  )

  const alignments = elementsByLocalName(
    xml,
    "Alignment",
  ).map((alignment, index) => ({
    name:
      alignment.getAttribute("name") ??
      `Alignment ${index + 1}`,
    length: parseNumber(alignment.getAttribute("length")),
    startStation: parseNumber(
      alignment.getAttribute("staStart"),
    ),
    points: parseAlignmentPoints(alignment),
  }))

  const cogoPoints = elementsByLocalName(xml, "CgPoint")
    .map((pointElement, index) => {
      const point = parsePointText(pointElement.textContent)
      if (!point) {
        return null
      }

      return {
        ...point,
        name:
          pointElement.getAttribute("name") ??
          pointElement.getAttribute("oID") ??
          String(index + 1),
      }
    })
    .filter(
      (
        point,
      ): point is PlanPoint & { name: string } => point !== null,
    )

  const warnings: string[] = []
  if (
    surfaces.length === 0 &&
    alignments.length === 0 &&
    cogoPoints.length === 0
  ) {
    warnings.push(
      "No supported surfaces, alignments or COGO points were found.",
    )
  }

  surfaces.forEach((surface) => {
    if (Object.keys(surface.points).length === 0) {
      warnings.push(`${surface.name} contains no readable TIN points.`)
    }
  })

  return {
    fileName,
    version: root.getAttribute("version") ?? "Unknown",
    projectName:
      project?.getAttribute("name") ?? "Unnamed project",
    applicationName:
      application?.getAttribute("name") ??
      application?.getAttribute("manufacturer") ??
      "Not specified",
    units:
      unitElement?.getAttribute("linearUnit") ??
      (metric ? "metric" : imperial ? "imperial" : "Unknown"),
    surfaces,
    alignments,
    cogoPoints,
    warnings,
  }
}
