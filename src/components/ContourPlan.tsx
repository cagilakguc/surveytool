import type { ContourPath } from "../lib/contourTerrain";
export default function ContourPlan({
  paths,
  boundaryId,
  onSelect,
}: {
  paths: ContourPath[];
  boundaryId: string;
  onSelect: (id: string) => void;
}) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  paths.forEach((p) =>
    p.vertices.forEach((v) => {
      minX = Math.min(minX, v[0]);
      maxX = Math.max(maxX, v[0]);
      minY = Math.min(minY, v[1]);
      maxY = Math.max(maxY, v[1]);
    }),
  );
  const scale = Math.min(940 / (maxX - minX || 1), 540 / (maxY - minY || 1)),
    ox = (1000 - (maxX - minX) * scale) / 2,
    oy = (600 - (maxY - minY) * scale) / 2;
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950 p-3">
      <svg
        viewBox="0 0 1000 600"
        className="max-h-[320px] w-full"
        role="img"
        aria-label="Contour plan overview; choose a contour to find it in the elevation review"
      >
        {paths.slice(0, 2500).map((p) => (
          <path
            key={p.id}
            d={
              p.vertices
                .map(
                  (v, i) =>
                    `${i ? "L" : "M"}${ox + (v[0] - minX) * scale},${600 - oy - (v[1] - minY) * scale}`,
                )
                .join(" ") + (p.closed ? " Z" : "")
            }
            fill="none"
            stroke={
              p.id === boundaryId
                ? "#fbbf24"
                : !p.enabled
                  ? "#334155"
                  : p.elevation === null
                    ? "#fb7185"
                    : "#22d3ee"
            }
            strokeWidth={p.id === boundaryId ? 3 : 2}
            vectorEffect="non-scaling-stroke"
            onClick={() => onSelect(p.id)}
            className="cursor-pointer"
          >
            <title>
              {p.layer} · {p.id} ·{" "}
              {p.elevation === null ? "Height required" : p.elevation}
            </title>
          </path>
        ))}
        <text x="970" y="35" fill="#94a3b8" fontSize="22" textAnchor="end">
          N ↑
        </text>
      </svg>
      <p className="text-xs text-slate-400">
        Cyan: assigned height · pink: review height · amber: clipping boundary.
        Click a line to find it in the table.
        {paths.length > 2500
          ? " Overview shows the first 2,500 paths; all selected paths are processed."
          : ""}
      </p>
    </div>
  );
}
