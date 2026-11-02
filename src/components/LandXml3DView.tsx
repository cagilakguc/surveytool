import { useMemo, useState } from "react";
import type { LandXmlDocument } from "../lib/landxml";
import { landXmlTerrainMesh } from "../lib/landxmlDisplay";
import TerrainViewer from "./TerrainViewer";

export default function LandXml3DView({
  document,
}: {
  document: LandXmlDocument;
}) {
  const [selected, setSelected] = useState(0);
  const active = Math.min(selected, Math.max(0, document.surfaces.length - 1));
  const surface = document.surfaces[active];
  const result = useMemo(() => {
    try {
      return { mesh: surface ? landXmlTerrainMesh(surface) : null, error: "" };
    } catch (error) {
      return {
        mesh: null,
        error:
          error instanceof Error
            ? error.message
            : "This surface cannot be shown in 3D.",
      };
    }
  }, [surface]);
  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">3D surface</h2>
          <p className="mt-2 text-sm text-slate-400">
            Rotate and zoom the complete TIN. Lighting is smoothed; survey
            coordinates and elevations stay unchanged.
          </p>
        </div>
        <label className="text-sm text-slate-300">
          Surface
          <select
            aria-label="3D surface"
            className="ml-3 max-w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2"
            value={active}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {document.surfaces.map((s, i) => (
              <option key={s.name + i} value={i}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {result.error && (
        <p
          role="status"
          className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-200"
        >
          {result.error}
        </p>
      )}
      {result.mesh && (
        <>
          <p className="text-sm text-slate-300">
            {result.mesh.vertices.length.toLocaleString()} vertices ·{" "}
            {result.mesh.faces.length.toLocaleString()} triangles · RL{" "}
            {result.mesh.minZ.toFixed(3)}–{result.mesh.maxZ.toFixed(3)}{" "}
            {document.units}
          </p>
          <TerrainViewer
            mesh={result.mesh}
            smooth
            label="Interactive 3D LandXML surface; drag to rotate, pinch or scroll to zoom"
            caption="Source elevations retained. Vertical exaggeration changes the display only."
            fallbackFaceLimit={60000}
          />
          {result.mesh.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-200">
              {w}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
