import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  buildContourTerrain,
  demoTerrainInput,
  readContourFile,
  terrainDocument,
  terrainLandXml,
  terrainDxf,
} from "../src/lib/contourTerrain.ts";
import { assertDocument } from "../src/lib/projectWorkspace.ts";
const settings = {
  name: "Terrain & levels",
  units: "meter",
  crs: "EPSG:2193",
  verticalDatum: "NZVD2016",
  boundaryId: "",
  spacing: 0,
};
const source = demoTerrainInput(),
  mesh = buildContourTerrain(source, settings);
assert.ok(mesh.faces.length > 0);
assert.ok(Math.abs(mesh.area - 4000) < 1e-6);
for (const p of mesh.vertices)
  assert.ok(
    Math.abs(p[2] - (10 + (p[0] - 1755000) * 0.2)) < 1e-8,
    "Analytical planar slope must retain true elevations",
  );
const meshEdges = new Set(
  mesh.faces.flatMap((f) =>
    [
      [f[0], f[1]],
      [f[1], f[2]],
      [f[2], f[0]],
    ].map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)),
  ),
);
for (const path of source.paths)
  for (let i = 1; i < path.vertices.length; i++) {
    const ids = [path.vertices[i - 1], path.vertices[i]].map((p) =>
      mesh.vertices.findIndex((v) => v[0] === p[0] && v[1] === p[1]),
    );
    assert.ok(ids.every((i) => i >= 0));
    assert.ok(
      meshEdges.has(
        ids[0] < ids[1] ? ids.join(":") : ids.toReversed().join(":"),
      ),
      "Every contour segment must be a TIN edge",
    );
  }
for (const f of mesh.faces) {
  assert.equal(new Set(f).size, 3);
  const [a, b, c] = f.map((i) => mesh.vertices[i]);
  assert.ok((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0);
}
const more = buildContourTerrain(source, { ...settings, spacing: 5 });
assert.ok(more.vertices.length > mesh.vertices.length);
assert.ok(Math.abs(more.area - 4000) < 1e-6);
const boundary = {
  id: "boundary",
  layer: "BOUNDARY",
  closed: true,
  enabled: true,
  elevation: null,
  vertices: [
    [0, 0],
    [50, 0],
    [50, 30],
    [20, 30],
    [20, 80],
    [0, 80],
  ].map(([x, y]) => [1755000 + x, 5923000 + y]),
};
const clipped = buildContourTerrain(
  { ...source, paths: [...source.paths, boundary] },
  { ...settings, boundaryId: "boundary" },
);
assert.ok(
  Math.abs(clipped.area - 2500) < 1e-5,
  "Concave boundary must clip the exact L-shaped area",
);
for (const p of clipped.vertices)
  assert.ok(Math.abs(p[2] - (10 + (p[0] - 1755000) * 0.2)) < 1e-6);
for (const f of clipped.faces) {
  const p = f.map((i) => clipped.vertices[i]),
    x = p.reduce((s, v) => s + v[0] - 1755000, 0) / 3,
    y = p.reduce((s, v) => s + v[1] - 5923000, 0) / 3;
  assert.ok(
    x <= 20 + 1e-7 || y <= 30 + 1e-7,
    "No triangle may bridge the concave boundary",
  );
}
assert.throws(
  () =>
    buildContourTerrain(
      {
        ...source,
        paths: source.paths.map((p, i) =>
          i === 0 ? { ...p, elevation: null } : p,
        ),
      },
      settings,
    ),
  /Assign a height/,
);
assert.throws(
  () => buildContourTerrain(source, { ...settings, units: "" }),
  /drawing units/,
);
const path = (id, vertices, z) => ({
  id,
  layer: "CONTOUR",
  closed: false,
  enabled: true,
  elevation: z,
  vertices,
});
assert.throws(
  () =>
    buildContourTerrain(
      {
        ...source,
        paths: [
          path(
            "a",
            [
              [0, 0],
              [10, 10],
            ],
            10,
          ),
          path(
            "b",
            [
              [0, 10],
              [10, 0],
            ],
            11,
          ),
        ],
      },
      settings,
    ),
  /cross|intersect/,
);
assert.throws(
  () =>
    buildContourTerrain(
      {
        ...source,
        paths: [
          path(
            "a",
            [
              [0, 0],
              [10, 0],
            ],
            10,
          ),
          path(
            "b",
            [
              [5, 0],
              [5, 10],
            ],
            10,
          ),
        ],
      },
      settings,
    ),
  /junction|cross/,
);
assert.throws(
  () =>
    buildContourTerrain(
      {
        ...source,
        paths: [
          path(
            "a",
            [
              [0, 0],
              [10, 0],
            ],
            10,
          ),
          path(
            "b",
            [
              [0, 0],
              [0, 10],
            ],
            11,
          ),
        ],
      },
      settings,
    ),
  /Different contour elevations/,
);
assert.throws(
  () =>
    buildContourTerrain(
      {
        ...source,
        paths: [
          path(
            "a",
            [
              [0, 0],
              [10, 0],
              [20, 0],
            ],
            10,
          ),
        ],
      },
      settings,
    ),
  /collinear/,
);
assert.throws(
  () =>
    buildContourTerrain(
      {
        ...source,
        paths: [
          ...source.paths,
          {
            ...boundary,
            vertices: boundary.vertices.map(([x, y]) => [x + 10000, y + 10000]),
          },
        ],
      },
      { ...settings, boundaryId: "boundary" },
    ),
  /does not overlap/,
);
const flat = buildContourTerrain(
  { ...source, paths: source.paths.map((p) => ({ ...p, elevation: 0 })) },
  settings,
);
assert.equal(flat.minZ, 0);
assert.equal(flat.maxZ, 0);
assert.ok(flat.warnings.some((s) => s.includes("flat")));
// Independent DXF fixtures exercise actual parsing, height review and paper-space exclusion.
const dxf = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n5\nA\n8\nCONTOURS\n90\n2\n70\n0\n38\n12.5\n10\n1000\n20\n2000\n10\n1010\n20\n2000\n0\nLWPOLYLINE\n5\nB\n8\nZERO\n90\n2\n70\n0\n10\n1000\n20\n2010\n10\n1010\n20\n2010\n0\nLINE\n67\n1\n8\nSHEET\n10\n0\n20\n0\n11\n1\n21\n1\n0\nENDSEC\n0\nEOF\n`;
const parsed = await readContourFile(new File([dxf], "contours.dxf"));
assert.equal(parsed.paths.length, 2);
assert.equal(parsed.units, "meter");
assert.equal(parsed.paths[0].elevation, 12.5);
assert.equal(parsed.paths[1].elevation, null);
assert.ok(parsed.warnings.some((s) => s.includes("paper-space")));
await assert.rejects(
  readContourFile(new File(["AC1032"], "contours.dwg")),
  /ASCII DXF/,
);
const doc = terrainDocument(clipped, settings);
assertDocument(doc);
assert.equal(doc.units, "meter");
assert.equal(doc.coordinateSystem.epsgCode, "2193");
assert.equal(doc.surfaces[0].faces.length, clipped.faces.length);
const xml = terrainLandXml(clipped, settings),
  cad = terrainDxf(clipped);
assert.ok(xml.includes("Terrain &amp; levels"));
assert.ok(xml.includes("NZVD2016"));
assert.equal((cad.match(/\r\n3DFACE\r\n/g) || []).length, clipped.faces.length);
if (process.env.TERRAIN_EXPORT_CHECK) {
  await mkdir(process.env.TERRAIN_EXPORT_CHECK, { recursive: true });
  await writeFile(`${process.env.TERRAIN_EXPORT_CHECK}/terrain.xml`, xml);
  await writeFile(`${process.env.TERRAIN_EXPORT_CHECK}/terrain.dxf`, cad);
  await writeFile(
    `${process.env.TERRAIN_EXPORT_CHECK}/mesh.json`,
    JSON.stringify(clipped),
  );
}
console.log(
  "Terrain validation passed: analytical slope, preserved contours, concave boundary clipping, CAD parsing, invalid geometry and exports.",
);
