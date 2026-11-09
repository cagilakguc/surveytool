/**
 * Turns parsed Starnet raw data into adjustment and closure inputs.
 *
 * Point names are normalised through an alias table, so that the same physical
 * point observed under two names (for example TRAV69A and TRAV69) is treated as
 * one point. Setups listed as excluded are ignored completely.
 */

import type {
  AngleObservation,
  InstrumentPrecision,
  NetworkObservation,
  NetworkPoint,
  SlopeObservation,
  ZenithObservation,
} from "./networkAdjustment";
import type { TraverseClosureInput, TraverseStation } from "./traverseClosure";
import { gonToDegrees, type RawPair, type RawTraverse } from "./starnetRaw";

export type BuildOptions = {
  /** Raw name → canonical name. */
  aliases: Map<string, string>;
  /** Setup names to ignore, as written in the raw file. */
  excludedSetups: Set<string>;
  coordinates: NetworkPoint[];
  precision: InstrumentPrecision;
};

export type BuiltNetwork = {
  points: NetworkPoint[];
  observations: NetworkObservation[];
  /** Setups and targets that were dropped, with the reason. */
  dropped: string[];
  warnings: string[];
};

const canonical = (name: string, aliases: Map<string, string>) =>
  aliases.get(name) ?? name;

/** Parses lines such as "TRAV69A = TRAV69" or "TRAV69A,TRAV69". */
export function parseAliases(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/[=,;\t]/).map((part) => part.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Alias line "${line}" must look like "RAW_NAME = NAME".`);
    }
    map.set(parts[0], parts[1]);
  }
  return map;
}

/**
 * Parses a coordinate table: id, easting, northing, elevation, fixed.
 * The fixed column is blank (free), "XY" (horizontal fixed), "Z" (height fixed)
 * or "XYZ" (all fixed). A header line is allowed.
 */
export function parseCoordinateTable(text: string): NetworkPoint[] {
  const points: NetworkPoint[] = [];
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  lines.forEach((raw, index) => {
    const parts = raw.split(/[,;\t]/).map((part) => part.trim());
    if (index === 0 && isNaN(Number(parts[1]))) return; // header
    if (parts.length < 4) {
      throw new Error(`Coordinate line ${index + 1} needs id, easting, northing and elevation.`);
    }
    const [id, e, n, h, fixed = ""] = parts;
    const easting = Number(e);
    const northing = Number(n);
    const elevation = Number(h);
    if (!id || !Number.isFinite(easting) || !Number.isFinite(northing) || !Number.isFinite(elevation)) {
      throw new Error(`Coordinate line ${index + 1} has an invalid id or value.`);
    }
    const flag = fixed.toUpperCase();
    points.push({
      id,
      easting,
      northing,
      elevation,
      fixedHorizontal: flag.includes("X") || flag.includes("Y"),
      fixedHeight: flag.includes("Z"),
    });
  });
  return points;
}

/** Keeps only the setups and targets that have coordinates; reports the rest. */
export function buildNetworkInput(raw: RawTraverse, options: BuildOptions): BuiltNetwork {
  const { aliases, excludedSetups, coordinates } = options;
  const known = new Set(coordinates.map((p) => p.id));
  const dropped: string[] = [];
  const warnings: string[] = [];

  // The coordinate table defines the points. Raw names are mapped onto these
  // canonical names through the alias table before observations are used.
  const points: NetworkPoint[] = coordinates.map((p) => ({ ...p }));

  const pairs = raw.pairs.filter((pair) => {
    if (excludedSetups.has(pair.setup)) {
      dropped.push(`setup ${pair.setup} excluded by user`);
      return false;
    }
    return true;
  });

  const bySetup = new Map<string, RawPair[]>();
  for (const pair of pairs) {
    const setup = canonical(pair.setup, aliases);
    const target = canonical(pair.target, aliases);
    if (setup === target) continue;
    const normalised = { ...pair, setup, target };
    const list = bySetup.get(setup);
    if (list) list.push(normalised);
    else bySetup.set(setup, [normalised]);
  }

  const observations: NetworkObservation[] = [];
  for (const [setup, targets] of bySetup) {
    if (!known.has(setup)) {
      dropped.push(`setup ${setup} has no coordinates`);
      continue;
    }
    // Keep only targets that have coordinates, and drop duplicates per target.
    const usable = new Map<string, RawPair>();
    for (const pair of targets) {
      if (!known.has(pair.target)) {
        dropped.push(`target ${pair.target} from ${setup} has no coordinates`);
        continue;
      }
      if (!usable.has(pair.target)) usable.set(pair.target, pair);
    }
    const list = [...usable.values()];

    for (const pair of list) {
      const slope: SlopeObservation = {
        kind: "slope",
        from: setup,
        to: pair.target,
        instrumentHeight: pair.hi,
        targetHeight: pair.ht,
        slopeDistance: pair.sd,
      };
      const zenith: ZenithObservation = {
        kind: "zenith",
        from: setup,
        to: pair.target,
        instrumentHeight: pair.hi,
        targetHeight: pair.ht,
        zenithDeg: gonToDegrees(pair.vz),
      };
      observations.push(slope, zenith);
    }

    // Horizontal angles between every pair of targets in the setup.
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const angleGon = (((list[j].hz - list[i].hz) % 400) + 400) % 400;
        const angle: AngleObservation = {
          kind: "angle",
          station: setup,
          backsight: list[i].target,
          foresight: list[j].target,
          angleDeg: gonToDegrees(angleGon),
        };
        observations.push(angle);
      }
    }
  }

  // Every point used in an observation must have coordinates (already checked),
  // so the point list is the coordinate table itself.
  if (observations.length === 0) {
    warnings.push("No observations matched the coordinate table. Check the point names and aliases.");
  }
  return { points, observations, dropped, warnings };
}

export type ClosureOptions = {
  /** Ordered traverse: start station, intermediate stations, end station. */
  sequence: string[];
  startBacksight: string;
  endBacksight: string;
  /** Setups and their observations are taken from the same options as the network build. */
  angleStdDevSec: number;
  minimumPrecisionDenominator?: number;
};

/**
 * Builds the traverse closure input from the observed directions and distances
 * of the listed stations. Stations must be observed in sequence: each one sees
 * the previous and the next station.
 */
export function buildClosureInput(
  raw: RawTraverse,
  options: BuildOptions,
  closure: ClosureOptions,
): TraverseClosureInput {
  const { aliases, excludedSetups, coordinates } = options;
  const { sequence, startBacksight, endBacksight } = closure;
  if (sequence.length < 3) {
    throw new Error("A traverse needs at least three stations: start, one intermediate and end.");
  }
  const point = (name: string) => {
    const found = coordinates.find((p) => p.id === name);
    if (!found) throw new Error(`Traverse point "${name}" has no coordinates.`);
    return found;
  };
  const names = sequence.map((name) => canonical(name, aliases));

  // Directions and distances observed from each traverse station.
  const pairsFrom = (station: string) =>
    raw.pairs.filter(
      (pair) =>
        !excludedSetups.has(pair.setup) &&
        canonical(pair.setup, aliases) === station,
    );
  const find = (station: string, target: string): RawPair => {
    const pair = pairsFrom(station).find(
      (p) => canonical(p.target, aliases) === target,
    );
    if (!pair) {
      throw new Error(`Traverse needs an observation from ${station} to ${target}.`);
    }
    return pair;
  };

  const stations: TraverseStation[] = [];
  for (let i = 0; i < names.length - 1; i++) {
    const station = names[i];
    const next = names[i + 1];
    const previous = i === 0 ? canonical(startBacksight, aliases) : names[i - 1];
    const toPrevious = find(station, previous);
    const toNext = find(station, next);
    // Clockwise from the backsight (previous) to the forward station (next).
    const angleGon = (((toNext.hz - toPrevious.hz) % 400) + 400) % 400;
    const horizontal = toNext.sd * Math.sin((toNext.vz * Math.PI) / 200);
    stations.push({ angleDeg: gonToDegrees(angleGon), distance: Math.abs(horizontal) });
  }

  // Angle at the end station, from the last traverse station to the end backsight.
  const endName = names[names.length - 1];
  const endBack = canonical(endBacksight, aliases);
  const last = names[names.length - 2];
  const atEndToBack = find(endName, endBack);
  const atEndToLast = find(endName, last);
  const endAngleGon = (((atEndToBack.hz - atEndToLast.hz) % 400) + 400) % 400;

  const startPoint = point(names[0]);
  const backsightPoint = point(canonical(startBacksight, aliases));
  return {
    start: { e: startPoint.easting, n: startPoint.northing },
    startBacksight: { e: backsightPoint.easting, n: backsightPoint.northing },
    stations,
    end: { e: point(endName).easting, n: point(endName).northing },
    endBacksight: { e: point(endBack).easting, n: point(endBack).northing },
    endAngleDeg: gonToDegrees(endAngleGon),
    angleStdDevSec: closure.angleStdDevSec,
    minimumPrecisionDenominator: closure.minimumPrecisionDenominator,
  };
}
