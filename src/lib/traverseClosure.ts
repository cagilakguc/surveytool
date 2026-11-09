/**
 * Closed-loop check for a traverse between two known stations.
 *
 * The traverse starts at a known station S0 with a known backsight B0 and
 * ends at a known station Sn with a known backsight Bn. Each station i has a
 * measured clockwise horizontal angle from its backsight to its forward station,
 * and a measured horizontal distance to the forward station.
 *
 * The check reports the angular misclosure, the linear misclosure of the
 * computed end station, and the relative precision 1 : perimeter / misclosure.
 */

export type Coordinate = { e: number; n: number };

export type TraverseStation = {
  /** Clockwise horizontal angle measured at this station, from the backsight to the forward station, in degrees. */
  angleDeg: number;
  /** Horizontal distance from this station to the next station, in metres. */
  distance: number;
};

export type TraverseClosureInput = {
  /** Known start station. */
  start: Coordinate;
  /** Known backsight from the start station. */
  startBacksight: Coordinate;
  /** Stations 0 … n−1. Station 0 is the start; each one is followed by its forward station. */
  stations: TraverseStation[];
  /** Known end station, equal to the forward station of the last traverse station. */
  end: Coordinate;
  /** Known backsight from the end station, back toward the last traverse station. */
  endBacksight: Coordinate;
  /** Clockwise angle measured at the end station, from the last traverse station to endBacksight, in degrees. */
  endAngleDeg: number;
  /** Angle standard deviation of the instrument, in arc-seconds. */
  angleStdDevSec: number;
  /** Minimum acceptable relative precision denominator, e.g. 5000 for 1:5000. Default 5000. */
  minimumPrecisionDenominator?: number;
};

export type TraverseClosureResult = {
  /** Number of traverse legs (equal to the number of stations). */
  legCount: number;
  /** Computed end station coordinates before the misclosure is applied. */
  computedEnd: Coordinate;
  /** Linear misclosure components, metres. Computed minus known. */
  misclosureEasting: number;
  misclosureNorthing: number;
  /** Linear misclosure magnitude, metres. */
  linearMisclosure: number;
  /** Sum of traverse distances, metres. */
  perimeter: number;
  /** Relative precision denominator: perimeter / linear misclosure. Infinity when the misclosure is zero. */
  precisionDenominator: number;
  /** Angular misclosure in arc-seconds. Computed minus known azimuth at the end backsight. */
  angularMisclosureSec: number;
  /** Maximum allowed angular misclosure in arc-seconds: 3σ√n. */
  angularToleranceSec: number;
  /** Set when the angular misclosure exceeds the tolerance. */
  angularWarning: boolean;
  /** Set when the relative precision is below the minimum denominator. */
  precisionWarning: boolean;
  warnings: string[];
};

const TWO_PI = 2 * Math.PI;
const DEG = Math.PI / 180;
const ARCSEC = DEG / 3600;

const wrapTwoPi = (angle: number) => ((angle % TWO_PI) + TWO_PI) % TWO_PI;
const wrapPi = (angle: number) => wrapTwoPi(angle + Math.PI) - Math.PI;

function azimuth(from: Coordinate, to: Coordinate) {
  return Math.atan2(to.e - from.e, to.n - from.n);
}

export function checkTraverseClosure(
  input: TraverseClosureInput,
): TraverseClosureResult {
  const { stations } = input;
  if (stations.length < 2) {
    throw new Error("A traverse needs at least two stations to be checked.");
  }
  stations.forEach((station, index) => {
    if (!(station.angleDeg >= 0 && station.angleDeg < 360)) {
      throw new Error(`Traverse station ${index + 1} must have an angle from 0 up to 360 degrees.`);
    }
    if (!(station.distance > 0)) {
      throw new Error(`Traverse station ${index + 1} must have a distance greater than zero.`);
    }
  });
  if (!(input.endAngleDeg >= 0 && input.endAngleDeg < 360)) {
    throw new Error("The end angle must be from 0 up to 360 degrees.");
  }
  if (!(input.angleStdDevSec > 0)) {
    throw new Error("The angle standard deviation must be greater than zero.");
  }

  const minimumDenominator = input.minimumPrecisionDenominator ?? 5000;

  // Forward azimuths: start from the first backsight, then each station turns from
  // its backsight (the reverse of the previous leg) by the measured angle.
  let azimuthOfLeg = wrapTwoPi(
    azimuth(input.start, input.startBacksight) + stations[0].angleDeg * DEG,
  );
  let current = { ...input.start };
  let perimeter = 0;

  stations.forEach((station, index) => {
    if (index > 0) {
      // Backsight from this station points back along the previous leg.
      azimuthOfLeg = wrapTwoPi(azimuthOfLeg + Math.PI + station.angleDeg * DEG);
    }
    current = {
      e: current.e + station.distance * Math.sin(azimuthOfLeg),
      n: current.n + station.distance * Math.cos(azimuthOfLeg),
    };
    perimeter += station.distance;
  });

  const computedEnd = current;
  const misclosureEasting = computedEnd.e - input.end.e;
  const misclosureNorthing = computedEnd.n - input.end.n;
  const linearMisclosure = Math.hypot(misclosureEasting, misclosureNorthing);
  // Below a nanometre the misclosure is floating-point noise, not a real error.
  const precisionDenominator =
    linearMisclosure < 1e-9 ? Infinity : perimeter / linearMisclosure;

  // Angular check at the end station: the computed direction from the last
  // traverse station is turned by the end angle and compared with the known
  // direction from the end station back to the end backsight.
  const computedBacksightAzimuth = wrapTwoPi(
    azimuthOfLeg + Math.PI + input.endAngleDeg * DEG,
  );
  const knownBacksightAzimuth = azimuth(input.end, input.endBacksight);
  const angularMisclosureRad = wrapPi(computedBacksightAzimuth - knownBacksightAzimuth);
  const angularMisclosureSec = angularMisclosureRad / ARCSEC;
  const angularToleranceSec = 3 * input.angleStdDevSec * Math.sqrt(stations.length + 1);

  const angularWarning = Math.abs(angularMisclosureSec) > angularToleranceSec;
  const precisionWarning = precisionDenominator < minimumDenominator;

  const warnings: string[] = [];
  if (angularWarning) {
    warnings.push(
      `Angular misclosure is ${angularMisclosureSec.toFixed(1)} arc-seconds, above the ${angularToleranceSec.toFixed(1)} arc-second tolerance. Check the angles and the backsight at the start and end stations.`,
    );
  }
  if (precisionWarning) {
    warnings.push(
      `Linear misclosure is ${linearMisclosure.toFixed(4)} m over ${perimeter.toFixed(1)} m, precision 1:${Math.round(precisionDenominator)}, below the required 1:${minimumDenominator}.`,
    );
  }

  return {
    legCount: stations.length,
    computedEnd,
    misclosureEasting,
    misclosureNorthing,
    linearMisclosure,
    perimeter,
    precisionDenominator,
    angularMisclosureSec,
    angularToleranceSec,
    angularWarning,
    precisionWarning,
    warnings,
  };
}
