/**
 * Reader for Leica / Starnet raw traverse text exports.
 *
 * The export lists one setup per "DB" line, followed by "DM" measurement lines:
 *   DM  <target>  <Hz>  <slope distance>  <zenith>  <HI>/<HT>
 * Angles are in gon (400 per circle). Face II readings (zenith above 200 gon)
 * are reduced to face I: Hz is moved by 200 gon and the zenith becomes 400 − V.
 */

export type RawReading = {
  setup: string;
  target: string;
  /** Face I equivalent horizontal direction, gon. */
  hz: number;
  /** Face I equivalent zenith angle, gon. */
  vz: number;
  /** Slope distance, metres. */
  sd: number;
  hi: number;
  ht: number;
  face: 1 | 2;
  /** Atmospheric ppm from the most recent header, if present. */
  ppm: number | null;
  lineNumber: number;
};

export type RawQc = {
  job: string;
  readingCount: number;
  /** Header lines that contain a correction equal to 1.00 instead of a ppm value. */
  headerCorrectionAnomalies: Array<{ lineNumber: number; text: string }>;
  /** Lines that were not recognised as setup, measurement, header or end markers. */
  skippedLines: Array<{ lineNumber: number; text: string }>;
  /** Setup and target pairs where the number of face I and face II readings differ. */
  unpairedFaces: Array<{ setup: string; target: string; face1: number; face2: number }>;
};

export type RawPair = {
  setup: string;
  target: string;
  count: number;
  /** Mean horizontal direction, face I equivalent, gon. */
  hz: number;
  /** Mean zenith angle, gon. */
  vz: number;
  /** Mean slope distance, metres. */
  sd: number;
  hi: number;
  ht: number;
  /** Largest deviation of a single reading from the mean, milligon. */
  hzSpreadMgon: number;
  /** Range of slope distances in the pair, millimetres. */
  sdSpreadMm: number;
};

export type RawTraverse = {
  readings: RawReading[];
  pairs: RawPair[];
  qc: RawQc;
};

const DM_RE =
  /^DM\s+(?<target>.+?)\s+(?<hz>\d+\.\d+)\s+(?<sd>\d+\.\d+)\s+(?<vz>\d+\.\d+)\s+(?<hi>\d+\.\d+)\/(?<ht>\d+\.\d+)/;
const DB_RE = /^DB\s+(?<setup>.+?)\s*$/;
const JOB_RE = /^#\s*Job:\s*(?<job>.+?)\s{2,}Date:/;
const ATMOS_RE = /Atmos(?:pheric Correction \(ppm\):|\s+ppm =)\s*(?<ppm>-?\d+(?:\.\d+)?)/;
const ONE_RE = /Correction.*\b1\.00\b/;

const GON_TO_DEG = 0.9;

/** Reduces a face II observation to its face I equivalent (gon). */
export function reduceFaceTwo(hz: number, vz: number) {
  return { hz: (((hz - 200) % 400) + 400) % 400, vz: 400 - vz };
}

/** Mean of directions in gon, handling the 0/400 wrap. */
export function circularMeanGon(values: number[]): number {
  const reference = values[0];
  const deltas = values.map((value) => ((value - reference + 200) % 400 + 400) % 400 - 200);
  const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  return (((reference + mean) % 400) + 400) % 400;
}

export function parseStarnetRaw(text: string): RawTraverse {
  const qc: RawQc = {
    job: "",
    readingCount: 0,
    headerCorrectionAnomalies: [],
    skippedLines: [],
    unpairedFaces: [],
  };
  const readings: RawReading[] = [];
  let setup: string | null = null;
  let ppm: number | null = null;

  text.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    if (!line.trim()) return;

    const job = JOB_RE.exec(line);
    if (job?.groups) {
      qc.job = job.groups.job.trim();
      return;
    }

    if (line.startsWith("#")) {
      const atmos = ATMOS_RE.exec(line);
      if (atmos?.groups) ppm = Number(atmos.groups.ppm);
      if (ONE_RE.test(line)) {
        qc.headerCorrectionAnomalies.push({ lineNumber, text: line.trim() });
      }
      return;
    }

    const db = DB_RE.exec(line);
    if (db?.groups) {
      setup = db.groups.setup;
      return;
    }

    const dm = DM_RE.exec(line);
    if (dm?.groups) {
      if (setup === null) {
        qc.skippedLines.push({ lineNumber, text: "measurement before any setup line" });
        return;
      }
      const hzRaw = Number(dm.groups.hz);
      const vzRaw = Number(dm.groups.vz);
      const face: 1 | 2 = vzRaw < 200 ? 1 : 2;
      const reduced = face === 2 ? reduceFaceTwo(hzRaw, vzRaw) : { hz: hzRaw, vz: vzRaw };
      readings.push({
        setup,
        target: dm.groups.target.trim().split(/\s+/).join(" "),
        hz: reduced.hz,
        vz: reduced.vz,
        sd: Number(dm.groups.sd),
        hi: Number(dm.groups.hi),
        ht: Number(dm.groups.ht),
        face,
        ppm,
        lineNumber,
      });
      return;
    }

    if (line.startsWith("DE")) return;
    qc.skippedLines.push({ lineNumber, text: line.slice(0, 80) });
  });

  qc.readingCount = readings.length;
  const pairs = averageReadings(readings, qc);
  return { readings, pairs, qc };
}

/** Groups face I and face II readings per setup, target and heights, and averages them. */
export function averageReadings(readings: RawReading[], qc: RawQc): RawPair[] {
  const groups = new Map<string, RawReading[]>();
  for (const reading of readings) {
    const key = `${reading.setup}\u0000${reading.target}\u0000${reading.hi}\u0000${reading.ht}`;
    const list = groups.get(key);
    if (list) list.push(reading);
    else groups.set(key, [reading]);
  }

  const pairs: RawPair[] = [];
  for (const items of groups.values()) {
    const { setup, target, hi, ht } = items[0];
    const face1 = items.filter((r) => r.face === 1).length;
    const face2 = items.length - face1;
    if (face1 !== face2) {
      qc.unpairedFaces.push({ setup, target, face1, face2 });
    }
    const hzValues = items.map((r) => r.hz);
    const hz = circularMeanGon(hzValues);
    const hzDeviations = hzValues.map((v) => ((v - hz + 200) % 400 + 400) % 400 - 200);
    const sdValues = items.map((r) => r.sd);
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    pairs.push({
      setup,
      target,
      count: items.length,
      hz,
      vz: mean(items.map((r) => r.vz)),
      sd: mean(sdValues),
      hi,
      ht,
      hzSpreadMgon: (Math.max(...hzDeviations) - Math.min(...hzDeviations)) * 1000,
      sdSpreadMm: (Math.max(...sdValues) - Math.min(...sdValues)) * 1000,
    });
  }
  return pairs;
}

/** Converts a gon angle to degrees. */
export const gonToDegrees = (gon: number) => gon * GON_TO_DEG;
