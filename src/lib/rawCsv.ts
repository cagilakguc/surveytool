/**
 * CSV reader and writers for raw total-station measurements.
 *
 * Input: one row per observed reading with a header line. Columns are matched
 * by name (case-insensitive, several aliases accepted):
 *   setup, target, hz, vz, sd, hi, ht        required
 *   face                                      optional: 1 or 2 (derived from vz when absent)
 *   ppm                                       optional atmospheric correction
 * Values are the observed instrument readings: Hz and V in gon, slope distance
 * in metres. Face II rows are reduced to face I exactly as in the Starnet reader.
 * Delimiter is comma or semicolon (semicolon files may use decimal commas).
 */

import { averageReadings, reduceFaceTwo } from "./starnetRaw";
import type { RawPair, RawQc, RawReading, RawTraverse } from "./starnetRaw";

// Header names are matched after trimming and lower-casing. Turkish names are
// ASCII-only so that case conversion behaves the same everywhere.
const COLUMN_ALIASES = {
  setup: ["setup", "station", "stn", "from", "istasyon", "kurulum"],
  target: ["target", "point", "to", "prism", "hedef", "nokta"],
  face: ["face", "fc", "yuz"],
  hz: ["hz", "hz_gon", "horizontal", "yatay_aci"],
  vz: ["vz", "v", "v_gon", "zenith", "vz_gon", "dusey_aci"],
  sd: ["sd", "sd_m", "distance", "slope_distance", "mesafe", "egik_mesafe"],
  hi: ["hi", "hi_m", "instrument_height", "alet_yuksekligi"],
  ht: ["ht", "ht_m", "target_height", "prism_height", "hedef_yuksekligi"],
  ppm: ["ppm", "atmos_ppm"],
} as const;

type ColumnKey = keyof typeof COLUMN_ALIASES;
const REQUIRED: ColumnKey[] = ["setup", "target", "hz", "vz", "sd", "hi", "ht"];

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normaliseHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseNumber(value: string | undefined, decimalComma: boolean): number {
  if (value === undefined || value === "") return NaN;
  const text = decimalComma ? value.replace(",", ".") : value;
  return Number(text);
}

function parseFace(value: string | undefined): 1 | 2 | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (/^(1|i|f1|face ?1)$/.test(text)) return 1;
  if (/^(2|ii|f2|face ?2)$/.test(text)) return 2;
  return null;
}

/** Parses a raw measurement CSV. Throws when required columns are missing. */
export function parseRawCsv(text: string): RawTraverse {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() !== "");
  if (headerIndex < 0) throw new Error("The CSV file is empty.");

  const delimiter = lines[headerIndex].includes(";") && !lines[headerIndex].includes(",") ? ";" : ",";
  const decimalComma = delimiter === ";";
  const headers = splitCsvLine(lines[headerIndex], delimiter).map(normaliseHeader);

  const columns = {} as Partial<Record<ColumnKey, number>>;
  for (const key of Object.keys(COLUMN_ALIASES) as ColumnKey[]) {
    const index = headers.findIndex((header) => (COLUMN_ALIASES[key] as readonly string[]).includes(header));
    if (index >= 0) columns[key] = index;
  }
  const missing = REQUIRED.filter((key) => columns[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`The CSV header is missing required column(s): ${missing.join(", ")}.`);
  }

  const qc: RawQc = {
    job: "",
    readingCount: 0,
    headerCorrectionAnomalies: [],
    skippedLines: [],
    unpairedFaces: [],
  };
  const readings: RawReading[] = [];
  const cell = (cells: string[], key: ColumnKey) => {
    const index = columns[key];
    return index === undefined ? undefined : cells[index];
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (index <= headerIndex || !line.trim()) return;

    const cells = splitCsvLine(line, delimiter);
    const setup = cell(cells, "setup") ?? "";
    const target = (cell(cells, "target") ?? "").split(/\s+/).join(" ");
    const hzRaw = parseNumber(cell(cells, "hz"), decimalComma);
    const vzRaw = parseNumber(cell(cells, "vz"), decimalComma);
    const sd = parseNumber(cell(cells, "sd"), decimalComma);
    const hi = parseNumber(cell(cells, "hi"), decimalComma);
    const ht = parseNumber(cell(cells, "ht"), decimalComma);
    const ppmValue = parseNumber(cell(cells, "ppm"), decimalComma);

    if (!setup || !target) {
      qc.skippedLines.push({ lineNumber, text: "setup or target is empty" });
      return;
    }
    if (![hzRaw, vzRaw, sd, hi, ht].every(Number.isFinite)) {
      qc.skippedLines.push({ lineNumber, text: "a required value is missing or not a number" });
      return;
    }
    if (hzRaw < 0 || hzRaw >= 400 || vzRaw <= 0 || vzRaw >= 400 || sd <= 0) {
      qc.skippedLines.push({ lineNumber, text: "value outside the expected range (Hz 0–400 gon, V 0–400 gon, SD > 0)" });
      return;
    }

    const faceCell = cell(cells, "face");
    const face = faceCell !== undefined && faceCell !== "" ? parseFace(faceCell) : vzRaw < 200 ? 1 : 2;
    if (face === null) {
      qc.skippedLines.push({ lineNumber, text: `unrecognised face value "${faceCell}"` });
      return;
    }

    const reduced = face === 2 ? reduceFaceTwo(hzRaw, vzRaw) : { hz: hzRaw, vz: vzRaw };
    readings.push({
      setup,
      target,
      hz: reduced.hz,
      vz: reduced.vz,
      sd,
      hi,
      ht,
      face,
      ppm: Number.isFinite(ppmValue) ? ppmValue : null,
      lineNumber,
    });
  });

  qc.readingCount = readings.length;
  const pairs: RawPair[] = averageReadings(readings, qc);
  return { readings, pairs, qc };
}

function csvValue(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header: string[], rows: Array<Array<string | number>>) {
  return [header, ...rows].map((row) => row.map(csvValue).join(",")).join("\n") + "\n";
}

/** Face I equivalent readings, one row per observation. */
export function readingsToCsv(readings: RawReading[]): string {
  return toCsv(
    ["setup", "target", "face", "hz_gon_face1", "vz_gon_face1", "sd_m", "hi_m", "ht_m", "ppm", "source_line"],
    readings.map((r) => [
      r.setup,
      r.target,
      r.face,
      r.hz.toFixed(5),
      r.vz.toFixed(5),
      r.sd.toFixed(4),
      r.hi.toFixed(3),
      r.ht.toFixed(3),
      r.ppm ?? "",
      r.lineNumber,
    ]),
  );
}

/** Averaged setup-to-target pairs, the values used in the adjustment. */
export function pairsToCsv(pairs: RawPair[]): string {
  return toCsv(
    ["setup", "target", "count", "hz_gon", "vz_gon", "sd_m", "hi_m", "ht_m", "hz_spread_mgon", "sd_spread_mm"],
    pairs.map((p) => [
      p.setup,
      p.target,
      p.count,
      p.hz.toFixed(5),
      p.vz.toFixed(5),
      p.sd.toFixed(4),
      p.hi.toFixed(3),
      p.ht.toFixed(3),
      p.hzSpreadMgon.toFixed(2),
      p.sdSpreadMm.toFixed(2),
    ]),
  );
}
