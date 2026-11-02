import { rasterTin } from "../src/lib/rasterTin.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  prepareDisplaySurface,
  landXmlTerrainMesh,
} from "../src/lib/landxmlDisplay.ts";
import {
  buildSurveyMapData,
  createMapTransform,
} from "../src/lib/surveyMapGeometry.ts";

// Dense survey grid with a real opening: dropping every nth face used to leave
// thousands of additional holes. Neither renderer may bridge the real opening.
const points = {},
  faces = [],
  steps = 72;
const id = (x, y) => x + ":" + y;
for (let y = 0; y <= steps; y++)
  for (let x = 0; x <= steps; x++)
    points[id(x, y)] = {
      easting: 1755000.12345 + x,
      northing: 5923000.54321 + y,
      elevation: 8 + x * 0.04 + y * 0.02,
    };
for (let y = 0; y < steps; y++)
  for (let x = 0; x < steps; x++) {
    if (x >= 34 && x < 38 && y >= 34 && y < 38) continue;
    faces.push(
      [id(x, y), id(x + 1, y), id(x + 1, y + 1)],
      [id(x, y), id(x + 1, y + 1), id(x, y + 1)],
    );
  }
const surface = {
  name: "Dense survey TIN",
  points,
  faces,
  minElevation: 8,
  maxElevation: 12.32,
};
const original = structuredClone(surface);
const prepared = prepareDisplaySurface(surface);
assert.equal(prepared.indices.length / 3, faces.length);
assert.ok(faces.length > 10000);
const mesh = landXmlTerrainMesh(surface);
assert.equal(mesh.faces.length, faces.length);
assert.ok(Math.abs(mesh.area - (steps * steps - 16)) < 1e-8);
for (const vertex of mesh.vertices) {
  const x = vertex[0] - points["0:0"].easting,
    y = vertex[1] - points["0:0"].northing;
  assert.ok(Math.abs(vertex[2] - (8 + x * 0.04 + y * 0.02)) < 1e-9);
}
assert.deepEqual(mesh.vertices[0], [
  points["0:0"].easting,
  points["0:0"].northing,
  8,
]);
for (const face of mesh.faces) {
  const [a, b, c] = face.map((i) => mesh.vertices[i]);
  assert.ok((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0);
}
const catalogue = JSON.parse(
  await readFile(
    new URL("../public/data/coordinate-systems.json", import.meta.url),
    "utf8",
  ),
);
const crs = catalogue.find((c) => c.code === "EPSG:2193");
const document = {
  fileName: "dense.xml",
  version: "1.2",
  projectName: "Test",
  applicationName: "Test",
  units: "meter",
  surfaces: [surface],
  alignments: [],
  cogoPoints: [],
  warnings: [],
};
const mapped = buildSurveyMapData(crs, document, undefined, true);
assert.ok(mapped.features.length <= 255);
assert.equal(
  mapped.features.reduce(
    (count, feature) => count + feature.getGeometry().getCoordinates().length,
    0,
  ),
  faces.length,
);
const project = createMapTransform(crs);
assert.equal(
  mapped.features.some((feature) =>
    feature
      .getGeometry()
      .intersectsCoordinate(
        project(points["0:0"].easting + 36, points["0:0"].northing + 36),
      ),
  ),
  false,
);
assert.equal(
  mapped.features.some((feature) =>
    feature
      .getGeometry()
      .intersectsCoordinate(
        project(points["0:0"].easting + 12.3, points["0:0"].northing + 12.7),
      ),
  ),
  true,
);
assert.match(mapped.note, /Complete TIN/);
assert.deepEqual(surface, original);

const invalid = {
  ...surface,
  faces: [...surface.faces, ["missing", "0:0", "1:0"], ["0:0", "1:0", "2:0"]],
};
assert.equal(prepareDisplaySurface(invalid).rejectedFaces, 2);
const noZ = {
  ...surface,
  points: Object.fromEntries(
    Object.entries(points).map(([key, p]) => [key, { ...p, elevation: null }]),
  ),
};
assert.equal(prepareDisplaySurface(noZ).indices.length, faces.length * 3);
assert.throws(
  () => landXmlTerrainMesh(noZ),
  /no triangles with readable elevations/,
);
const flat = {
  ...surface,
  points: Object.fromEntries(
    Object.entries(points).map(([key, p]) => [key, { ...p, elevation: 0 }]),
  ),
};
assert.equal(landXmlTerrainMesh(flat).minZ, 0);
assert.equal(landXmlTerrainMesh(flat).maxZ, 0);
console.log(
  "LandXML display: complete dense TIN, genuine holes, exact coordinates, valid zero levels, missing-level handling and source immutability passed.",
);

// The smooth renderer must cover adjoining faces without drawing seams, and
// preserve a real opening even when every face is smaller than a screen pixel.
const pixels = rasterTin(
  [prepared],
  steps,
  steps,
  {
    x: points["0:0"].easting,
    y: points["0:0"].northing,
    width: steps,
    height: steps,
  },
  true,
  true,
);
for (let y = 0; y < steps; y++)
  for (let x = 0; x < steps; x++) {
    const inOpening = x >= 34 && x < 38 && y >= 34 && y < 38;
    assert.equal(pixels[(y * steps + x) * 4 + 3], inOpening ? 0 : 255);
  }
const plane = prepareDisplaySurface({
  name: "Analytical plane",
  points: {
    a: { easting: 0, northing: 0, elevation: 0 },
    b: { easting: 100, northing: 0, elevation: 10 },
    c: { easting: 100, northing: 100, elevation: 20 },
    d: { easting: 0, northing: 100, elevation: 10 },
  },
  faces: [
    ["a", "b", "c"],
    ["a", "c", "d"],
  ],
});
const smooth = rasterTin(
  [plane],
  100,
  100,
  { x: 0, y: 0, width: 100, height: 100 },
  true,
  true,
);
for (let i = 3; i < smooth.length; i += 4) assert.equal(smooth[i], 255);
const ramp = [
  [37, 99, 235],
  [6, 182, 212],
  [132, 204, 22],
  [251, 191, 36],
];
for (const [x, y] of [
  [0, 0],
  [30, 30],
  [49, 50],
  [50, 49],
  [90, 88],
]) {
  const t = ((x + y + 1) / 200) * 3,
    index = Math.min(2, Math.floor(t)),
    fraction = t - index;
  for (let channel = 0; channel < 3; channel++)
    assert.ok(
      Math.abs(
        smooth[(y * 100 + x) * 4 + channel] -
          (ramp[index][channel] +
            (ramp[index + 1][channel] - ramp[index][channel]) * fraction),
      ) <= 1,
    );
}
assert.throws(
  () =>
    rasterTin(
      [plane],
      10000,
      10000,
      { x: 0, y: 0, width: 100, height: 100 },
      true,
      true,
    ),
  /Invalid display/,
);
console.log(
  "Smooth raster: analytic per-pixel heights, shared-edge coverage, genuine openings and display-size limits passed.",
);
