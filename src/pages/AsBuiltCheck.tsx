import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PageSeo from "../components/PageSeo";
import CrsPicker from "../components/CrsPicker";
import ProjectPanel from "../components/ProjectPanel";
import ReportDownloads from "../components/ReportDownloads";
import type { LandXmlDocument } from "../lib/landxml";
import { parseLandXmlFile } from "../lib/landxmlAsync";
import { parseSurveyPointFile } from "../lib/surveyPoints";
import { parseSurveyGeometryFile } from "../lib/surveyGeometry";
import type { SurveyGeometryLayer } from "../lib/surveyGeometry";
import {
  crsUnitScale,
  detectFileCrs,
  isGeographicCrs,
  loadCrsCatalogue,
  metresPerLinearUnit,
} from "../lib/mapCoordinates";
import type { Basemap, MapCrs } from "../lib/mapCoordinates";
import { mapInputUnitError } from "../lib/surfaceMapAnalysis";
import {
  assertDocument,
  assertPointLayer,
  record,
  workspaceId,
} from "../lib/projectWorkspace";
import { statusColours } from "../lib/asBuiltConformance";
import type {
  CheckInput,
  CheckResult,
  CheckStatus,
} from "../lib/asBuiltConformance";
import type { SurveyReport } from "../lib/surveyReports";

const SurveyMap = lazy(() => import("../components/SurveyMap"));
const heightScales: Record<string, number> = {
  metre: 1,
  foot: 0.3048,
  "US survey foot": 1200 / 3937,
  millimetre: 0.001,
};
const field =
  "w-full min-w-0 rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300";
const statuses = Object.keys(statusColours) as CheckStatus[];
const format = (value: number | null, digits = 3) =>
  value === null || !Number.isFinite(value)
    ? "—"
    : Number(value.toFixed(digits)).toFixed(digits);
function Plan({ result }: { result: CheckResult }) {
  const data = useMemo(() => {
    const points = result.rows.filter(
      (r) => Number.isFinite(r.easting) && Number.isFinite(r.northing),
    );
    let minE = Infinity,
      maxE = -Infinity,
      minN = Infinity,
      maxN = -Infinity;
    points.forEach((p) => {
      minE = Math.min(minE, p.easting);
      maxE = Math.max(maxE, p.easting);
      minN = Math.min(minN, p.northing);
      maxN = Math.max(maxN, p.northing);
    });
    const scale = Math.min(
        940 / Math.max(maxE - minE, 1),
        390 / Math.max(maxN - minN, 1),
      ),
      step = Math.max(1, Math.ceil(points.length / 5000));
    return {
      points: points.filter((_, i) => i % step === 0),
      minE,
      minN,
      scale,
      total: points.length,
    };
  }, [result]);
  return (
    <div>
      <svg
        viewBox="0 0 1000 450"
        role="img"
        aria-label="Coloured as-built results in the design grid"
        className="w-full rounded-xl bg-slate-950"
      >
        <text x="24" y="22" fill="#94a3b8" fontSize="13">
          N ↑ · E →
        </text>
        {data.points.map((p, i) => (
          <circle
            key={i}
            cx={30 + (p.easting - data.minE) * data.scale}
            cy={420 - (p.northing - data.minN) * data.scale}
            r={3.8}
            fill={statusColours[p.status]}
          >
            <title>
              {p.id}: {p.status} · {format(p.differenceMm, 2)} mm
            </title>
          </circle>
        ))}
      </svg>
      <p className="mt-2 text-xs text-slate-400">
        Plan preview: {data.points.length.toLocaleString()} of{" "}
        {data.total.toLocaleString()} points. Checks and CSV include all
        results.
      </p>
    </div>
  );
}
function demo() {
  const e = 1755000,
    n = 5923000,
    z = (x: number, y: number) => 100 + x * 0.001 + y * 0.002;
  const document: LandXmlDocument = {
    fileName: "demo-design.xml",
    version: "1.2",
    projectName: "As-built design check demo",
    applicationName: "SurveyTool",
    units: "meter",
    coordinateSystem: { epsgCode: "2193" },
    alignments: [],
    cogoPoints: [],
    warnings: [],
    surfaces: [
      {
        name: "Finished design",
        minElevation: 100,
        maxElevation: 100.5,
        points: {
          a: { easting: e, northing: n, elevation: 100 },
          b: { easting: e + 200, northing: n, elevation: 100.2 },
          c: { easting: e + 200, northing: n + 150, elevation: 100.5 },
          d: { easting: e, northing: n + 150, elevation: 100.3 },
        },
        faces: [
          ["a", "b", "c"],
          ["a", "c", "d"],
        ],
      },
    ],
  };
  const points = [
    [10, 10, 0.005],
    [30, 60, 0.027],
    [110, 80, -0.022],
    [50, 50, -0.01],
    [230, 20, 0],
  ].map(([x, y, dz], i) => ({
    id: `ASB-${i + 1}`,
    easting: e + x,
    northing: n + y,
    elevation: z(x, y) + dz,
    code: "ASBUILT",
  }));
  const inputs: CheckInput[] = [
    {
      id: "demo-points",
      sourceCrs: "EPSG:2193",
      heightUnit: "metre",
      layer: { name: "demo-asbuilt.csv", format: "CSV", warnings: [], points },
    },
  ];
  return { document, inputs };
}
export default function AsBuiltCheck() {
  const [document, setDocument] = useState<LandXmlDocument | null>(null);
  const [inputs, setInputs] = useState<CheckInput[]>([]);
  const [surfaceIndex, setSurfaceIndex] = useState(0);
  const [designCrs, setDesignCrs] = useState("");
  const [designHeightUnit, setDesignHeightUnit] = useState("metre");
  const [lower, setLower] = useState("-10"),
    [upper, setUpper] = useState("10");
  const [heightDatum, setHeightDatum] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [project, setProject] = useState("");
  const [job, setJob] = useState("");
  const [surveyor, setSurveyor] = useState("");
  const [notes, setNotes] = useState("");
  const [catalogue, setCatalogue] = useState<MapCrs[]>([]);
  const [attempt, setAttempt] = useState(0),
    [catalogueError, setCatalogueError] = useState("");
  const [busy, setBusy] = useState(false),
    [reading, setReading] = useState(false);
  const [progress, setProgress] = useState(0),
    [message, setMessage] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null),
    [calculatedAt, setCalculatedAt] = useState("");
  const [filter, setFilter] = useState("ALL"),
    [page, setPage] = useState(0);
  const [basemap, setBasemap] = useState<Basemap>("street");
  const worker = useRef<Worker | null>(null),
    abort = useRef<AbortController | null>(null);
  const designFile = useRef<HTMLInputElement>(null),
    pointFiles = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    setCatalogueError("");
    loadCrsCatalogue()
      .then((c) => {
        if (active) setCatalogue(c);
      })
      .catch((error) => {
        if (active) setCatalogueError(String(error));
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  useEffect(() => {
    setResult(null);
    setMessage("");
    setPage(0);
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
  }, [
    document,
    inputs,
    surfaceIndex,
    designCrs,
    designHeightUnit,
    lower,
    upper,
    heightDatum,
    confirmed,
  ]);
  useEffect(
    () => () => {
      worker.current?.terminate();
      abort.current?.abort();
    },
    [],
  );
  const crs = catalogue.find((c) => c.code === designCrs);
  const surface = document?.surfaces[surfaceIndex];
  const coordinateError =
    document && crs
      ? isGeographicCrs(crs)
        ? "Choose a projected design grid for a TIN level check."
        : crsUnitScale(crs) === null
          ? "The design grid units are not supported."
          : mapInputUnitError(document, crs)
      : "";
  const total = inputs.reduce(
    (sum, input) => sum + input.layer.points.length,
    0,
  );
  const ready =
    !!surface &&
    !!crs &&
    inputs.length > 0 &&
    inputs.every((input) => !!input.sourceCrs) &&
    confirmed &&
    !!heightDatum.trim() &&
    !coordinateError;
  async function loadDesign(file?: File) {
    if (!file) return;
    setReading(true);
    setMessage("");
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    try {
      if (file.size > 100 * 1024 * 1024)
        throw new Error("Choose a LandXML file smaller than 100 MB.");
      const parsed = await parseLandXmlFile(file, {
        signal: controller.signal,
        onProgress: (_, percent) => setProgress(percent),
      });
      if (!parsed.surfaces.length)
        throw new Error("The LandXML file contains no TIN surfaces.");
      setDocument(parsed);
      setSurfaceIndex(0);
      setDesignCrs(detectFileCrs(parsed.coordinateSystem, catalogue) ?? "");
      setConfirmed(false);
      const scale = metresPerLinearUnit(parsed.units);
      setDesignHeightUnit(
        Object.keys(heightScales).find(
          (name) => heightScales[name] === scale,
        ) ?? "metre",
      );
      if (!project) setProject(parsed.projectName);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The design file could not be opened.",
      );
    } finally {
      setReading(false);
      setProgress(0);
    }
  }
  async function loadPoints(files: File[]) {
    if (!files.length) return;
    setReading(true);
    setMessage("");
    try {
      const loaded: CheckInput[] = [];
      for (const file of files) {
        if (file.size > 50 * 1024 * 1024)
          throw new Error(
            `${file.name}: choose a point file smaller than 50 MB.`,
          );
        let layer;
        if (/\.dxf$/i.test(file.name)) {
          const geometry = await parseSurveyGeometryFile(file);
          const points = [
            ...geometry.points,
            ...geometry.lines.flatMap((line) =>
              line.vertices.map((p, i) => ({
                ...p,
                id: `${line.id}-${i + 1}`,
                code: line.code,
              })),
            ),
            ...geometry.polygons.flatMap((polygon) =>
              polygon.rings.flatMap((ring, ri) =>
                ring
                  .slice(0, -1)
                  .map((p, i) => ({
                    ...p,
                    id: `${polygon.id}-${ri + 1}-${i + 1}`,
                    code: polygon.code,
                  })),
              ),
            ),
          ];
          if (!points.length)
            throw new Error(
              `${file.name}: no supported model-space survey points or vertices were found.`,
            );
          layer = {
            name: file.name,
            format: "DXF" as const,
            points,
            warnings: [
              ...geometry.warnings,
              "DXF heights must be measured levels. Verify the source if a 2D entity has Z = 0.",
            ],
          };
        } else layer = await parseSurveyPointFile(file);
        loaded.push({
          id: workspaceId(),
          layer,
          sourceCrs: "",
          heightUnit: "metre",
        });
      }
      setInputs((current) => [...current, ...loaded]);
      setConfirmed(false);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The measured points could not be read.",
      );
    } finally {
      setReading(false);
    }
  }
  function run() {
    if (!ready || !surface) return;
    if (
      !lower.trim() ||
      !upper.trim() ||
      !Number.isFinite(Number(lower)) ||
      !Number.isFinite(Number(upper)) ||
      Number(lower) > Number(upper)
    ) {
      setMessage("Enter valid lower and upper tolerances.");
      return;
    }
    setBusy(true);
    setMessage("");
    setProgress(0);
    setResult(null);
    const current = new Worker(
      new URL("../workers/asBuilt.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = current;
    current.onmessage = (event) => {
      if (worker.current !== current) return;
      const data = event.data;
      if (data.type === "progress") setProgress(data.percent);
      else {
        setBusy(false);
        current.terminate();
        worker.current = null;
        if (data.type === "result") {
          setResult(data.result);
          setCalculatedAt(new Date().toISOString());
          setPage(0);
        } else setMessage(data.message);
      }
    };
    current.onerror = (event) => {
      if (worker.current === current) {
        setMessage(
          event.message ||
            "The check stopped unexpectedly. Clip the input files and retry.",
        );
        setBusy(false);
        worker.current = null;
        current.terminate();
      }
    };
    current.postMessage({
      surface,
      inputs,
      catalogue,
      designCrs,
      designHeightScale: heightScales[designHeightUnit],
      heightScales,
      lowerMm: Number(lower),
      upperMm: Number(upper),
    });
  }
  const report = useMemo<SurveyReport | null>(
    () =>
      result && document && surface
        ? {
            title: "As-built vs Design Conformance",
            project: project || document.projectName,
            createdAt: calculatedAt,
            metadata: [
              ["Job / contract", job],
              ["Surveyor", surveyor],
              ["Design file", document.fileName],
              ["Design surface", surface.name],
              ["Design CRS", `${designCrs} · ${crs?.name ?? ""}`],
              ["Grid units", crs?.unit ?? ""],
              ["Design height units", designHeightUnit],
              ["Vertical datum (both inputs, user confirmed)", heightDatum],
              [
                "Point files and input CRSs",
                inputs
                  .map(
                    (input) =>
                      `${input.layer.name}: ${input.sourceCrs}, heights ${input.heightUnit}`,
                  )
                  .join("; "),
              ],
              ["Lower / upper tolerance (mm)", `${lower} / ${upper}`],
            ],
            summary: [
              ["Total valid input points", result.rows.length],
              ...(Object.entries(result.counts) as Array<[string, number]>),
              ["Minimum difference (mm)", result.minimumMm],
              ["Maximum difference (mm)", result.maximumMm],
              ["Mean difference (mm)", result.meanMm],
              ["RMS difference (mm)", result.rmsMm],
            ],
            columns: [
              "Point ID",
              "Source file",
              "Code",
              "Source X",
              "Source Y",
              "Design E",
              "Design N",
              "Measured RL (m)",
              "Design RL (m)",
              "Measured - design (mm)",
              "Status",
            ],
            rows: result.rows.map((row) => [
              row.id,
              row.file,
              row.code,
              row.sourceEasting,
              row.sourceNorthing,
              row.easting,
              row.northing,
              row.measuredLevelM,
              row.designLevelM,
              row.differenceMm,
              row.status,
            ]),
            notes: [
              "Method: barycentric interpolation inside the original TIN triangles. No extrapolation across holes or outside the TIN. Tolerance limits are inclusive. Unassessed points are not passes.",
              "Horizontal coordinates use the design grid. RL values are expressed in metres for the report; source vertical datum is unchanged. RMS/mean/min/max include assessed points only.",
              ...document.warnings,
              ...result.warnings,
              ...(notes ? [notes] : []),
            ],
            plot: {
              points: result.rows.map((row) => ({
                easting: row.easting,
                northing: row.northing,
                colour: statusColours[row.status],
              })),
              legend: statusColours,
            },
          }
        : null,
    [
      result,
      document,
      surface,
      project,
      job,
      surveyor,
      calculatedAt,
      designCrs,
      crs,
      designHeightUnit,
      heightDatum,
      inputs,
      lower,
      upper,
      notes,
    ],
  );
  const geometry = useMemo<SurveyGeometryLayer | null>(
    () =>
      result
        ? {
            name: "As-built conformance",
            format: "CSV",
            warnings: [],
            lines: [],
            polygons: [],
            pointColours: statusColours,
            points: result.rows
              .filter((row) =>
                [row.easting, row.northing, row.measuredLevelM].every(
                  Number.isFinite,
                ),
              )
              .map((row) => ({
                id: `${row.id} · ${format(row.differenceMm, 2)} mm`,
                easting: row.easting,
                northing: row.northing,
                elevation: row.measuredLevelM,
                code: row.status,
              })),
          }
        : null,
    [result],
  );
  const filtered = useMemo(
    () =>
      result?.rows.filter((row) => filter === "ALL" || row.status === filter) ??
      [],
    [result, filter],
  );
  const state = {
    document,
    inputs,
    surfaceIndex,
    designCrs,
    designHeightUnit,
    lower,
    upper,
    heightDatum,
    confirmed,
    project,
    job,
    surveyor,
    notes,
    basemap,
  };
  function restore(value: Record<string, unknown>) {
    if (value.document !== null) assertDocument(value.document);
    if (!Array.isArray(value.inputs) || value.inputs.length > 100)
      throw new Error("Invalid saved point inputs.");
    const next = value.inputs.map((raw) => {
      const input = record(raw);
      assertPointLayer(input.layer);
      if (
        typeof input.id !== "string" ||
        typeof input.sourceCrs !== "string" ||
        typeof input.heightUnit !== "string" ||
        !heightScales[input.heightUnit]
      )
        throw new Error("Invalid saved point settings.");
      return input as CheckInput;
    });
    const doc = value.document as LandXmlDocument | null,
      index = Number(value.surfaceIndex);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      (doc && index >= doc.surfaces.length)
    )
      throw new Error("The saved design surface is missing.");
    for (const key of [
      "designCrs",
      "designHeightUnit",
      "lower",
      "upper",
      "heightDatum",
      "project",
      "job",
      "surveyor",
      "notes",
    ])
      if (
        typeof value[key] !== "string" ||
        (value[key] as string).length > 10000
      )
        throw new Error("Invalid saved check settings.");
    if (
      !heightScales[value.designHeightUnit as string] ||
      !["street", "aerial", "none"].includes(String(value.basemap))
    )
      throw new Error("Invalid saved unit or map settings.");
    setDocument(doc);
    setInputs(next);
    setSurfaceIndex(index);
    setDesignCrs(value.designCrs as string);
    setDesignHeightUnit(value.designHeightUnit as string);
    setLower(value.lower as string);
    setUpper(value.upper as string);
    setHeightDatum(value.heightDatum as string);
    setConfirmed(value.confirmed === true);
    setProject(value.project as string);
    setJob(value.job as string);
    setSurveyor(value.surveyor as string);
    setNotes(value.notes as string);
    setBasemap(value.basemap as Basemap);
    setResult(null);
  }
  return (
    <div className="relative z-10 mx-auto min-h-screen max-w-7xl px-5 py-16 md:px-8">
      <PageSeo
        title="As-built vs Design Surface Check | SurveyTool.io"
        description="Compare measured CSV, TXT and DXF points against a LandXML design TIN, apply tolerances and download PDF, Excel and CSV conformance reports."
        canonicalUrl="https://www.surveytool.io/tools/as-built-check"
      />
      <Link to="/" className="text-sm text-cyan-300">
        ← SurveyTool
      </Link>
      <p className="mt-7 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">
        Survey checks
      </p>
      <h1 className="mt-3 text-4xl font-bold md:text-5xl">
        As-built vs Design
      </h1>
      <p className="mt-4 max-w-3xl leading-7 text-slate-400">
        Check every measured point against the design TIN. See high, low and
        passing levels, flag points outside the surface, and export a traceable
        report.
      </p>
      <ProjectPanel
        tool="asbuilt"
        state={state}
        onRestore={restore}
        disabled={busy || reading}
      />
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || reading}
          onClick={() => designFile.current?.click()}
          className="rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950"
        >
          {reading ? `Reading… ${progress}%` : "1. Upload design surface (.xml)"}
        </button>
        <button
          type="button"
          disabled={busy || reading}
          onClick={() => pointFiles.current?.click()}
          className="rounded-full border border-white/20 px-5 py-3 text-sm"
        >
          2. Add measured points
        </button>
        <button
          type="button"
          disabled={busy || reading}
          onClick={() => {
            const data = demo();
            setDocument(data.document);
            setInputs(data.inputs);
            setSurfaceIndex(0);
            setDesignCrs("EPSG:2193");
            setDesignHeightUnit("metre");
            setLower("-10");
            setUpper("10");
            setHeightDatum("Demo project datum");
            setConfirmed(true);
            setProject("As-built design check demo");
          }}
          className="rounded-full border border-white/20 px-5 py-3 text-sm text-cyan-200"
        >
          Load demo
        </button>
      </div>
      <input
        ref={designFile}
        type="file"
        accept=".xml,.landxml"
        className="hidden"
        onChange={(event) => {
          void loadDesign(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={pointFiles}
        type="file"
        multiple
        accept=".csv,.txt,.dxf"
        className="hidden"
        onChange={(event) => {
          void loadPoints(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {(catalogueError || coordinateError || message) && (
        <div
          role="alert"
          className="mt-6 rounded-2xl border border-amber-300/25 bg-amber-300/5 p-4 text-sm text-amber-100"
        >
          {catalogueError || coordinateError || message}
          {catalogueError && (
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="ml-3 underline"
            >
              Retry catalogue
            </button>
          )}
        </div>
      )}
      <fieldset
        disabled={busy || reading}
        className="mt-7 space-y-6 disabled:opacity-70"
      >
        <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Design surface and coordinates</h2>
            <button
              type="button"
              onClick={() => designFile.current?.click()}
              className="rounded-full bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950"
            >
              {document ? "Replace design surface" : "Upload design surface"}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {document
              ? `${document.fileName} · ${document.surfaces.length} surfaces · ${surface?.faces.length.toLocaleString() ?? 0} faces`
              : "Upload a LandXML (.xml or .landxml) file containing your design TIN. Its surfaces will appear in the list below."}
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <label className="block text-xs text-slate-300">
                Design surface
                <select
                  aria-label="Design surface"
                  disabled={!document?.surfaces.length}
                  value={surfaceIndex}
                  onChange={(event) =>
                    setSurfaceIndex(Number(event.target.value))
                  }
                  className={`${field} mt-1`}
                >
                  {!document && <option value={0}>Upload the design XML first</option>}
                  {document?.surfaces.map((item, index) => (
                    <option key={index} value={index}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-300">
                Design height units
                <select
                  value={designHeightUnit}
                  onChange={(event) => setDesignHeightUnit(event.target.value)}
                  className={`${field} mt-1`}
                >
                  {Object.keys(heightScales).map((unit) => (
                    <option key={unit}>{unit}</option>
                  ))}
                </select>
              </label>
            </div>
            <CrsPicker
              label="Design"
              value={designCrs}
              onChange={setDesignCrs}
              catalogue={catalogue}
              loading={!catalogue.length && !catalogueError}
              allowLocal={false}
              showMapNote={false}
              note="Use the actual projected grid of the design TIN. Metadata is read when available."
            />
          </div>
        </section>
        {inputs.map((input) => (
          <section
            key={input.id}
            className="rounded-3xl border border-white/10 bg-white/5 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{input.layer.name}</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {input.layer.points.length.toLocaleString()} measured points
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setInputs((all) => all.filter((item) => item.id !== input.id))
                }
                className="text-xs text-rose-200"
              >
                Remove
              </button>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <label className="block text-xs text-slate-300">
                  Measured height units
                  <select
                    value={input.heightUnit}
                    onChange={(event) =>
                      setInputs((all) =>
                        all.map((item) =>
                          item.id === input.id
                            ? { ...item, heightUnit: event.target.value }
                            : item,
                        ),
                      )
                    }
                    className={`${field} mt-1`}
                  >
                    {Object.keys(heightScales).map((unit) => (
                      <option key={unit}>{unit}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!designCrs}
                  onClick={() =>
                    setInputs((all) =>
                      all.map((item) =>
                        item.id === input.id
                          ? { ...item, sourceCrs: designCrs }
                          : item,
                      ),
                    )
                  }
                  className="mt-3 rounded-full border border-cyan-300/30 px-4 py-2 text-xs text-cyan-200 disabled:opacity-40"
                >
                  Use design CRS for this file
                </button>
                {input.layer.warnings.map((warning, i) => (
                  <p key={i} className="mt-2 text-xs text-amber-200">
                    {warning}
                  </p>
                ))}
              </div>
              <CrsPicker
                label={input.layer.name}
                value={input.sourceCrs}
                onChange={(sourceCrs) =>
                  setInputs((all) =>
                    all.map((item) =>
                      item.id === input.id ? { ...item, sourceCrs } : item,
                    ),
                  )
                }
                catalogue={catalogue}
                loading={!catalogue.length && !catalogueError}
                allowLocal={false}
                showMapNote={false}
                note="Choose this point file’s actual CRS. Supported horizontal reprojection is applied before sampling the design TIN."
              />
            </div>
          </section>
        ))}
        <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <h2 className="font-semibold">Tolerances and report details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { label: "Lower tolerance (mm)", value: lower, set: setLower },
              { label: "Upper tolerance (mm)", value: upper, set: setUpper },
              {
                label: "Common vertical datum",
                value: heightDatum,
                set: setHeightDatum,
              },
              { label: "Project name", value: project, set: setProject },
              { label: "Job / contract", value: job, set: setJob },
              { label: "Surveyor", value: surveyor, set: setSurveyor },
            ].map((item) => (
              <label key={item.label} className="block text-xs text-slate-300">
                {item.label}
                <input
                  aria-label={item.label}
                  value={item.value}
                  onChange={(event) => item.set(event.target.value)}
                  maxLength={200}
                  className={`${field} mt-1`}
                />
              </label>
            ))}
          </div>
          <label className="mt-4 block text-xs text-slate-300">
            Report notes
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={5000}
              className={`${field} mt-1`}
              rows={2}
            />
          </label>
          <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-amber-100">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-1.5"
            />
            I confirm the point files contain measured levels and all
            design/measured heights use the common vertical datum stated above.
            Height units are set separately; vertical datums are not
            transformed.
          </label>
          <p className="mt-3 text-xs text-slate-400">
            Difference = measured RL − design RL. Lower and upper limits are
            inclusive. Original TIN holes are retained; no nearest-point or
            boundary extrapolation is used.
          </p>
        </section>
      </fieldset>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          disabled={!ready || busy || reading}
          onClick={run}
          className="rounded-full bg-cyan-300 px-6 py-3 text-sm font-bold text-slate-950 disabled:opacity-40"
        >
          {busy
            ? `Checking… ${progress}%`
            : `Check ${total.toLocaleString()} points`}
        </button>
        {busy && (
          <button
            type="button"
            onClick={() => {
              worker.current?.terminate();
              worker.current = null;
              setBusy(false);
              setMessage("Check cancelled. No report was created.");
            }}
            className="text-sm text-rose-200"
          >
            Cancel check
          </button>
        )}
        <p className="text-xs text-slate-400">
          Choose every file’s CRS and confirm the heights before running.
        </p>
      </div>
      {result && (
        <section className="mt-10 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">Check results</h2>
              <p className="mt-1 text-xs text-slate-400">
                {result.rows.length.toLocaleString()} points checked ·{" "}
                {new Date(calculatedAt).toLocaleString()}
              </p>
            </div>
            <ReportDownloads report={report} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {statuses.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => {
                  setFilter(status);
                  setPage(0);
                }}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left"
              >
                <p className="text-xs" style={{ color: statusColours[status] }}>
                  {status.replaceAll("_", " ")}
                </p>
                <p className="mt-2 text-2xl font-bold">
                  {result.counts[status].toLocaleString()}
                </p>
              </button>
            ))}
          </div>
          <p className="text-sm text-slate-400">
            Assessed points: mean {format(result.meanMm, 2)} mm · RMS{" "}
            {format(result.rmsMm, 2)} mm · range {format(result.minimumMm, 2)}{" "}
            to {format(result.maximumMm, 2)} mm. Outside, missing-level,
            ambiguous and invalid points are unassessed.
          </p>
          {result.warnings.map((warning, i) => (
            <p key={i} className="text-xs text-amber-200">
              {warning}
            </p>
          ))}
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <h3 className="font-semibold">Results map</h3>
              <label className="text-xs text-slate-300">
                Background
                <select
                  value={basemap}
                  onChange={(event) =>
                    setBasemap(event.target.value as Basemap)
                  }
                  className={`${field} mt-1`}
                >
                  <option value="street">Street map</option>
                  <option value="aerial">Aerial / satellite</option>
                  <option value="none">Design-grid plan</option>
                </select>
              </label>
            </div>
            {basemap !== "none" && crs && geometry ? (
              <Suspense
                fallback={
                  <p className="text-sm text-slate-400">Loading map…</p>
                }
              >
                <SurveyMap
                  crs={crs}
                  geometry={geometry}
                  geometryContext="survey"
                  basemap={basemap}
                  opacity={90}
                  heightUnitLabel="m (measured)"
                  fallback={<Plan result={result} />}
                />
              </Suspense>
            ) : (
              <Plan result={result} />
            )}
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm">
              Filter
              <select
                aria-label="Result status filter"
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setPage(0);
                }}
                className={`${field} ml-2 w-auto`}
              >
                <option value="ALL">All results</option>
                {statuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <span className="text-xs text-slate-400">
              {filtered.length.toLocaleString()} rows · exports always include
              the full dataset
            </span>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-white/5 text-slate-400">
                <tr>
                  {[
                    "Point / source",
                    "Design E",
                    "Design N",
                    "Measured RL (m)",
                    "Design RL (m)",
                    "Difference (mm)",
                    "Status",
                  ].map((head) => (
                    <th key={head} className="p-3">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(page * 50, page * 50 + 50).map((row, i) => (
                  <tr key={`${page}-${i}`} className="border-t border-white/5">
                    <td className="p-3">
                      {row.id}
                      <span className="mt-1 block text-slate-500">
                        {row.file} · {row.code}
                      </span>
                    </td>
                    <td className="p-3">{format(row.easting)}</td>
                    <td className="p-3">{format(row.northing)}</td>
                    <td className="p-3">{format(row.measuredLevelM, 4)}</td>
                    <td className="p-3">{format(row.designLevelM, 4)}</td>
                    <td className="p-3">{format(row.differenceMm, 2)}</td>
                    <td
                      className="p-3"
                      style={{ color: statusColours[row.status] }}
                    >
                      {row.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="disabled:opacity-30"
            >
              Previous
            </button>
            <span>
              Page {page + 1} / {Math.max(1, Math.ceil(filtered.length / 50))}
            </span>
            <button
              type="button"
              disabled={(page + 1) * 50 >= filtered.length}
              onClick={() => setPage((p) => p + 1)}
              className="disabled:opacity-30"
            >
              Next
            </button>
          </div>
          <p className="text-xs text-slate-500">
            PDF contains the summary, plan and up to 2,000 appendix rows. CSV
            contains every result; Excel supports up to 100,000 result rows.
          </p>
        </section>
      )}
    </div>
  );
}
