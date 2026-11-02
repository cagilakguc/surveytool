import {
  gisMappingError,
  type GisColumnMapping,
  type GisPointTable,
} from "../lib/gisColumnMapping";

type Props = {
  table: GisPointTable;
  mapping: GisColumnMapping;
  hasHeader: boolean;
  applied: boolean;
  disabled: boolean;
  onMapping: (mapping: GisColumnMapping) => void;
  onHeader: (value: boolean) => void;
  onApply: () => void;
};
const fields: Array<{
  key: keyof GisColumnMapping;
  label: string;
  optional: boolean;
}> = [
  { key: "easting", label: "Easting / Longitude column", optional: false },
  { key: "northing", label: "Northing / Latitude column", optional: false },
  { key: "elevation", label: "Elevation / RL column", optional: true },
  { key: "id", label: "Point ID column", optional: true },
  { key: "code", label: "Feature code column", optional: true },
];

export default function GisColumnMapper({
  table,
  mapping,
  hasHeader,
  applied,
  disabled,
  onMapping,
  onHeader,
  onApply,
}: Props) {
  const firstData = hasHeader ? 1 : 0;
  const error = gisMappingError(mapping, table.columnCount);
  const columns = Array.from(
    { length: table.columnCount },
    (_, index) => index,
  );
  function columnName(index: number) {
    return (
      "Column " +
      (index + 1) +
      (hasHeader && table.rows[0][index]
        ? " — " + table.rows[0][index].slice(0, 70)
        : "")
    );
  }
  return (
    <section className="mt-6 rounded-3xl border border-cyan-400/20 bg-cyan-400/5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Choose point columns</h2>
          <p className="mt-2 break-all text-sm text-slate-300">{table.name}</p>
          <p className="mt-1 text-xs text-slate-400">
            {table.delimiterLabel} ·{" "}
            {(table.rows.length - firstData).toLocaleString()} data rows ·{" "}
            {table.columnCount} columns
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={hasHeader}
            disabled={disabled}
            onChange={(event) => onHeader(event.target.checked)}
            className="accent-cyan-400"
          />
          First row contains headings
        </label>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-400">
        Match your file's columns before importing. Recognised headers are
        suggested automatically; headerless files need your selection.
        Elevation, point ID and feature code are optional. The input CRS above
        defines the coordinate units.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {fields.map((field) => (
          <label key={field.key} className="min-w-0 text-sm text-slate-300">
            <span className="mb-2 block">
              {field.label}
              {field.optional && (
                <span className="ml-2 text-xs text-slate-500">Optional</span>
              )}
            </span>
            <select
              aria-label={field.label}
              disabled={disabled}
              value={mapping[field.key] ?? ""}
              onChange={(event) =>
                onMapping({
                  ...mapping,
                  [field.key]:
                    event.target.value === ""
                      ? null
                      : Number(event.target.value),
                })
              }
              className="w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-3 text-white outline-none focus:border-cyan-400"
            >
              <option value="">
                {field.optional
                  ? field.key === "elevation"
                    ? "Not included — Z = 0"
                    : field.key === "id"
                      ? "Not included — generate point IDs"
                      : "Not included"
                  : "Choose a column"}
              </option>
              {columns.map((index) => (
                <option key={index} value={index}>
                  {columnName(index)}
                  {table.rows[firstData]?.[index]
                    ? " · e.g. " + table.rows[firstData][index].slice(0, 50)
                    : ""}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-full text-left text-xs">
          <caption className="px-4 py-3 text-left font-semibold text-slate-300">
            Source preview · first{" "}
            {Math.min(5, Math.max(0, table.rows.length - firstData))} data rows
          </caption>
          <thead className="bg-slate-950/60 text-slate-400">
            <tr>
              {columns.map((index) => (
                <th key={index} className="min-w-32 px-4 py-3 font-medium">
                  <span className="block">{columnName(index)}</span>
                  <span className="mt-1 block font-semibold text-cyan-200">
                    {fields
                      .filter((field) => mapping[field.key] === index)
                      .map((field) =>
                        field.key === "easting"
                          ? "Easting / X"
                          : field.key === "northing"
                            ? "Northing / Y"
                            : field.key === "elevation"
                              ? "Elevation / Z"
                              : field.key === "id"
                                ? "Point ID"
                                : "Code",
                      )
                      .join(" · ") || "Not used"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.slice(firstData, firstData + 5).map((row, index) => (
              <tr key={index} className="border-t border-white/10">
                {columns.map((column) => (
                  <td
                    key={column}
                    className="max-w-64 truncate px-4 py-3 text-slate-300"
                  >
                    {row[column] || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-4 text-sm text-amber-200">{error}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          type="button"
          disabled={disabled || Boolean(error)}
          onClick={onApply}
          className="rounded-full bg-cyan-400 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-40"
        >
          {applied ? "Reapply column mapping" : "Apply column mapping"}
        </button>
        <p role="status" className="text-xs text-slate-400">
          {applied
            ? "Mapping applied to the preview and export. Changing a selection requires applying it again."
            : "Preview and export start after you confirm the column mapping."}
        </p>
      </div>
    </section>
  );
}
