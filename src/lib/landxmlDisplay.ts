import type { LandXmlSurface } from "./landxml";
import type { TerrainMesh } from "./contourTerrain";

export type DisplaySurface = {
  name: string;
  positions: Float64Array;
  indices: Uint32Array;
  bands: Uint8Array;
  minZ: number;
  maxZ: number;
  rejectedFaces: number;
};

// Shared by the plan and map renderers. Every valid face is retained.
export function prepareDisplaySurface(
  surface: LandXmlSurface,
  project: (e: number, n: number) => [number, number] = (e, n) => [e, n],
): DisplaySurface {
  const ids = new Map<string, number>();
  const positions: number[] = [];
  let minZ = Infinity,
    maxZ = -Infinity;
  for (const [id, p] of Object.entries(surface.points)) {
    if (!Number.isFinite(p.easting) || !Number.isFinite(p.northing)) continue;
    const [x, y] = project(p.easting, p.northing);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const z =
      p.elevation !== null && Number.isFinite(p.elevation) ? p.elevation : NaN;
    ids.set(id, positions.length / 3);
    positions.push(x, y, z);
    if (Number.isFinite(z)) {
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  const indices: number[] = [],
    bands: number[] = [];
  let rejectedFaces = 0;
  for (const face of surface.faces) {
    const a = ids.get(face[0]),
      b = ids.get(face[1]),
      c = ids.get(face[2]);
    if (a === undefined || b === undefined || c === undefined) {
      rejectedFaces++;
      continue;
    }
    const cross =
      (positions[b * 3] - positions[a * 3]) *
        (positions[c * 3 + 1] - positions[a * 3 + 1]) -
      (positions[b * 3 + 1] - positions[a * 3 + 1]) *
        (positions[c * 3] - positions[a * 3]);
    if (cross === 0 || !Number.isFinite(cross)) {
      rejectedFaces++;
      continue;
    }
    indices.push(a, b, c);
    const z =
      (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3;
    bands.push(
      Number.isFinite(z)
        ? Math.min(
            254,
            Math.max(0, Math.floor(((z - minZ) / (maxZ - minZ || 1)) * 254)),
          )
        : 255,
    );
  }
  return {
    name: surface.name,
    positions: new Float64Array(positions),
    indices: new Uint32Array(indices),
    bands: new Uint8Array(bands),
    minZ,
    maxZ,
    rejectedFaces,
  };
}

export function elevationColour(ratio: number) {
  const stops = [
    [37, 99, 235],
    [6, 182, 212],
    [132, 204, 22],
    [251, 191, 36],
  ];
  const t = Math.max(0, Math.min(1, ratio)) * 3;
  const i = Math.min(2, Math.floor(t)),
    f = t - i;
  return (
    "rgb(" +
    stops[i]
      .map((v, c) => Math.round(v + (stops[i + 1][c] - v) * f))
      .join(",") +
    ")"
  );
}

// Source coordinates are retained in double precision; only the renderer normalises them.
export function landXmlTerrainMesh(surface: LandXmlSurface): TerrainMesh {
  const prepared = prepareDisplaySurface(surface);
  const vertices: TerrainMesh["vertices"] = [],
    faces: TerrainMesh["faces"] = [];
  const remap = new Map<number, number>();
  let area = 0,
    minZ = Infinity,
    maxZ = -Infinity,
    missing = 0;
  for (let f = 0; f < prepared.indices.length; f += 3) {
    const original = Array.from(prepared.indices.subarray(f, f + 3));
    if (original.some((i) => !Number.isFinite(prepared.positions[i * 3 + 2]))) {
      missing++;
      continue;
    }
    const face = original.map((i) => {
      let index = remap.get(i);
      if (index === undefined) {
        index = vertices.length;
        remap.set(i, index);
        const x = prepared.positions[i * 3],
          y = prepared.positions[i * 3 + 1],
          z = prepared.positions[i * 3 + 2];
        vertices.push([x, y, z]);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      return index;
    }) as [number, number, number];
    const [a, b, c] = face.map((i) => vertices[i]);
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cross < 0) [face[1], face[2]] = [face[2], face[1]];
    area += Math.abs(cross) / 2;
    faces.push(face);
  }
  if (!faces.length)
    throw new Error(
      "This surface has no triangles with readable elevations. Its plan view remains available.",
    );
  return {
    vertices,
    faces,
    area,
    minZ,
    maxZ,
    contourCount: 0,
    warnings: [
      missing
        ? missing.toLocaleString() +
          " faces without elevations are available in plan view only."
        : "",
      prepared.rejectedFaces
        ? prepared.rejectedFaces.toLocaleString() +
          " invalid or degenerate faces were excluded."
        : "",
    ].filter(Boolean),
  };
}
