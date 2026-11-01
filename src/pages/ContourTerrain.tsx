import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  Layers,
  Mountain,
  Play,
  Upload,
} from "lucide-react";
import PageSeo from "../components/PageSeo";
import ProjectPanel from "../components/ProjectPanel";
import ContourPlan from "../components/ContourPlan";
import CrsPicker from "../components/CrsPicker";
import {
  assertTerrainInput,
  assertTerrainSettings,
  demoTerrainInput,
  terrainDocument,
  terrainDxf,
  terrainLandXml,
} from "../lib/contourTerrain";
import type {
  TerrainInput,
  TerrainMesh,
  TerrainSettings,
  TerrainUnits,
} from "../lib/contourTerrain";
import {
  crsUnitScale,
  isGeographicCrs,
  loadCrsCatalogue,
} from "../lib/mapCoordinates";
import type { MapCrs } from "../lib/mapCoordinates";
import { saveWorkspace, workspaceId } from "../lib/projectWorkspace";
import {
  createReportPdf,
  downloadReportBlob,
  safeReportName,
} from "../lib/surveyReports";
const TerrainViewer = lazy(() => import("../components/TerrainViewer"));
const initialSettings: TerrainSettings = {
  name: "Contour terrain",
  units: "",
  crs: "LOCAL",
  verticalDatum: "",
  boundaryId: "",
  spacing: 0,
};
const field =
  "mt-2 w-full min-w-0 rounded-xl border border-white/15 bg-slate-950 px-3 py-3 text-sm outline-none focus:border-cyan-300 disabled:opacity-50";
const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-medium hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";

export default function ContourTerrain() {
  const [input, setInput] = useState<TerrainInput | null>(null),
    [settings, setSettings] = useState<TerrainSettings>(initialSettings),
    [mesh, setMesh] = useState<TerrainMesh | null>(null);
  const [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const [catalogue, setCatalogue] = useState<MapCrs[]>([]),
    [catalogueError, setCatalogueError] = useState("");
  const [preparedExport, setPreparedExport] = useState<{
    url: string;
    fileName: string;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null),
    worker = useRef<Worker | null>(null),
    navigate = useNavigate();
  useEffect(() => {
    let active = true;
    loadCrsCatalogue()
      .then((c) => {
        if (active) setCatalogue(c);
      })
      .catch(() => {
        if (active)
          setCatalogueError(
            "The grid catalogue could not be loaded. Local-grid terrain can still be generated.",
          );
      });
    return () => {
      active = false;
      worker.current?.terminate();
    };
  }, []);
  useEffect(() => {
    setPreparedExport(null);
  }, [input, settings, mesh]);
  useEffect(
    () => () => {
      if (preparedExport) URL.revokeObjectURL(preparedExport.url);
    },
    [preparedExport],
  );
  function exportFile(content: BlobPart, mime: string, fileName: string) {
    setPreparedExport(downloadReportBlob(content, mime, fileName, true));
  }
  const selected =
    input?.paths.filter((p) => p.enabled && p.id !== settings.boundaryId) ?? [];
  const unassigned = selected.filter((p) => p.elevation === null).length;
  const layers = useMemo(
    () => [...new Set(input?.paths.map((p) => p.layer) ?? [])],
    [input],
  );
  const matching = useMemo(
    () =>
      input?.paths.filter(
        (p) =>
          !query ||
          `${p.id} ${p.layer}`.toLowerCase().includes(query.toLowerCase()),
      ) ?? [],
    [input, query],
  );
  const crs = catalogue.find((c) => c.code === settings.crs);
  function change(change: Partial<TerrainSettings>) {
    setSettings((s) => ({ ...s, ...change }));
    setReviewed(false);
    setMesh(null);
    setError("");
  }
  function updatePath(
    id: string,
    change: { elevation?: number | null; enabled?: boolean },
  ) {
    setInput((s) =>
      s
        ? {
            ...s,
            paths: s.paths.map((p) => (p.id === id ? { ...p, ...change } : p)),
          }
        : s,
    );
    setReviewed(false);
    setMesh(null);
  }
  async function task<T>(data: unknown): Promise<T> {
    worker.current?.terminate();
    const running = new Worker(
      new URL("../workers/terrain.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = running;
    return new Promise((resolve, reject) => {
      running.onmessage = (e) => {
        running.terminate();
        if (worker.current === running) worker.current = null;
        if (e.data.ok) resolve(e.data.value);
        else reject(new Error(e.data.error));
      };
      running.onerror = () => {
        running.terminate();
        worker.current = null;
        reject(
          new Error(
            "Terrain processing could not finish. Try fewer contour layers or a smaller area.",
          ),
        );
      };
      running.postMessage(data);
    });
  }
  async function open(file?: File) {
    if (!file) return;
    setBusy("Reading DXF contours…");
    setError("");
    try {
      const data = await task<TerrainInput>({ type: "parse", file });
      setInput(data);
      setSettings({
        ...initialSettings,
        name: file.name.replace(/\.dxf$/i, ""),
        units: data.units,
      });
      setMesh(null);
      setReviewed(false);
      setQuery("");
      setPage(0);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The drawing could not be opened.",
      );
    } finally {
      setBusy("");
    }
  }
  async function generate() {
    setError("");
    if (!input || !reviewed) return;
    if (crs && isGeographicCrs(crs)) {
      setError(
        "Use a projected survey grid or local grid for terrain. Longitude/latitude coordinates are not linear terrain units.",
      );
      return;
    }
    const unitScale = {
      meter: 1,
      millimeter: 0.001,
      foot: 0.3048,
      USSurveyFoot: 1200 / 3937,
    }[settings.units || "meter"];
    if (
      crs &&
      crsUnitScale(crs) !== null &&
      Math.abs(crsUnitScale(crs)! - unitScale) > 1e-9
    ) {
      setError(
        "The drawing units differ from the selected grid's units. This tool retains source coordinates; choose matching units or use a local grid.",
      );
      return;
    }
    setBusy("Validating contours and building the terrain…");
    try {
      setMesh(await task<TerrainMesh>({ type: "build", input, settings }));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The surface could not be generated.",
      );
    } finally {
      setBusy("");
    }
  }
  async function toSections() {
    if (!mesh) return;
    setBusy("Saving the surface for Cross Sections…");
    try {
      const doc = terrainDocument(mesh, settings),
        id = workspaceId();
      await saveWorkspace({
        format: "surveytool-project",
        version: 1,
        id,
        tool: "sections",
        title: settings.name || "Contour terrain",
        savedAt: new Date().toISOString(),
        state: {
          document: doc,
          pointLayers: [],
          xmlFiles: [doc.fileName],
          pointFiles: [],
          sectionSettings: null,
          lineMarking: null,
        },
      });
      navigate(`/tools/cross-section?project=${encodeURIComponent(id)}`);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The surface could not be opened in Cross Sections.",
      );
    } finally {
      setBusy("");
    }
  }
  async function pdf() {
    if (!mesh) return;
    setBusy("Preparing PDF summary…");
    try {
      const bytes = await createReportPdf({
        title: "Contour terrain summary",
        project: settings.name || "Contour terrain",
        createdAt: new Date().toISOString(),
        metadata: [
          ["Source drawing", input?.fileName ?? ""],
          ["Source units", settings.units],
          ["Coordinate grid", settings.crs || "Local / unspecified"],
          ["Vertical datum", settings.verticalDatum || "Not specified"],
          [
            "Boundary",
            settings.boundaryId
              ? "Closed polyline clipping boundary"
              : "Contour convex hull",
          ],
        ],
        summary: [
          ["Selected contours", mesh.contourCount],
          ["TIN vertices", mesh.vertices.length],
          ["TIN faces", mesh.faces.length],
          ["Plan area (square source units)", mesh.area],
          ["Minimum elevation", mesh.minZ],
          ["Maximum elevation", mesh.maxZ],
        ],
        columns: ["Source", "Status"],
        rows: [
          [input?.fileName ?? "Contours", "Heights reviewed before generation"],
        ],
        notes: mesh.warnings,
        plot: {
          points: mesh.vertices
            .filter(
              (_, i) =>
                i % Math.max(1, Math.ceil(mesh.vertices.length / 2000)) === 0,
            )
            .map((v) => ({ easting: v[0], northing: v[1], colour: "#0891b2" })),
          legend: { "TIN extent / vertices": "#0891b2" },
        },
      });
      exportFile(
        bytes,
        "application/pdf",
        `${safeReportName(settings.name)}-terrain-summary.pdf`,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The PDF could not be prepared.",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="relative z-10 mx-auto min-h-screen max-w-[1440px] px-5 py-10 sm:px-8">
      <PageSeo
        title="Contours to 3D Terrain | SurveyTool.io"
        description="Build a 3D TIN surface from reviewed DXF contour elevations. Inspect the terrain, create cross-sections and export LandXML or 3D DXF."
        canonicalUrl="https://www.surveytool.io/tools/contours-to-terrain"
      />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-cyan-300"
        >
          <ArrowLeft size={17} />
          SurveyTool
        </Link>
        <Link to="/projects" className="text-sm text-slate-300">
          Saved projects →
        </Link>
      </div>
      <header className="mb-8 mt-9">
        <p className="text-xs font-semibold uppercase tracking-[.25em] text-cyan-300">
          Surface builder
        </p>
        <h1 className="mt-3 text-3xl font-bold sm:text-5xl">
          Contours to 3D Terrain
        </h1>
        <p className="mt-4 max-w-3xl leading-7 text-slate-400">
          Turn contour lines into a terrain surface. Review the heights, inspect
          the 3D model, and take the result straight into cross-sections or CAD.
        </p>
      </header>
      <ProjectPanel
        tool="terrain"
        disabled={!!busy}
        state={{ input, settings, reviewed }}
        onRestore={(state) => {
          if (state.input !== null) assertTerrainInput(state.input);
          assertTerrainSettings(state.settings);
          setInput(state.input as TerrainInput | null);
          setSettings(state.settings);
          setReviewed(state.reviewed === true);
          setMesh(null);
          setError("");
          setQuery("");
          setPage(0);
        }}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Upload size={19} className="text-cyan-300" />
              1. Add your drawing
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              ASCII DXF · straight 2D / 3D polylines and lines · up to 50 MB.
              Export DWG contours as DXF for this version.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".dxf"
              className="hidden"
              onChange={(e) => {
                void open(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              disabled={!!busy}
              onClick={() => fileInput.current?.click()}
              className={`${button} mt-4 w-full bg-cyan-300/10 text-cyan-200`}
            >
              Choose contour DXF
            </button>
            <button
              disabled={!!busy}
              onClick={() => {
                const demo = demoTerrainInput();
                setInput(demo);
                setSettings({
                  ...initialSettings,
                  name: "Demo hillside",
                  units: "meter",
                  crs: "EPSG:2193",
                });
                setMesh(null);
                setReviewed(false);
                setQuery("");
                setPage(0);
                setError("");
              }}
              className={`${button} mt-2 w-full`}
            >
              <Play size={15} />
              Try a demo hillside
            </button>
            {input && (
              <p className="mt-3 break-all text-xs text-slate-400">
                {input.fileName}
              </p>
            )}
          </section>
          <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
            <h2 className="text-lg font-semibold">2. Surface settings</h2>
            <label className="mt-4 block text-xs text-slate-400">
              Surface name
              <input
                maxLength={200}
                value={settings.name}
                disabled={!!busy}
                onChange={(e) => change({ name: e.target.value })}
                className={field}
              />
            </label>
            <label className="mt-4 block text-xs text-slate-400">
              Drawing units
              <select
                value={settings.units}
                disabled={!!busy}
                onChange={(e) =>
                  change({ units: e.target.value as TerrainUnits | "" })
                }
                className={field}
              >
                <option value="">Confirm source units</option>
                <option value="meter">Metres</option>
                <option value="millimeter">Millimetres</option>
                <option value="foot">International feet</option>
                <option value="USSurveyFoot">US survey feet</option>
              </select>
            </label>
            <label className="mt-4 block text-xs text-slate-400">
              Vertical datum / height reference
              <input
                maxLength={200}
                value={settings.verticalDatum}
                disabled={!!busy}
                placeholder="e.g. NZVD2016, Auckland 1946, local"
                onChange={(e) => change({ verticalDatum: e.target.value })}
                className={field}
              />
            </label>
            <label className="mt-4 block text-xs text-slate-400">
              Clipping boundary
              <select
                value={settings.boundaryId}
                disabled={!!busy}
                onChange={(e) => change({ boundaryId: e.target.value })}
                className={field}
              >
                <option value="">Automatic extent (convex hull)</option>
                {input?.paths
                  .filter((p) => p.closed)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.layer} · {p.id}
                    </option>
                  ))}
              </select>
            </label>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              A boundary path is excluded from the contours. Clipping trims
              existing coverage and never adds terrain outside it.
            </p>
            <label className="mt-4 block text-xs text-slate-400">
              Supplementary vertex spacing (source units)
              <input
                type="number"
                min="0"
                step="any"
                value={settings.spacing}
                disabled={!!busy}
                onChange={(e) => change({ spacing: Number(e.target.value) })}
                className={field}
              />
            </label>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              0 retains original vertices. A positive spacing adds points along
              existing contours, preserving their assigned height.
            </p>
          </section>
          <CrsPicker
            label="Source grid"
            catalogue={catalogue}
            value={settings.crs}
            loading={!catalogue.length && !catalogueError}
            onChange={(crs) => change({ crs })}
            disabled={!!busy}
            showMapNote={false}
            note="Choose the grid already used by the drawing. Coordinates and heights are retained; no reprojection is applied."
          />
          {catalogueError && (
            <p className="text-xs text-amber-200">{catalogueError}</p>
          )}
        </aside>
        <div className="min-w-0 space-y-6">
          {!input ? (
            <section className="flex min-h-[450px] flex-col items-center justify-center rounded-3xl border border-dashed border-cyan-300/20 bg-cyan-300/[.03] p-8 text-center">
              <Mountain
                size={70}
                strokeWidth={1}
                className="text-cyan-300/60"
              />
              <h2 className="mt-6 text-2xl font-semibold">
                From contour lines to a surface
              </h2>
              <p className="mt-3 max-w-md leading-7 text-slate-400">
                Start with your DXF or try the demo. Everything is processed on
                your device, including the terrain calculation.
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-2 text-xs text-slate-300">
                {[
                  "Review elevations",
                  "3D terrain",
                  "Cross-sections",
                  "LandXML + DXF",
                ].map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-white/10 px-3 py-2"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </section>
          ) : (
            <>
              <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-xl font-semibold">
                      <Layers size={19} className="text-cyan-300" />
                      3. Review contours
                    </h2>
                    <p className="mt-2 text-sm text-slate-400">
                      {selected.length.toLocaleString()} selected ·{" "}
                      {unassigned.toLocaleString()} need a height
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
                    Files stay on this device
                  </span>
                </div>
                <div className="mt-5">
                  <ContourPlan
                    paths={input.paths}
                    boundaryId={settings.boundaryId}
                    onSelect={(id) => {
                      setQuery(id);
                      setPage(0);
                    }}
                  />
                </div>
                <details className="mt-4 rounded-xl border border-white/10 p-3">
                  <summary className="cursor-pointer text-sm text-slate-300">
                    Choose contour layers ({layers.length})
                  </summary>
                  <div className="mt-3 flex max-h-48 flex-wrap gap-3 overflow-y-auto">
                    {layers.map((layer) => (
                      <label
                        key={layer}
                        className="inline-flex items-center gap-2 text-xs text-slate-300"
                      >
                        <input
                          type="checkbox"
                          disabled={!!busy}
                          checked={input.paths
                            .filter((p) => p.layer === layer)
                            .every((p) => p.enabled)}
                          onChange={(e) => {
                            const enabled = e.target.checked;
                            setInput({
                              ...input,
                              paths: input.paths.map((p) =>
                                p.layer === layer ? { ...p, enabled } : p,
                              ),
                            });
                            setMesh(null);
                            setReviewed(false);
                          }}
                        />
                        {layer}
                      </label>
                    ))}
                  </div>
                </details>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(0);
                    }}
                    aria-label="Find contour by ID or layer"
                    placeholder="Filter by layer or path ID"
                    className={`${field} mt-0 max-w-sm`}
                  />
                  {query && (
                    <button
                      onClick={() => {
                        setQuery("");
                        setPage(0);
                      }}
                      className="text-xs text-cyan-300 underline"
                    >
                      Show all contours
                    </button>
                  )}
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-white/10 text-xs text-slate-400">
                      <tr>
                        <th className="p-2">Use</th>
                        <th className="p-2">Layer / path</th>
                        <th className="p-2">Vertices</th>
                        <th className="p-2">Contour elevation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matching.slice(page * 50, page * 50 + 50).map((p) => (
                        <tr key={p.id} className="border-b border-white/5">
                          <td className="p-2">
                            <input
                              type="checkbox"
                              aria-label={`Use contour ${p.id}`}
                              disabled={!!busy || p.id === settings.boundaryId}
                              checked={
                                p.enabled && p.id !== settings.boundaryId
                              }
                              onChange={(e) =>
                                updatePath(p.id, { enabled: e.target.checked })
                              }
                            />
                          </td>
                          <td className="p-2">
                            <span className="block break-all text-slate-200">
                              {p.layer}
                            </span>
                            <span className="text-xs text-slate-500">
                              {p.id}
                              {p.id === settings.boundaryId
                                ? " · boundary"
                                : ""}
                            </span>
                          </td>
                          <td className="p-2 text-slate-400">
                            {p.vertices.length.toLocaleString()}
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              step="any"
                              aria-label={`Elevation for contour ${p.id}`}
                              value={p.elevation ?? ""}
                              disabled={!!busy || p.id === settings.boundaryId}
                              placeholder="Assign height"
                              onChange={(e) =>
                                updatePath(p.id, {
                                  elevation:
                                    e.target.value.trim() === ""
                                      ? null
                                      : Number(e.target.value),
                                })
                              }
                              className={`w-32 rounded-lg border px-3 py-2 outline-none focus:border-cyan-300 ${p.elevation === null && p.enabled && p.id !== settings.boundaryId ? "border-rose-400/40 bg-rose-400/5" : "border-white/15 bg-slate-950"}`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {matching.length > 50 && (
                  <div className="mt-3 flex items-center gap-4 text-xs text-slate-400">
                    <button
                      disabled={page === 0}
                      onClick={() => setPage((n) => n - 1)}
                      className={button}
                    >
                      Previous
                    </button>
                    <span>
                      Page {page + 1} of {Math.ceil(matching.length / 50)}
                    </span>
                    <button
                      disabled={(page + 1) * 50 >= matching.length}
                      onClick={() => setPage((n) => n + 1)}
                      className={button}
                    >
                      Next
                    </button>
                  </div>
                )}
                <p className="mt-4 text-xs leading-6 text-slate-400">
                  Zero or missing CAD heights are left unassigned. Enter 0
                  explicitly only when it is the correct contour elevation.
                  Contour lines must not cross or overlap.
                </p>
                <label className="mt-5 flex items-start gap-3 rounded-xl bg-cyan-300/5 p-4 text-sm text-cyan-100">
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={!!busy}
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  <span>
                    I have checked the selected contour elevations, source units
                    and height reference.
                  </span>
                </label>
                <button
                  disabled={
                    !!busy ||
                    !reviewed ||
                    !!unassigned ||
                    !selected.length ||
                    !settings.units
                  }
                  onClick={() => void generate()}
                  className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Mountain size={19} />
                  {busy || "Generate 3D terrain"}
                </button>
                {input.warnings.length > 0 && (
                  <details className="mt-4 text-xs text-amber-200">
                    <summary className="cursor-pointer">
                      Source file notes ({input.warnings.length})
                    </summary>
                    <ul className="ml-4 mt-2 list-disc space-y-1">
                      {input.warnings.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
              {mesh && (
                <section className="space-y-5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ["TIN vertices", mesh.vertices.length.toLocaleString()],
                      ["Triangles", mesh.faces.length.toLocaleString()],
                      ["Lowest level", mesh.minZ.toFixed(3)],
                      ["Highest level", mesh.maxZ.toFixed(3)],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"
                      >
                        <p className="text-xs text-slate-400">{label}</p>
                        <p className="mt-2 text-xl font-semibold">{value}</p>
                      </div>
                    ))}
                  </div>
                  <Suspense
                    fallback={
                      <p className="p-8 text-cyan-200">Loading 3D preview…</p>
                    }
                  >
                    <TerrainViewer mesh={mesh} />
                  </Suspense>
                  <div className="flex flex-wrap gap-3">
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        exportFile(
                          terrainLandXml(mesh, settings),
                          "application/xml",
                          `${safeReportName(settings.name)}.xml`,
                        )
                      }
                      className={button}
                    >
                      <Download size={16} />
                      LandXML
                    </button>
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        exportFile(
                          terrainDxf(mesh),
                          "application/dxf",
                          `${safeReportName(settings.name)}-TIN.dxf`,
                        )
                      }
                      className={button}
                    >
                      <Download size={16} />
                      3D DXF
                    </button>
                    <button
                      disabled={!!busy}
                      onClick={() => void pdf()}
                      className={button}
                    >
                      <Download size={16} />
                      PDF summary
                    </button>
                    <button
                      disabled={!!busy}
                      onClick={() => void toSections()}
                      className={`${button} border-cyan-300/40 text-cyan-200`}
                    >
                      Open in Cross Sections →
                    </button>
                  </div>
                  {preparedExport && (
                    <p role="status" className="text-sm text-cyan-200">
                      Export ready.{" "}
                      <a
                        href={preparedExport.url}
                        download={preparedExport.fileName}
                        className="underline"
                      >
                        Download prepared {preparedExport.fileName}
                      </a>
                    </p>
                  )}
                  <div className="rounded-2xl border border-amber-300/15 bg-amber-300/5 p-4 text-xs leading-6 text-amber-100">
                    {mesh.warnings.map((s, i) => (
                      <p key={i}>{s}</p>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
          {busy && (
            <p
              role="status"
              className="rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-4 text-sm text-cyan-100"
            >
              {busy}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-rose-300/20 bg-rose-300/5 p-4 text-sm text-rose-100"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
