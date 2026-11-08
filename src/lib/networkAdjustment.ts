/**
 * Least-squares adjustment of a 3D total-station network.
 *
 * Observations are the raw total-station quantities:
 *   - horizontal angles (clockwise, backsight to foresight, measured at a station)
 *   - slope distances from station to target, with instrument and target heights
 *   - zenith angles from station to target, with instrument and target heights
 *
 * Unknowns are the easting, northing and elevation of every point, except for
 * components marked as fixed. Gauss–Newton iteration minimises
 * Σ (v_i / s_i)², where s_i is the a-priori standard deviation of observation i.
 * Partial derivatives are taken numerically so each observation model stays a
 * short, readable function.
 */

export type NetworkPoint = {
  id: string;
  easting: number;
  northing: number;
  /** Elevation in metres. */
  elevation: number;
  /** When true, easting and northing are held fixed. */
  fixedHorizontal: boolean;
  /** When true, elevation is held fixed. */
  fixedHeight: boolean;
};

export type InstrumentPrecision = {
  /** Constant distance error in metres, e.g. 0.001 for ±1 mm. */
  distanceConstantM: number;
  /** Distance error proportional to length, in parts per million. */
  distancePpm: number;
  /** Horizontal angle standard deviation in arc-seconds. */
  angleStdDevSec: number;
  /** Zenith angle standard deviation in arc-seconds. Defaults to angleStdDevSec. */
  zenithStdDevSec?: number;
};

export type AngleObservation = {
  kind: "angle";
  station: string;
  backsight: string;
  foresight: string;
  /** Clockwise horizontal angle in decimal degrees, 0 ≤ angle < 360. */
  angleDeg: number;
  /** Optional override of the instrument-derived standard deviation, in arc-seconds. */
  stdDevSec?: number;
};

export type SlopeObservation = {
  kind: "slope";
  from: string;
  to: string;
  /** Instrument height above the station mark, metres. */
  instrumentHeight: number;
  /** Target height above the target mark, metres. */
  targetHeight: number;
  /** Slope distance in metres. */
  slopeDistance: number;
  /** Optional override of the instrument-derived standard deviation, in metres. */
  stdDevM?: number;
};

export type ZenithObservation = {
  kind: "zenith";
  from: string;
  to: string;
  instrumentHeight: number;
  targetHeight: number;
  /** Zenith angle in decimal degrees, 0 < angle < 180. */
  zenithDeg: number;
  /** Optional override of the instrument-derived standard deviation, in arc-seconds. */
  stdDevSec?: number;
};

export type NetworkObservation =
  | AngleObservation
  | SlopeObservation
  | ZenithObservation;

export type AdjustmentOptions = {
  /** Maximum Gauss–Newton iterations. Default 25. */
  maxIterations?: number;
  /** Absolute standardised residual above which an observation is flagged. Default 3. */
  outlierThreshold?: number;
};

export type AdjustedPoint = NetworkPoint & {
  eastingStdDev: number;
  northingStdDev: number;
  elevationStdDev: number;
};

export type ObservationResult = {
  /** Index into the observation list passed to adjustNetwork. */
  index: number;
  kind: NetworkObservation["kind"];
  /** Residual v = observed − adjusted. Metres for slope distances, arc-seconds for angles. */
  residual: number;
  unit: "m" | "arcsec";
  /** A-priori standard deviation in the same unit as the residual. */
  stdDev: number;
  /** Standardised residual w = v / √Qvv. Null when the observation has no redundancy. */
  standardized: number | null;
  /** Partial redundancy r_i, between 0 and 1. The sum over all observations equals the degrees of freedom. */
  redundancy: number;
  flagged: boolean;
};

export type NetworkAdjustmentResult = {
  points: AdjustedPoint[];
  observations: ObservationResult[];
  iterations: number;
  observationCount: number;
  unknownCount: number;
  degreesOfFreedom: number;
  /** A-posteriori unit-weight standard deviation. Close to 1 when the precision values are realistic. */
  sigma0: number;
  flaggedCount: number;
  warnings: string[];
};

type Coord = { e: number; n: number; h: number };
type Component = "e" | "n" | "h";

type ResolvedObservation =
  | {
      kind: "angle";
      station: number;
      backsight: number;
      foresight: number;
      value: number;
      stdDev: number;
    }
  | {
      kind: "slope";
      from: number;
      to: number;
      instrumentHeight: number;
      targetHeight: number;
      value: number;
      stdDev: number;
    }
  | {
      kind: "zenith";
      from: number;
      to: number;
      instrumentHeight: number;
      targetHeight: number;
      value: number;
      stdDev: number;
    };

const TWO_PI = 2 * Math.PI;
const DEG = Math.PI / 180;
const ARCSEC = DEG / 3600;
const COORDINATE_STEP = 1e-3;
const CONVERGENCE_METRES = 1e-9;
const SINGULAR_RELATIVE_TOLERANCE = 1e-10;

const wrapTwoPi = (angle: number) => ((angle % TWO_PI) + TWO_PI) % TWO_PI;
const wrapPi = (angle: number) => wrapTwoPi(angle + Math.PI) - Math.PI;

function azimuth(from: Coord, to: Coord) {
  return Math.atan2(to.e - from.e, to.n - from.n);
}

function predict(observation: ResolvedObservation, coords: Coord[]): number {
  if (observation.kind === "angle") {
    const station = coords[observation.station];
    return wrapTwoPi(
      azimuth(station, coords[observation.foresight]) -
        azimuth(station, coords[observation.backsight]),
    );
  }
  const from = coords[observation.from];
  const to = coords[observation.to];
  const horizontal = Math.hypot(to.e - from.e, to.n - from.n);
  const verticalDifference =
    to.h + observation.targetHeight - (from.h + observation.instrumentHeight);
  if (observation.kind === "slope") {
    return Math.hypot(horizontal, verticalDifference);
  }
  return Math.atan2(horizontal, verticalDifference);
}

function residualOf(observation: ResolvedObservation, predicted: number) {
  const difference = observation.value - predicted;
  return observation.kind === "angle" ? wrapPi(difference) : difference;
}

function standardDeviationFor(
  observation: NetworkObservation,
  precision: InstrumentPrecision,
): number {
  if (observation.kind === "slope") {
    return (
      observation.stdDevM ??
      Math.hypot(
        precision.distanceConstantM,
        precision.distancePpm * 1e-6 * observation.slopeDistance,
      )
    );
  }
  if (observation.kind === "zenith") {
    return (
      (observation.stdDevSec ??
        precision.zenithStdDevSec ??
        precision.angleStdDevSec) * ARCSEC
    );
  }
  return (observation.stdDevSec ?? precision.angleStdDevSec) * ARCSEC;
}

function validateInput(
  points: NetworkPoint[],
  observations: NetworkObservation[],
  precision: InstrumentPrecision,
) {
  const indexById = new Map<string, number>();
  points.forEach((point, index) => {
    if (indexById.has(point.id)) {
      throw new Error(`Point "${point.id}" is defined more than once.`);
    }
    if (
      !Number.isFinite(point.easting) ||
      !Number.isFinite(point.northing) ||
      !Number.isFinite(point.elevation)
    ) {
      throw new Error(`Point "${point.id}" has invalid coordinates.`);
    }
    indexById.set(point.id, index);
  });

  const requirePoint = (id: string, role: string, position: number) => {
    const index = indexById.get(id);
    if (index === undefined) {
      throw new Error(
        `Observation ${position + 1} refers to unknown ${role} point "${id}".`,
      );
    }
    return index;
  };

  if (
    !(precision.distanceConstantM >= 0) ||
    !(precision.distancePpm >= 0) ||
    !(precision.angleStdDevSec > 0) ||
    (precision.zenithStdDevSec !== undefined && !(precision.zenithStdDevSec > 0))
  ) {
    throw new Error(
      "Instrument precision must be non-negative for distance and positive for angles.",
    );
  }

  observations.forEach((observation, position) => {
    if (observation.kind === "angle") {
      const station = requirePoint(observation.station, "station", position);
      const backsight = requirePoint(observation.backsight, "backsight", position);
      const foresight = requirePoint(observation.foresight, "foresight", position);
      if (station === backsight || station === foresight) {
        throw new Error(
          `Observation ${position + 1} uses the station as a sight point.`,
        );
      }
      if (!(observation.angleDeg >= 0 && observation.angleDeg < 360)) {
        throw new Error(
          `Observation ${position + 1} must have an angle from 0 up to 360 degrees.`,
        );
      }
    } else {
      const from = requirePoint(observation.from, "from", position);
      const to = requirePoint(observation.to, "to", position);
      if (from === to) {
        throw new Error(
          `Observation ${position + 1} connects a point to itself.`,
        );
      }
      if (
        !Number.isFinite(observation.instrumentHeight) ||
        !Number.isFinite(observation.targetHeight)
      ) {
        throw new Error(
          `Observation ${position + 1} needs instrument and target heights.`,
        );
      }
      if (observation.kind === "slope") {
        if (!(observation.slopeDistance > 0)) {
          throw new Error(
            `Observation ${position + 1} must have a slope distance greater than zero.`,
          );
        }
      } else if (!(observation.zenithDeg > 0 && observation.zenithDeg < 180)) {
        throw new Error(
          `Observation ${position + 1} must have a zenith angle between 0 and 180 degrees.`,
        );
      }
    }
    if (
      observation.kind === "slope"
        ? observation.stdDevM !== undefined && !(observation.stdDevM > 0)
        : observation.stdDevSec !== undefined && !(observation.stdDevSec > 0)
    ) {
      throw new Error(
        `Observation ${position + 1} must have a standard deviation greater than zero.`,
      );
    }
  });

  return indexById;
}

/** Inverts a symmetric positive-definite matrix with Gauss–Jordan elimination. */
function invert(matrix: number[][]): number[][] {
  const size = matrix.length;
  const scale = Math.max(1e-300, ...matrix.map((row, i) => Math.abs(row[i])));
  const augmented = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: size }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][column]) <= SINGULAR_RELATIVE_TOLERANCE * scale) {
      throw new Error(
        "The network is not fully determined. Check that every free coordinate is connected by observations to enough fixed points, and that a height datum is fixed.",
      );
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];

    const pivotValue = augmented[column][column];
    for (let j = 0; j < 2 * size; j++) augmented[column][j] /= pivotValue;

    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * size; j++) {
        augmented[row][j] -= factor * augmented[column][j];
      }
    }
  }

  return augmented.map((row) => row.slice(size));
}

export function adjustNetwork(
  points: NetworkPoint[],
  observations: NetworkObservation[],
  precision: InstrumentPrecision,
  options: AdjustmentOptions = {},
): NetworkAdjustmentResult {
  const maxIterations = options.maxIterations ?? 25;
  const outlierThreshold = options.outlierThreshold ?? 3;
  const indexById = validateInput(points, observations, precision);

  const fixedHorizontalCount = points.filter((p) => p.fixedHorizontal).length;
  if (fixedHorizontalCount < 2) {
    throw new Error(
      "At least two points with fixed easting and northing are needed. One fixed point cannot fix the rotation of the network.",
    );
  }
  if (!points.some((p) => p.fixedHeight)) {
    throw new Error(
      "At least one point with a fixed elevation is needed to define the height datum.",
    );
  }

  // Unknowns: every component that is not fixed, in point order.
  const unknowns: Array<{ point: number; component: Component }> = [];
  points.forEach((point, index) => {
    if (!point.fixedHorizontal) {
      unknowns.push({ point: index, component: "e" });
      unknowns.push({ point: index, component: "n" });
    }
    if (!point.fixedHeight) {
      unknowns.push({ point: index, component: "h" });
    }
  });
  const unknownCount = unknowns.length;
  if (unknownCount === 0) {
    throw new Error("Every coordinate is fixed, so there is nothing to adjust.");
  }

  const observationCount = observations.length;
  const degreesOfFreedom = observationCount - unknownCount;
  if (degreesOfFreedom <= 0) {
    throw new Error(
      `Not enough observations: ${observationCount} observations for ${unknownCount} unknowns. Add observations so there is at least one redundant measurement.`,
    );
  }

  const resolved: ResolvedObservation[] = observations.map((observation) => {
    const stdDev = standardDeviationFor(observation, precision);
    if (observation.kind === "angle") {
      return {
        kind: "angle",
        station: indexById.get(observation.station)!,
        backsight: indexById.get(observation.backsight)!,
        foresight: indexById.get(observation.foresight)!,
        value: observation.angleDeg * DEG,
        stdDev,
      };
    }
    const base = {
      from: indexById.get(observation.from)!,
      to: indexById.get(observation.to)!,
      instrumentHeight: observation.instrumentHeight,
      targetHeight: observation.targetHeight,
      stdDev,
    };
    if (observation.kind === "slope") {
      return { kind: "slope", ...base, value: observation.slopeDistance };
    }
    return { kind: "zenith", ...base, value: observation.zenithDeg * DEG };
  });

  const coords: Coord[] = points.map((point) => ({
    e: point.easting,
    n: point.northing,
    h: point.elevation,
  }));

  const predictAll = () => resolved.map((observation) => predict(observation, coords));

  /** Builds the design matrix A (observations × unknowns) and misclosure vector l = observed − predicted. */
  const linearize = () => {
    const predicted = predictAll();
    const misclosure = resolved.map((observation, i) =>
      residualOf(observation, predicted[i]),
    );
    const design: number[][] = resolved.map(() => new Array(unknownCount).fill(0));

    unknowns.forEach(({ point, component }, column) => {
      const original = coords[point][component];

      coords[point][component] = original + COORDINATE_STEP;
      const plus = predictAll();
      coords[point][component] = original - COORDINATE_STEP;
      const minus = predictAll();
      coords[point][component] = original;

      resolved.forEach((observation, i) => {
        const difference =
          observation.kind === "angle"
            ? wrapPi(plus[i] - minus[i])
            : plus[i] - minus[i];
        design[i][column] = difference / (2 * COORDINATE_STEP);
      });
    });

    return { design, misclosure };
  };

  const normalMatrix = (design: number[][]) => {
    const matrix = Array.from({ length: unknownCount }, () =>
      new Array(unknownCount).fill(0),
    );
    resolved.forEach((observation, i) => {
      const weight = 1 / (observation.stdDev * observation.stdDev);
      const row = design[i];
      for (let j = 0; j < unknownCount; j++) {
        if (row[j] === 0) continue;
        for (let k = 0; k < unknownCount; k++) {
          matrix[j][k] += row[j] * row[k] * weight;
        }
      }
    });
    return matrix;
  };

  let iterations = 0;
  let converged = false;
  while (iterations < maxIterations) {
    const { design, misclosure } = linearize();
    const cofactor = invert(normalMatrix(design));

    const rhs = new Array(unknownCount).fill(0);
    resolved.forEach((observation, i) => {
      const weight = 1 / (observation.stdDev * observation.stdDev);
      for (let j = 0; j < unknownCount; j++) {
        rhs[j] += design[i][j] * misclosure[i] * weight;
      }
    });

    const correction = cofactor.map((row) =>
      row.reduce((sum, value, k) => sum + value * rhs[k], 0),
    );

    unknowns.forEach(({ point, component }, column) => {
      coords[point][component] += correction[column];
    });

    iterations++;
    const largest = Math.max(...correction.map((value) => Math.abs(value)));
    if (largest < CONVERGENCE_METRES) {
      converged = true;
      break;
    }
  }

  if (!converged) {
    throw new Error(
      `The adjustment did not converge after ${maxIterations} iterations. Check the approximate coordinates and heights of the free points, and the observations for blunders.`,
    );
  }

  // Final pass at the adjusted coordinates: residuals and cofactor matrix.
  const { design, misclosure } = linearize();
  const cofactor = invert(normalMatrix(design));

  let weightedSquares = 0;
  resolved.forEach((observation, i) => {
    weightedSquares += (misclosure[i] / observation.stdDev) ** 2;
  });
  const sigma0 = Math.sqrt(weightedSquares / degreesOfFreedom);

  const warnings: string[] = [];
  if (sigma0 > 3) {
    warnings.push(
      `A-posteriori sigma0 is ${sigma0.toFixed(2)}, well above 1. The observations disagree more than the precision values predict. Check the instrument settings and look for blunders.`,
    );
  } else if (sigma0 < 0.3) {
    warnings.push(
      `A-posteriori sigma0 is ${sigma0.toFixed(2)}, well below 1. The precision values may be too pessimistic for this instrument.`,
    );
  }

  const observationResults: ObservationResult[] = resolved.map((observation, i) => {
    const row = design[i];
    let projected = 0;
    for (let j = 0; j < unknownCount; j++) {
      if (row[j] === 0) continue;
      for (let k = 0; k < unknownCount; k++) {
        projected += row[j] * cofactor[j][k] * row[k];
      }
    }
    const variance = observation.stdDev * observation.stdDev;
    const residualVariance = variance - projected;
    const redundancy = Math.min(1, Math.max(0, residualVariance / variance));
    const isCheckable = redundancy > 1e-6;
    const standardized = isCheckable
      ? misclosure[i] / Math.sqrt(residualVariance)
      : null;
    const isAngle = observation.kind !== "slope";
    const toUnit = isAngle ? 1 / ARCSEC : 1;

    return {
      index: i,
      kind: observation.kind,
      residual: misclosure[i] * toUnit,
      unit: isAngle ? "arcsec" : "m",
      stdDev: observation.stdDev * toUnit,
      standardized,
      redundancy,
      flagged:
        standardized !== null && Math.abs(standardized) > outlierThreshold,
    };
  });

  const stdDevOf = (pointIndex: number, component: Component) => {
    const column = unknowns.findIndex(
      (u) => u.point === pointIndex && u.component === component,
    );
    return column < 0 ? 0 : sigma0 * Math.sqrt(cofactor[column][column]);
  };

  const adjustedPoints: AdjustedPoint[] = points.map((point, pointIndex) => ({
    ...point,
    easting: coords[pointIndex].e,
    northing: coords[pointIndex].n,
    elevation: coords[pointIndex].h,
    eastingStdDev: stdDevOf(pointIndex, "e"),
    northingStdDev: stdDevOf(pointIndex, "n"),
    elevationStdDev: stdDevOf(pointIndex, "h"),
  }));

  return {
    points: adjustedPoints,
    observations: observationResults,
    iterations,
    observationCount,
    unknownCount,
    degreesOfFreedom,
    sigma0,
    flaggedCount: observationResults.filter((result) => result.flagged).length,
    warnings,
  };
}
