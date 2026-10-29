import type { LandXmlSurface, PlanPoint } from "./landxml";
import type { SurveyPoint, SurveyPointLayer } from "./surveyPoints";
import type { MapCrs } from "./mapCoordinates";
import { createGlobalCoordinateTransform } from "./globalGis";

export const maximumCheckPoints = 250_000;
export const maximumCheckFaces = 500_000;
export type CheckStatus =
  | "PASS"
  | "HIGH"
  | "LOW"
  | "OUTSIDE"
  | "NO_DESIGN_LEVEL"
  | "AMBIGUOUS"
  | "INVALID";
export const statusColours: Record<CheckStatus, string> = {
  PASS: "#34d399",
  HIGH: "#fb7185",
  LOW: "#60a5fa",
  OUTSIDE: "#94a3b8",
  NO_DESIGN_LEVEL: "#fbbf24",
  AMBIGUOUS: "#c084fc",
  INVALID: "#f97316",
};
export type CheckInput = {
  id: string;
  layer: SurveyPointLayer;
  sourceCrs: string;
  heightUnit: string;
};
export type CheckRow = SurveyPoint & {
  file: string;
  sourceEasting: number;
  sourceNorthing: number;
  measuredLevelM: number;
  designLevelM: number | null;
  differenceMm: number | null;
  status: CheckStatus;
};
export type CheckResult = {
  rows: CheckRow[];
  counts: Record<CheckStatus, number>;
  warnings: string[];
  minimumMm: number | null;
  maximumMm: number | null;
  meanMm: number | null;
  rmsMm: number | null;
};
export type CheckRequest = {
  surface: LandXmlSurface;
  inputs: CheckInput[];
  catalogue: MapCrs[];
  designCrs: string;
  designHeightScale: number;
  heightScales: Record<string, number>;
  lowerMm: number;
  upperMm: number;
};

type Triangle = {
  a: PlanPoint;
  bx: number;
  by: number;
  cx: number;
  cy: number;
  denominator: number;
  b: PlanPoint;
  c: PlanPoint;
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
};
export function createTinSampler(surface: LandXmlSurface) {
  if (surface.hasBoundaryDefinitions && !surface.excludedFaces)
    throw new Error(
      "This surface contains boundary instructions without excluded TIN faces. Clip the TIN or export its visible triangles before checking; boundary-only polygons are not applied automatically.",
    );
  if (surface.faces.length > maximumCheckFaces)
    throw new Error(
      `Clip or simplify the design TIN to ${maximumCheckFaces.toLocaleString()} faces or fewer before checking.`,
    );
  const triangles: Triangle[] = [];
  let rejectedFaces = 0,
    minE = Infinity,
    maxE = -Infinity,
    minN = Infinity,
    maxN = -Infinity;
  for (const face of surface.faces) {
    const [a, b, c] = face.map((id) => surface.points[id]);
    if (
      ![a, b, c].every(
        (p) => p && Number.isFinite(p.easting) && Number.isFinite(p.northing),
      )
    ) {
      rejectedFaces++;
      continue;
    }
    const bx = b.easting - a.easting,
      by = b.northing - a.northing,
      cx = c.easting - a.easting,
      cy = c.northing - a.northing;
    const denominator = bx * cy - by * cx;
    if (
      Math.abs(denominator) <=
      Math.max(bx * bx + by * by, cx * cx + cy * cy, 1) * 1e-12
    ) {
      rejectedFaces++;
      continue;
    }
    const t = {
      a,
      b,
      c,
      bx,
      by,
      cx,
      cy,
      denominator,
      minE: Math.min(a.easting, b.easting, c.easting),
      maxE: Math.max(a.easting, b.easting, c.easting),
      minN: Math.min(a.northing, b.northing, c.northing),
      maxN: Math.max(a.northing, b.northing, c.northing),
    };
    triangles.push(t);
    minE = Math.min(minE, t.minE);
    maxE = Math.max(maxE, t.maxE);
    minN = Math.min(minN, t.minN);
    maxN = Math.max(maxN, t.maxN);
  }
  if (!triangles.length)
    throw new Error("The selected surface has no usable TIN triangles.");
  const size = Math.max(
    1,
    Math.min(256, Math.ceil(Math.sqrt(triangles.length / 12))),
  );
  const dx = Math.max(maxE - minE, 1e-9) / size,
    dy = Math.max(maxN - minN, 1e-9) / size;
  const cell = (x: number, min: number, step: number) =>
    Math.max(0, Math.min(size - 1, Math.floor((x - min) / step)));
  const buckets = new Map<number, number[]>(),
    wide: number[] = [];
  let references = 0;
  triangles.forEach((t, index) => {
    const x0 = cell(t.minE, minE, dx),
      x1 = cell(t.maxE, minE, dx),
      y0 = cell(t.minN, minN, dy),
      y1 = cell(t.maxN, minN, dy);
    const count = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (count > 1024 || references + count > 2_000_000) {
      wide.push(index);
      return;
    }
    references += count;
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const key = x * size + y;
        const list = buckets.get(key);
        if (list) list.push(index);
        else buckets.set(key, [index]);
      }
  });
  return {
    rejectedFaces,
    find(e: number, n: number): { level: number | null; status: CheckStatus } {
      if (e < minE || e > maxE || n < minN || n > maxN)
        return { level: null, status: "OUTSIDE" };
      const candidates = [
        ...(buckets.get(cell(e, minE, dx) * size + cell(n, minN, dy)) ?? []),
        ...wide,
      ];
      let found: number | null = null,
        missing = false;
      for (const index of candidates) {
        const t = triangles[index],
          px = e - t.a.easting,
          py = n - t.a.northing;
        const wb = (px * t.cy - py * t.cx) / t.denominator,
          wc = (t.bx * py - t.by * px) / t.denominator,
          wa = 1 - wb - wc;
        if (Math.min(wa, wb, wc) < -1e-10) continue;
        if (
          ![t.a.elevation, t.b.elevation, t.c.elevation].every(
            (z) => typeof z === "number" && Number.isFinite(z),
          )
        ) {
          missing = true;
          continue;
        }
        const level =
          wa * t.a.elevation! + wb * t.b.elevation! + wc * t.c.elevation!;
        if (found !== null && Math.abs(level - found) > 1e-6)
          return { level: null, status: "AMBIGUOUS" };
        found = level;
      }
      if (missing) return { level: null, status: "NO_DESIGN_LEVEL" };
      return found === null
        ? { level: null, status: "OUTSIDE" }
        : { level: found, status: "PASS" };
    },
  };
}

export function checkAsBuilt(
  request: CheckRequest,
  progress?: (percent: number) => void,
): CheckResult {
  const {
    surface,
    inputs,
    catalogue,
    designCrs,
    designHeightScale,
    heightScales,
    lowerMm,
    upperMm,
  } = request;
  if (
    !Number.isFinite(lowerMm) ||
    !Number.isFinite(upperMm) ||
    lowerMm > upperMm
  )
    throw new Error(
      "Enter finite lower and upper tolerances, with lower ≤ upper.",
    );
  if (!Number.isFinite(designHeightScale) || designHeightScale <= 0)
    throw new Error("Choose the design height units.");
  const count = inputs.reduce(
    (sum, input) => sum + input.layer.points.length,
    0,
  );
  if (!count || count > maximumCheckPoints)
    throw new Error(
      `Load between 1 and ${maximumCheckPoints.toLocaleString()} measured points.`,
    );
  const target = catalogue.find((c) => c.code === designCrs);
  if (!target) throw new Error("Choose the actual design CRS.");
  const sampler = createTinSampler(surface);
  const counts: Record<CheckStatus, number> = {
    PASS: 0,
    HIGH: 0,
    LOW: 0,
    OUTSIDE: 0,
    NO_DESIGN_LEVEL: 0,
    AMBIGUOUS: 0,
    INVALID: 0,
  };
  const rows: CheckRow[] = [],
    warnings: string[] = [];
  if (surface.excludedFaces)
    warnings.push(
      `${surface.excludedFaces} invisible LandXML faces were excluded from the design TIN.`,
    );
  if (sampler.rejectedFaces)
    warnings.push(
      `${sampler.rejectedFaces} invalid or degenerate design faces were excluded. No extrapolation was used.`,
    );
  let sum = 0,
    squares = 0,
    minimum = Infinity,
    maximum = -Infinity,
    assessed = 0;
  for (const input of inputs) {
    const source = catalogue.find((c) => c.code === input.sourceCrs),
      scale = heightScales[input.heightUnit];
    if (!source)
      throw new Error(`Choose the actual input CRS for ${input.layer.name}.`);
    if (!Number.isFinite(scale) || scale <= 0)
      throw new Error(`Choose valid height units for ${input.layer.name}.`);
    const transform = createGlobalCoordinateTransform(source, target);
    warnings.push(
      ...input.layer.warnings.map(
        (warning) => `${input.layer.name}: ${warning}`,
      ),
    );
    for (const point of input.layer.points) {
      let status: CheckStatus = "INVALID",
        designLevelM: number | null = null,
        differenceMm: number | null = null;
      let e = point.easting,
        n = point.northing;
      if (
        [point.easting, point.northing, point.elevation].every(Number.isFinite)
      ) {
        const transformed = transform(point);
        e = transformed.easting;
        n = transformed.northing;
        const found = sampler.find(e, n);
        status = found.status;
        if (found.level !== null) {
          designLevelM = found.level * designHeightScale;
          differenceMm = (point.elevation * scale - designLevelM) * 1000;
          // Inclusive tolerances, with a numerical allowance far below 0.001 mm.
          status =
            differenceMm < lowerMm - 1e-7
              ? "LOW"
              : differenceMm > upperMm + 1e-7
                ? "HIGH"
                : "PASS";
          sum += differenceMm;
          squares += differenceMm * differenceMm;
          assessed++;
          minimum = Math.min(minimum, differenceMm);
          maximum = Math.max(maximum, differenceMm);
        }
      }
      counts[status]++;
      rows.push({
        ...point,
        easting: e,
        northing: n,
        file: input.layer.name,
        sourceEasting: point.easting,
        sourceNorthing: point.northing,
        measuredLevelM: point.elevation * scale,
        designLevelM,
        differenceMm,
        status,
      });
      if (rows.length % 2000 === 0)
        progress?.(Math.round((rows.length / count) * 100));
    }
  }
  return {
    rows,
    counts,
    warnings,
    minimumMm: assessed ? minimum : null,
    maximumMm: assessed ? maximum : null,
    meanMm: assessed ? sum / assessed : null,
    rmsMm: assessed ? Math.sqrt(squares / assessed) : null,
  };
}
