import cdt2d from "cdt2d";
import intersects from "robust-segment-intersect";
import earcut from "earcut";
import polygonClipping from "polygon-clipping";
import { parseSurveyGeometryFile } from "./surveyGeometry";
import type { LandXmlDocument } from "./landxml";

export type XY = [number, number];
export type TerrainVertex = [number, number, number];
export type TerrainUnits = "meter" | "millimeter" | "foot" | "USSurveyFoot";
export type ContourPath = {
  id: string;
  layer: string;
  vertices: XY[];
  closed: boolean;
  elevation: number | null;
  enabled: boolean;
};
export type TerrainInput = {
  fileName: string;
  paths: ContourPath[];
  warnings: string[];
  units: TerrainUnits | "";
};
export type TerrainSettings = {
  name: string;
  units: TerrainUnits | "";
  crs: string;
  verticalDatum: string;
  boundaryId: string;
  spacing: number;
};
export type TerrainMesh = {
  vertices: TerrainVertex[];
  faces: [number, number, number][];
  area: number;
  minZ: number;
  maxZ: number;
  contourCount: number;
  warnings: string[];
};
export const maximumTerrainVertices = 30_000;
const maxFileBytes = 50 * 1024 * 1024;
const cross = (a: number[], b: number[], c: number[]) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

export async function readContourFile(file: File): Promise<TerrainInput> {
  if (!file.name.toLowerCase().endsWith(".dxf"))
    throw new Error(
      "This version reads ASCII DXF contours. Export your DWG as ASCII DXF first; PDF reconstruction is planned separately.",
    );
  if (file.size > maxFileBytes)
    throw new Error(
      "Choose a DXF smaller than 50 MB, or export only the contour layers.",
    );
  const text = await file.text();
  const geometry = await parseSurveyGeometryFile({
    name: file.name,
    text: async () => text,
  } as File);
  const paths: ContourPath[] = [];
  function add(
    id: string,
    layer: string,
    source: { easting: number; northing: number; elevation: number }[],
    closed: boolean,
  ) {
    const vertices: XY[] = [];
    for (const point of source) {
      const last = vertices.at(-1);
      if (!last || point.easting !== last[0] || point.northing !== last[1])
        vertices.push([point.easting, point.northing]);
    }
    if (
      closed &&
      vertices.length > 1 &&
      vertices[0][0] === vertices.at(-1)![0] &&
      vertices[0][1] === vertices.at(-1)![1]
    )
      vertices.pop();
    if (vertices.length < (closed ? 3 : 2)) return;
    const z = source[0].elevation;
    const constant = source.every((p) => Math.abs(p.elevation - z) < 1e-7);
    // A missing CAD elevation also reads as zero. Never infer a surveyed zero height.
    paths.push({
      id: `${paths.length + 1}-${id}`,
      layer: layer || "0",
      vertices,
      closed,
      elevation: constant && z !== 0 ? z : null,
      enabled: true,
    });
  }
  geometry.lines.forEach((p) => add(p.id, p.code, p.vertices, false));
  geometry.polygons.forEach((p) =>
    p.rings.forEach((ring, i) => add(`${p.id}-${i}`, p.code, ring, true)),
  );
  if (!paths.length)
    throw new Error(
      "No straight model-space contour polylines or lines were found. Convert curves to straight polylines before export.",
    );
  const rawUnits = text.match(/\$INSUNITS\s*\r?\n\s*70\s*\r?\n\s*(\d+)/)?.[1];
  const unitMap: Record<string, TerrainUnits> = {
    "2": "foot",
    "4": "millimeter",
    "6": "meter",
    "21": "USSurveyFoot",
  };
  const warnings = [...geometry.warnings];
  const missing = paths.filter((p) => p.elevation === null).length;
  if (missing)
    warnings.push(
      `${missing} path(s) have zero, missing or varying CAD heights. Assign their contour heights or exclude them before generating.`,
    );
  return {
    fileName: file.name,
    paths,
    warnings,
    units: unitMap[rawUnits ?? ""] ?? "",
  };
}

export function assertTerrainInput(
  value: unknown,
): asserts value is TerrainInput {
  const data = value as TerrainInput | null;
  if (
    !data ||
    typeof data.fileName !== "string" ||
    !Array.isArray(data.paths) ||
    data.paths.length > 100_000 ||
    !Array.isArray(data.warnings) ||
    data.warnings.some((x) => typeof x !== "string")
  )
    throw new Error("Invalid saved terrain source.");
  let count = 0;
  const ids = new Set<string>();
  for (const p of data.paths) {
    if (
      typeof p.id !== "string" ||
      ids.has(p.id) ||
      typeof p.layer !== "string" ||
      typeof p.closed !== "boolean" ||
      typeof p.enabled !== "boolean" ||
      (p.elevation !== null && !Number.isFinite(p.elevation)) ||
      !Array.isArray(p.vertices) ||
      p.vertices.length < (p.closed ? 3 : 2)
    )
      throw new Error("Invalid saved contour.");
    ids.add(p.id);
    count += p.vertices.length;
    if (
      count > 2_000_000 ||
      p.vertices.some(
        (v) => !Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite),
      )
    )
      throw new Error(
        "Invalid saved contour coordinates or excessive vertex count.",
      );
  }
}

export function assertTerrainSettings(
  value: unknown,
): asserts value is TerrainSettings {
  const s = value as TerrainSettings | null;
  if (
    !s ||
    !["name", "crs", "verticalDatum", "boundaryId"].every(
      (k) =>
        typeof s[k as keyof TerrainSettings] === "string" &&
        String(s[k as keyof TerrainSettings]).length <= 200,
    ) ||
    !["", "meter", "millimeter", "foot", "USSurveyFoot"].includes(s.units) ||
    !Number.isFinite(s.spacing) ||
    s.spacing < 0
  )
    throw new Error("Invalid saved terrain settings.");
}

type Edge = [number, number];
function validateEdges(points: XY[], edges: Edge[]) {
  // Spatial buckets avoid comparing every pair of segments on large contour sets.
  const dimension = Math.max(
    8,
    Math.min(160, Math.ceil(Math.sqrt(edges.length))),
  );
  const buckets = new Map<string, number[]>();
  let checks = 0;
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i],
      p = points[a],
      q = points[b];
    const minX = Math.floor(Math.min(p[0], q[0]) * dimension),
      maxX = Math.floor(Math.max(p[0], q[0]) * dimension);
    const minY = Math.floor(Math.min(p[1], q[1]) * dimension),
      maxY = Math.floor(Math.max(p[1], q[1]) * dimension);
    const seen = new Set<number>();
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++) {
        const key = `${x}:${y}`,
          previous = buckets.get(key) ?? [];
        for (const j of previous) {
          if (seen.has(j)) continue;
          seen.add(j);
          if (++checks > 4_000_000)
            throw new Error(
              "Contour geometry is too complex to validate. Export a smaller area or fewer layers.",
            );
          const [c, d] = edges[j];
          const shared = a === c || a === d ? a : b === c || b === d ? b : -1;
          if (shared >= 0) {
            const s = points[shared],
              u = points[a === shared ? b : a],
              v = points[c === shared ? d : c];
            if (
              Math.abs(cross(s, u, v)) < 1e-14 &&
              (u[0] - s[0]) * (v[0] - s[0]) + (u[1] - s[1]) * (v[1] - s[1]) > 0
            )
              throw new Error(
                "Overlapping contour segments were found. Clean or exclude duplicate/overlapping linework.",
              );
          } else if (intersects(p, q, points[c], points[d]))
            throw new Error(
              "Contours cross, self-intersect or form an unsplit junction. Correct the linework or exclude the affected paths before generating.",
            );
        }
        previous.push(i);
        buckets.set(key, previous);
      }
  }
}

export function buildContourTerrain(
  input: TerrainInput,
  settings: TerrainSettings,
): TerrainMesh {
  assertTerrainInput(input);
  assertTerrainSettings(settings);
  if (!settings.units)
    throw new Error("Confirm the source drawing units first.");
  const paths = input.paths.filter(
    (p) => p.enabled && p.id !== settings.boundaryId,
  );
  if (!paths.length) throw new Error("Select at least one contour path.");
  if (paths.some((p) => p.elevation === null))
    throw new Error(
      "Assign a height to every selected contour, or exclude the unassigned paths.",
    );
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  paths.forEach((p) =>
    p.vertices.forEach((v) => {
      minX = Math.min(minX, v[0]);
      minY = Math.min(minY, v[1]);
      maxX = Math.max(maxX, v[0]);
      maxY = Math.max(maxY, v[1]);
    }),
  );
  const span = Math.max(maxX - minX, maxY - minY);
  if (!Number.isFinite(span) || span <= 0)
    throw new Error("The selected contours have no usable plan extent.");
  const points: XY[] = [],
    vertices: TerrainVertex[] = [],
    edges: Edge[] = [],
    index = new Map<string, number>(),
    edgeKeys = new Set<string>();
  function vertex(x: number, y: number, z: number) {
    const p: XY = [(x - minX) / span, (y - minY) / span],
      key = `${Math.round(p[0] * 1e10)}:${Math.round(p[1] * 1e10)}`;
    const old = index.get(key);
    if (old !== undefined) {
      if (Math.abs(vertices[old][2] - z) > 1e-6)
        throw new Error(
          "Different contour elevations occupy the same plan position. Check their assigned heights and geometry.",
        );
      return old;
    }
    if (points.length >= maximumTerrainVertices)
      throw new Error(
        `The model exceeds ${maximumTerrainVertices.toLocaleString()} vertices. Use fewer layers, a smaller area or less supplementary sampling.`,
      );
    index.set(key, points.length);
    points.push(p);
    vertices.push([x, y, z]);
    return points.length - 1;
  }
  for (const path of paths) {
    const z = path.elevation!,
      n = path.vertices.length,
      segmentCount = path.closed ? n : n - 1;
    for (let j = 0; j < segmentCount; j++) {
      const a = path.vertices[j],
        b = path.vertices[(j + 1) % n],
        distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps =
        settings.spacing > 0
          ? Math.max(1, Math.ceil(distance / settings.spacing))
          : 1;
      if (steps > maximumTerrainVertices)
        throw new Error(
          "Supplementary spacing is too small for this drawing. Increase it or use 0 to keep the original vertices.",
        );
      let previous = vertex(a[0], a[1], z);
      for (let k = 1; k <= steps; k++) {
        const next = vertex(
          a[0] + ((b[0] - a[0]) * k) / steps,
          a[1] + ((b[1] - a[1]) * k) / steps,
          z,
        );
        if (next !== previous) {
          const key =
            previous < next ? `${previous}:${next}` : `${next}:${previous}`;
          if (!edgeKeys.has(key)) {
            edges.push([previous, next]);
            edgeKeys.add(key);
          }
        }
        previous = next;
      }
    }
  }
  if (points.length < 3)
    throw new Error(
      "At least three non-collinear contour vertices are needed.",
    );
  validateEdges(points, edges);
  const raw = cdt2d(points, edges, {
    delaunay: true,
    interior: true,
    exterior: true,
    infinity: false,
  });
  let faces: [number, number, number][] = raw
    .filter(
      (f) =>
        f.length === 3 &&
        f.every((i) => i >= 0) &&
        Math.abs(cross(points[f[0]], points[f[1]], points[f[2]])) > 1e-14,
    )
    .map((f) =>
      cross(points[f[0]], points[f[1]], points[f[2]]) > 0
        ? [f[0], f[1], f[2]]
        : [f[0], f[2], f[1]],
    );
  if (!faces.length)
    throw new Error(
      "No surface could be formed. The vertices may be collinear; add contours covering an area.",
    );
  const warnings = [
    "This surface interpolates between reviewed contours; features and detail absent from the source cannot be recovered.",
  ];
  if (new Set(paths.map((p) => p.elevation)).size === 1)
    warnings.push(
      "All selected contours share one elevation: the generated surface is flat.",
    );
  if (!settings.boundaryId)
    warnings.push(
      "The surface uses the convex hull of the selected contours. Choose a closed boundary to trim bridges across gaps or concave edges.",
    );
  if (settings.boundaryId) {
    const boundary = input.paths.find((p) => p.id === settings.boundaryId);
    if (!boundary?.closed || boundary.vertices.length < 3)
      throw new Error("Choose a closed polyline as the clipping boundary.");
    if (boundary.vertices.length > 10_000)
      throw new Error(
        "Simplify the clipping boundary to fewer than 10,000 vertices.",
      );
    const ring: XY[] = boundary.vertices.map((v) => [
      (v[0] - minX) / span,
      (v[1] - minY) / span,
    ]);
    const bx = Math.min(...ring.map((p) => p[0])),
      by = Math.min(...ring.map((p) => p[1])),
      bs = Math.max(
        Math.max(...ring.map((p) => p[0])) - bx,
        Math.max(...ring.map((p) => p[1])) - by,
      );
    if (bs <= 0) throw new Error("The clipping boundary has no area.");
    validateEdges(
      ring.map((p) => [(p[0] - bx) / bs, (p[1] - by) / bs]),
      ring.map((_, i) => [i, (i + 1) % ring.length]),
    );
    const clippedVertices: TerrainVertex[] = [],
      clippedFaces: [number, number, number][] = [],
      clippedIndex = new Map<string, number>();
    const minBX = Math.min(...ring.map((p) => p[0])),
      maxBX = Math.max(...ring.map((p) => p[0])),
      minBY = Math.min(...ring.map((p) => p[1])),
      maxBY = Math.max(...ring.map((p) => p[1]));
    for (const face of faces) {
      const a = points[face[0]],
        b = points[face[1]],
        c = points[face[2]];
      if (
        Math.max(a[0], b[0], c[0]) < minBX ||
        Math.min(a[0], b[0], c[0]) > maxBX ||
        Math.max(a[1], b[1], c[1]) < minBY ||
        Math.min(a[1], b[1], c[1]) > maxBY
      )
        continue;
      const polygons = polygonClipping.intersection(
        [[a, b, c, a]],
        [[...ring, ring[0]]],
      );
      const denominator = cross(a, b, c);
      for (const polygon of polygons) {
        const flattened: number[] = [],
          holes: number[] = [];
        polygon.forEach((r, i) => {
          if (i) holes.push(flattened.length / 2);
          for (const p of r.slice(0, -1)) flattened.push(p[0], p[1]);
        });
        const localIndices: number[] = [];
        for (let k = 0; k < flattened.length; k += 2) {
          const p: XY = [flattened[k], flattened[k + 1]],
            wa = cross(p, b, c) / denominator,
            wb = cross(a, p, c) / denominator;
          const z =
            wa * vertices[face[0]][2] +
            wb * vertices[face[1]][2] +
            (1 - wa - wb) * vertices[face[2]][2];
          const key = `${Math.round(p[0] * 1e10)}:${Math.round(p[1] * 1e10)}`;
          let id = clippedIndex.get(key);
          if (id === undefined) {
            id = clippedVertices.length;
            clippedIndex.set(key, id);
            clippedVertices.push([minX + p[0] * span, minY + p[1] * span, z]);
          }
          localIndices.push(id);
        }
        const triangles = earcut(flattened, holes);
        for (let k = 0; k < triangles.length; k += 3) {
          const f: [number, number, number] = [
            localIndices[triangles[k]],
            localIndices[triangles[k + 1]],
            localIndices[triangles[k + 2]],
          ];
          const area = cross(
            clippedVertices[f[0]],
            clippedVertices[f[1]],
            clippedVertices[f[2]],
          );
          if (Math.abs(area) <= span * span * 1e-14) continue;
          clippedFaces.push(area > 0 ? f : [f[0], f[2], f[1]]);
        }
      }
    }
    if (!clippedFaces.length)
      throw new Error("The boundary does not overlap the contour coverage.");
    if (clippedVertices.length > maximumTerrainVertices * 3)
      throw new Error(
        "Boundary clipping produced too many vertices. Simplify the boundary or reduce the area.",
      );
    vertices.length = 0;
    for (const v of clippedVertices) vertices.push(v);
    faces = clippedFaces;
    warnings.push(
      "The boundary clips existing coverage only; it does not extrapolate terrain outside the contour hull.",
    );
  }
  const used = new Set(faces.flat()),
    remap = new Map<number, number>(),
    compact: TerrainVertex[] = [];
  used.forEach((id) => {
    remap.set(id, compact.length);
    compact.push(vertices[id]);
  });
  faces = faces.map(
    (f) => f.map((i) => remap.get(i)!) as [number, number, number],
  );
  let area = 0,
    minZ = Infinity,
    maxZ = -Infinity;
  faces.forEach((f) => {
    area += Math.abs(cross(compact[f[0]], compact[f[1]], compact[f[2]])) / 2;
  });
  compact.forEach((v) => {
    minZ = Math.min(minZ, v[2]);
    maxZ = Math.max(maxZ, v[2]);
  });
  return {
    vertices: compact,
    faces,
    area,
    minZ,
    maxZ,
    contourCount: paths.length,
    warnings,
  };
}

const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function terrainDocument(
  mesh: TerrainMesh,
  settings: TerrainSettings,
): LandXmlDocument {
  const points = Object.fromEntries(
    mesh.vertices.map((p, i) => [
      String(i + 1),
      { easting: p[0], northing: p[1], elevation: p[2] },
    ]),
  );
  const crs = settings.crs.trim(),
    epsg = crs.match(/^EPSG:(\d{4,6})$/i)?.[1];
  return {
    fileName: `${settings.name || "terrain"}.xml`,
    version: "1.2",
    projectName: settings.name || "Contour terrain",
    applicationName: "SurveyTool.io",
    units: settings.units,
    coordinateSystem: crs
      ? { name: crs, ...(epsg ? { epsgCode: epsg } : {}) }
      : undefined,
    surfaces: [
      {
        name: settings.name || "Contour terrain",
        points,
        faces: mesh.faces.map(
          (f) => f.map((i) => String(i + 1)) as [string, string, string],
        ),
        minElevation: mesh.minZ,
        maxElevation: mesh.maxZ,
        hasBoundaryDefinitions: false,
      },
    ],
    alignments: [],
    cogoPoints: [],
    warnings: [
      ...mesh.warnings,
      `Vertical datum: ${settings.verticalDatum.trim() || "Not specified"}. Heights retained in source units.`,
    ],
  };
}

export function terrainLandXml(mesh: TerrainMesh, s: TerrainSettings) {
  const doc = terrainDocument(mesh, s),
    imperial = s.units === "foot" || s.units === "USSurveyFoot",
    epsg = doc.coordinateSystem?.epsgCode;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${new Date().toISOString().slice(0, 10)}">\n<Project name="${xml(doc.projectName)}"/>\n<Units><${imperial ? "Imperial" : "Metric"} linearUnit="${s.units}"/></Units>\n${s.crs ? `<CoordinateSystem name="${xml(s.crs)}"${epsg ? ` epsgCode="${epsg}"` : ""}/>` : ""}\n<Surfaces><Surface name="${xml(doc.projectName)}" desc="${xml(`Interpolated from reviewed contours. Vertical datum: ${s.verticalDatum || "Not specified"}.`)}"><Definition surfType="TIN"><Pnts>\n${mesh.vertices.map((v, i) => `<P id="${i + 1}">${v[1]} ${v[0]} ${v[2]}</P>`).join("\n")}\n</Pnts><Faces>\n${mesh.faces.map((f) => `<F>${f.map((i) => i + 1).join(" ")}</F>`).join("\n")}\n</Faces></Definition></Surface></Surfaces></LandXML>\n`;
}

export function terrainDxf(mesh: TerrainMesh) {
  const out: string[] = [],
    add = (code: number, value: string | number) => {
      out.push(String(code), String(value));
    };
  add(
    999,
    "SurveyTool.io contour-derived TIN. Coordinates and elevations retain source units.",
  );
  add(0, "SECTION");
  add(2, "HEADER");
  add(9, "$ACADVER");
  add(1, "AC1009");
  add(0, "ENDSEC");
  add(0, "SECTION");
  add(2, "TABLES");
  add(0, "TABLE");
  add(2, "LAYER");
  add(70, 1);
  add(0, "LAYER");
  add(2, "TERRAIN_TIN");
  add(70, 0);
  add(62, 3);
  add(6, "CONTINUOUS");
  add(0, "ENDTAB");
  add(0, "ENDSEC");
  add(0, "SECTION");
  add(2, "ENTITIES");
  for (const f of mesh.faces) {
    add(0, "3DFACE");
    add(8, "TERRAIN_TIN");
    [f[0], f[1], f[2], f[2]].forEach((id, k) => {
      const p = mesh.vertices[id];
      add(10 + k, p[0]);
      add(20 + k, p[1]);
      add(30 + k, p[2]);
    });
  }
  add(0, "ENDSEC");
  add(0, "EOF");
  return out.join("\r\n") + "\r\n";
}

export function demoTerrainInput(): TerrainInput {
  return {
    fileName: "Demo hillside.dxf",
    units: "meter",
    warnings: [],
    paths: Array.from({ length: 6 }, (_, i) => ({
      id: `demo-${i}`,
      layer: "CONTOURS",
      closed: false,
      enabled: true,
      elevation: 10 + i * 2,
      vertices: Array.from(
        { length: 9 },
        (_, j) => [1755000 + i * 10, 5923000 + j * 10] as XY,
      ),
    })),
  };
}
