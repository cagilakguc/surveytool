import { parsePointFileText } from "./pointFile";
import type { SurveyGeometryLayer } from "./surveyGeometry";

export type GisColumnMapping = {
  easting: number | null;
  northing: number | null;
  elevation: number | null;
  id: number | null;
  code: number | null;
};
export type GisPointTable = {
  name: string;
  format: "CSV" | "TXT";
  rows: string[][];
  columnCount: number;
  delimiterLabel: string;
  hasHeader: boolean;
  suggested: GisColumnMapping;
};
const aliases = {
  easting: [
    "easting",
    "eastings",
    "east",
    "e",
    "x",
    "coordx",
    "xcoordinate",
    "eastingm",
    "longitude",
    "lon",
    "long",
    "lng",
  ],
  northing: [
    "northing",
    "northings",
    "north",
    "n",
    "y",
    "coordy",
    "ycoordinate",
    "northingm",
    "latitude",
    "lat",
  ],
  elevation: [
    "elevation",
    "elev",
    "level",
    "rl",
    "z",
    "height",
    "reducedlevel",
    "elevationm",
    "rlm",
  ],
  id: [
    "id",
    "pointid",
    "point",
    "pointno",
    "pointnumber",
    "ptno",
    "number",
    "name",
    "label",
  ],
  code: ["code", "featurecode", "description", "desc", "layer", "string"],
};
const emptyMapping = (): GisColumnMapping => ({
  easting: null,
  northing: null,
  elevation: null,
  id: null,
  code: null,
});

export function mappedNumber(value: string | undefined): number | null {
  let text = value?.trim() ?? "";
  if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?(?:e[+-]?\d+)?$/i.test(text))
    text = text.replaceAll(",", "");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function readGisPointTable(text: string, name: string): GisPointTable {
  const extension = name.toLowerCase().split(".").pop();
  if (extension !== "csv" && extension !== "txt")
    throw new Error("Column mapping supports CSV and TXT point files.");
  const cleaned = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*(#|\/\/)/.test(line))
    .join("\n");
  const parsed = parsePointFileText(cleaned);
  if (!parsed.rows.length)
    throw new Error("The file does not contain any point rows.");
  if (parsed.rows.length > 500_001)
    throw new Error("Choose a file with 500,000 point rows or fewer.");
  let columnCount = 0;
  for (const row of parsed.rows)
    columnCount = Math.max(columnCount, row.length);
  if (columnCount < 2)
    throw new Error(
      "At least two columns are needed for Easting and Northing. Use comma, tab, semicolon or whitespace separators.",
    );
  if (columnCount > 256)
    throw new Error("Choose a file with 256 columns or fewer.");
  const headers = parsed.rows[0].map((value) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
  const recognised = Object.values(aliases).reduce(
    (count, names) =>
      count + Number(headers.some((header) => names.includes(header))),
    0,
  );
  const numericCount = parsed.rows[0].filter(
    (value) => mappedNumber(value) !== null,
  ).length;
  const hasHeader =
    recognised >= 2 || (numericCount < 2 && parsed.rows.length > 1);
  const suggested = emptyMapping();
  if (hasHeader)
    for (const key of Object.keys(aliases) as Array<keyof GisColumnMapping>) {
      const index = headers.findIndex((header) =>
        aliases[key].includes(header),
      );
      suggested[key] = index < 0 ? null : index;
    }
  return {
    name,
    format: extension === "csv" ? "CSV" : "TXT",
    rows: parsed.rows,
    columnCount,
    delimiterLabel: parsed.delimiterLabel,
    hasHeader,
    suggested,
  };
}

export function gisMappingError(
  mapping: GisColumnMapping,
  columnCount: number,
) {
  for (const [field, index] of Object.entries(mapping))
    if (
      index !== null &&
      (!Number.isInteger(index) || index < 0 || index >= columnCount)
    )
      return "Choose a valid column for " + field + ".";
  if (mapping.easting === null || mapping.northing === null)
    return "Choose the Easting and Northing columns before importing.";
  const selected = [
    mapping.easting,
    mapping.northing,
    mapping.elevation,
  ].filter((index) => index !== null);
  if (new Set(selected).size !== selected.length)
    return "Easting, Northing and Elevation must use different columns.";
  return "";
}

export function mapGisPointTable(
  table: GisPointTable,
  mapping: GisColumnMapping,
  hasHeader: boolean,
): SurveyGeometryLayer {
  const invalidMapping = gisMappingError(mapping, table.columnCount);
  if (invalidMapping) throw new Error(invalidMapping);
  const points: SurveyGeometryLayer["points"] = [];
  let skipped = 0;
  for (let index = hasHeader ? 1 : 0; index < table.rows.length; index++) {
    const row = table.rows[index];
    const easting = mappedNumber(row[mapping.easting!]),
      northing = mappedNumber(row[mapping.northing!]);
    const elevation =
      mapping.elevation === null ? 0 : mappedNumber(row[mapping.elevation]);
    if (easting === null || northing === null || elevation === null) {
      skipped++;
      continue;
    }
    points.push({
      id:
        mapping.id === null
          ? "P" + (points.length + 1)
          : row[mapping.id]?.trim() || "P" + (points.length + 1),
      easting,
      northing,
      elevation,
      code: mapping.code === null ? "" : (row[mapping.code]?.trim() ?? ""),
    });
    if (points.length > 500_000)
      throw new Error("Choose a file with 500,000 point rows or fewer.");
  }
  if (!points.length)
    throw new Error(
      "No valid points were found with these columns. Check the assignments, header setting and numeric values. Use a dot for decimal values.",
    );
  const warnings: string[] = [];
  if (mapping.elevation === null)
    warnings.push(
      "No Elevation column selected. Exported Z values are set to 0; no measured heights have been inferred.",
    );
  if (skipped)
    warnings.push(
      skipped.toLocaleString("en-NZ") +
        (skipped === 1 ? " row with missing or invalid selected coordinates was skipped." : " rows with missing or invalid selected coordinates were skipped."),
    );
  return {
    name: table.name,
    format: table.format,
    points,
    lines: [],
    polygons: [],
    warnings,
  };
}
