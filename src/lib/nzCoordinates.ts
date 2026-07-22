export type CoordinateReferenceSystem =
  | "EPSG:2105"
  | "EPSG:2193"
  | "EPSG:4167"

export type CoordinateSystemDefinition = {
  id: CoordinateReferenceSystem
  name: string
  shortName: string
  coordinateLabels: [string, string]
  projected: boolean
}

export const coordinateSystems: CoordinateSystemDefinition[] = [
  {
    id: "EPSG:2105",
    name: "NZGD2000 / Mount Eden 2000",
    shortName: "Mount Eden 2000",
    coordinateLabels: ["Easting", "Northing"],
    projected: true,
  },
  {
    id: "EPSG:2193",
    name: "NZGD2000 / New Zealand Transverse Mercator 2000",
    shortName: "NZTM2000",
    coordinateLabels: ["Easting", "Northing"],
    projected: true,
  },
  {
    id: "EPSG:4167",
    name: "NZGD2000 geographic",
    shortName: "NZGD2000 Lat / Lon",
    coordinateLabels: ["Longitude", "Latitude"],
    projected: false,
  },
]

export type Coordinate2D = {
  x: number
  y: number
}

type TransverseMercatorDefinition = {
  latitudeOrigin: number
  centralMeridian: number
  scaleFactor: number
  falseEasting: number
  falseNorthing: number
}

const semiMajorAxis = 6378137
const inverseFlattening = 298.257222101
const flattening = 1 / inverseFlattening
const eccentricitySquared = flattening * (2 - flattening)
const secondEccentricitySquared =
  eccentricitySquared / (1 - eccentricitySquared)
const degreesToRadians = Math.PI / 180
const radiansToDegrees = 180 / Math.PI

const projections: Record<
  Exclude<CoordinateReferenceSystem, "EPSG:4167">,
  TransverseMercatorDefinition
> = {
  "EPSG:2105": {
    latitudeOrigin: -36.8797222222222,
    centralMeridian: 174.764166666667,
    scaleFactor: 0.9999,
    falseEasting: 400000,
    falseNorthing: 800000,
  },
  "EPSG:2193": {
    latitudeOrigin: 0,
    centralMeridian: 173,
    scaleFactor: 0.9996,
    falseEasting: 1600000,
    falseNorthing: 10000000,
  },
}

function meridionalArc(latitude: number) {
  const e2 = eccentricitySquared
  const e4 = e2 * e2
  const e6 = e4 * e2

  return semiMajorAxis * (
    (1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * latitude -
    ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) *
      Math.sin(2 * latitude) +
    ((15 * e4) / 256 + (45 * e6) / 1024) *
      Math.sin(4 * latitude) -
    ((35 * e6) / 3072) * Math.sin(6 * latitude)
  )
}

function projectGeographic(
  longitude: number,
  latitude: number,
  definition: TransverseMercatorDefinition,
): Coordinate2D {
  const phi = latitude * degreesToRadians
  const lambda = longitude * degreesToRadians
  const phiOrigin = definition.latitudeOrigin * degreesToRadians
  const lambdaOrigin = definition.centralMeridian * degreesToRadians
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const tanPhi = Math.tan(phi)
  const radiusPrimeVertical =
    semiMajorAxis /
    Math.sqrt(1 - eccentricitySquared * sinPhi * sinPhi)
  const tanSquared = tanPhi * tanPhi
  const c = secondEccentricitySquared * cosPhi * cosPhi
  const a = (lambda - lambdaOrigin) * cosPhi
  const m = meridionalArc(phi)
  const mOrigin = meridionalArc(phiOrigin)

  const x =
    definition.falseEasting +
    definition.scaleFactor *
      radiusPrimeVertical *
      (a +
        ((1 - tanSquared + c) * a ** 3) / 6 +
        ((5 - 18 * tanSquared + tanSquared ** 2 + 72 * c -
          58 * secondEccentricitySquared) *
          a ** 5) /
          120)

  const y =
    definition.falseNorthing +
    definition.scaleFactor *
      (m -
        mOrigin +
        radiusPrimeVertical *
          tanPhi *
          (a ** 2 / 2 +
            ((5 - tanSquared + 9 * c + 4 * c ** 2) * a ** 4) /
              24 +
            ((61 - 58 * tanSquared + tanSquared ** 2 + 600 * c -
              330 * secondEccentricitySquared) *
              a ** 6) /
              720))

  return { x, y }
}

function unprojectCoordinate(
  easting: number,
  northing: number,
  definition: TransverseMercatorDefinition,
): Coordinate2D {
  const phiOrigin = definition.latitudeOrigin * degreesToRadians
  const lambdaOrigin = definition.centralMeridian * degreesToRadians
  const mOrigin = meridionalArc(phiOrigin)
  const m =
    mOrigin +
    (northing - definition.falseNorthing) / definition.scaleFactor
  const e2 = eccentricitySquared
  const e4 = e2 * e2
  const e6 = e4 * e2
  const mu =
    m /
    (semiMajorAxis *
      (1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256))
  const e1 =
    (1 - Math.sqrt(1 - eccentricitySquared)) /
    (1 + Math.sqrt(1 - eccentricitySquared))
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) *
      Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu)

  const sinPhi1 = Math.sin(phi1)
  const cosPhi1 = Math.cos(phi1)
  const tanPhi1 = Math.tan(phi1)
  const c1 = secondEccentricitySquared * cosPhi1 * cosPhi1
  const t1 = tanPhi1 * tanPhi1
  const n1 =
    semiMajorAxis /
    Math.sqrt(1 - eccentricitySquared * sinPhi1 * sinPhi1)
  const r1 =
    (semiMajorAxis * (1 - eccentricitySquared)) /
    (1 - eccentricitySquared * sinPhi1 * sinPhi1) ** 1.5
  const d =
    (easting - definition.falseEasting) /
    (n1 * definition.scaleFactor)

  const latitude =
    phi1 -
    ((n1 * tanPhi1) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 -
          9 * secondEccentricitySquared) *
          d ** 4) /
          24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 -
          252 * secondEccentricitySquared - 3 * c1 ** 2) *
          d ** 6) /
          720)

  const longitude =
    lambdaOrigin +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 +
        8 * secondEccentricitySquared + 24 * t1 ** 2) *
        d ** 5) /
        120) /
      cosPhi1

  return {
    x: longitude * radiansToDegrees,
    y: latitude * radiansToDegrees,
  }
}

export function transformCoordinate(
  coordinate: Coordinate2D,
  source: CoordinateReferenceSystem,
  target: CoordinateReferenceSystem,
): Coordinate2D {
  if (!Number.isFinite(coordinate.x) || !Number.isFinite(coordinate.y)) {
    throw new Error("Both coordinate values must be valid numbers.")
  }

  if (source === target) {
    return { ...coordinate }
  }

  const geographic =
    source === "EPSG:4167"
      ? coordinate
      : unprojectCoordinate(coordinate.x, coordinate.y, projections[source])

  return target === "EPSG:4167"
    ? geographic
    : projectGeographic(geographic.x, geographic.y, projections[target])
}

export function getCoordinateSystem(
  id: CoordinateReferenceSystem,
) {
  return coordinateSystems.find((system) => system.id === id) ?? coordinateSystems[0]
}
