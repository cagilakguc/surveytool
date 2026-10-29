import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createGlobalCoordinateTransform,
  transformGlobalSurveyGeometry,
} from "../src/lib/globalGis.ts";
import { datumOperationError } from "../src/lib/datumOperations.ts";
const catalogue = JSON.parse(
  fs.readFileSync("public/data/coordinate-systems.json", "utf8"),
);
const crs = (code) => {
  const c = catalogue.find((x) => x.code === `EPSG:${code}`);
  assert.ok(c);
  return c;
};
for (const [a, b] of [
  [4283, 7844],
  [7844, 4283],
  [28356, 7856],
  [7856, 28356],
  [4283, 4326],
  [4326, 7856],
]) {
  assert.throws(
    () => createGlobalCoordinateTransform(crs(a), crs(b)),
    /documented transformation/,
  );
  const layer = {
    name: "datum-test",
    format: "DXF",
    warnings: [],
    points: [],
    lines: [
      {
        id: "L",
        code: "",
        vertices: [
          { easting: 333568, northing: 6250941, elevation: 12.345 },
          { easting: 333578, northing: 6250941, elevation: 13 },
        ],
      },
    ],
    polygons: [],
  };
  assert.throws(
    () => transformGlobalSurveyGeometry(layer, crs(a), crs(b)),
    /documented transformation/,
  );
}
for (const id of [4283, 7844, 28356, 7856, 27700]) {
  const point = [4283, 7844].includes(id)
    ? { easting: 151.2, northing: -33.86, elevation: 12.345 }
    : { easting: 333568, northing: 6250941, elevation: 12.345 };
  assert.deepEqual(
    createGlobalCoordinateTransform(crs(id), crs(id))(point),
    point,
  );
}
const project = createGlobalCoordinateTransform(
  crs(4283),
  crs(28356),
)({ easting: 153, northing: -35, elevation: 12.345 });
assert.ok(Math.abs(project.easting - 500000) < 0.00001);
assert.equal(project.elevation, 12.345);
for (const [a, b] of [
  [27700, 4326],
  [27200, 2193],
  [4267, 4269],
  [4314, 4258],
]) {
  assert.throws(
    () =>
      createGlobalCoordinateTransform(
        crs(a),
        crs(b),
      )({
        easting: [4267, 4314].includes(a) ? 13 : 530000,
        northing: [4267, 4314].includes(a) ? 52 : 180000,
        elevation: 0,
      }),
    /grid file|datum operation/,
  );
}
const fallback = {
  ...crs(4326),
  code: "TEST:FALLBACK",
  datum: "OtherDatum",
  proj4: "+proj=longlat +ellps=GRS80 +nadgrids=@missing.gsb,null",
};
assert.match(
  datumOperationError(fallback, crs(4326)),
  /optional grid or null fallback/,
);
assert.equal(datumOperationError(crs(4326), crs(3857)), "");
assert.match(
  datumOperationError(
    {
      ...crs(4326),
      code: "TEST:UNKNOWN",
      datum: "Unknown_Reference",
      proj4: "+proj=longlat +ellps=GRS80",
    },
    crs(4326),
  ),
  /No documented datum operation/,
);
console.log(
  "Datum guards passed: GDA94/GDA2020 blocked in both directions, same-datum projections retained, missing grids, optional/null fallback and unknown datums rejected.",
);
