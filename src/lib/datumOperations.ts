import type { MapCrs } from "./mapCoordinates";

const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
function datumName(crs: MapCrs) {
  if (crs.datum) return clean(crs.datum);
  const definition = crs.canonicalProj4 ?? crs.proj4;
  const wkt = definition.match(/DATUM\s*\[\s*"([^"]+)/i)?.[1];
  if (wkt) return clean(wkt);
  if (/\+datum=WGS84\b/i.test(definition)) return "wgs1984";
  // Hand-built definitions have no authoritative datum identity. Never infer
  // equivalent datums solely from a shared ellipsoid.
  return "";
}
function linkToWgs84(crs: MapCrs, datum: string) {
  const definition = crs.canonicalProj4 ?? crs.proj4;
  return (
    datum === "wgs1984" ||
    /\+towgs84=[^\s]+/.test(definition) ||
    /\+nadgrids=[^\s]+/.test(definition)
  );
}
export function datumOperationError(source: MapCrs, target: MapCrs): string {
  if (source.code === target.code) return "";
  const a = datumName(source),
    b = datumName(target);
  const definitions = `${source.canonicalProj4 ?? source.proj4} ${target.canonicalProj4 ?? target.proj4}`;
  const grids = [...definitions.matchAll(/\+nadgrids=([^\s]+)/g)].flatMap(
    (match) => match[1].split(","),
  );
  const realGrids = grids.filter((name) => name !== "@null" && name !== "null");
  if (
    realGrids.length &&
    (realGrids.some((name) => name.startsWith("@")) ||
      grids.includes("null") ||
      grids.includes("@null"))
  ) {
    return "This datum operation allows an optional grid or null fallback. A verified mandatory grid operation is required for survey-file conversion; no approximate export has been created.";
  }
  if (a && a === b) return "";
  if (
    [a, b].some((name) =>
      /^geocentricdatumofaustralia(?:1994|2020)$/.test(name),
    )
  ) {
    return "Changing between GDA94, GDA2020 and other datums requires a documented transformation. A verified conformal or conformal-plus-distortion operation is not available in this browser. Keep the source datum, or use official transformation software; no approximate export has been created.";
  }
  if (!a || !b || !linkToWgs84(source, a) || !linkToWgs84(target, b)) {
    return "No documented datum operation is available for this CRS pair. Matching ellipsoids do not make datums equivalent. Keep the source CRS or use GIS software with an explicit transformation.";
  }
  const shifts = [...definitions.matchAll(/\+towgs84=([^\s]+)/g)].map((match) =>
    match[1].split(",").map(Number),
  );
  if (
    !realGrids.length &&
    a !== "wgs1984" &&
    b !== "wgs1984" &&
    shifts.length &&
    shifts.every((values) => values.every((n) => n === 0))
  ) {
    return "These CRSs use different datums but the catalogue only supplies zero shifts. Select an explicit datum transformation in GIS software; no unchanged coordinates have been relabelled.";
  }
  return "";
}
