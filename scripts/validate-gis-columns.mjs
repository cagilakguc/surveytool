import assert from "node:assert/strict";
import {
  readGisPointTable,
  mapGisPointTable,
  gisMappingError,
  mappedNumber,
} from "../src/lib/gisColumnMapping.ts";
import { createGeometryShapefileZip } from "../src/lib/gisGeometryExports.ts";

const source =
  '\uFEFFCode,Northing,Label,Height,Easting\n"KERB, LEFT",5923000.25,001,0,"1,755,000.125"\nASB,5923010.5,002,-2.75,1755012.625\nBAD,5923011.5,003,,1755015\n';
const table = readGisPointTable(source, "shuffled.csv");
assert.equal(table.hasHeader, true);
assert.deepEqual(table.suggested, {
  easting: 4,
  northing: 1,
  elevation: 3,
  id: 2,
  code: 0,
});
const snapshot = structuredClone(table);
const layer = mapGisPointTable(table, table.suggested, true);
assert.deepEqual(layer.points, [
  {
    id: "001",
    easting: 1755000.125,
    northing: 5923000.25,
    elevation: 0,
    code: "KERB, LEFT",
  },
  {
    id: "002",
    easting: 1755012.625,
    northing: 5923010.5,
    elevation: -2.75,
    code: "ASB",
  },
]);
assert.match(layer.warnings.join(" "), /1 row.*skipped/);
assert.deepEqual(table, snapshot);

const headerless = readGisPointTable(
  "CP01 5923000 1755000 12.25 KERB\rCP02 5923002 1755002 0 ASB",
  "survey.txt",
);
assert.equal(headerless.hasHeader, false);
assert.match(
  gisMappingError(headerless.suggested, headerless.columnCount),
  /Choose the Easting/,
);
const explicit = { easting: 2, northing: 1, elevation: 3, id: 0, code: 4 };
assert.equal(
  mapGisPointTable(headerless, explicit, false).points[0].easting,
  1755000,
);
assert.equal(
  mapGisPointTable(headerless, explicit, false).points[1].elevation,
  0,
);
assert.match(
  gisMappingError({ ...explicit, easting: 1 }, 5),
  /different columns/,
);
assert.match(
  gisMappingError({ ...explicit, elevation: 2 }, 5),
  /different columns/,
);
assert.match(gisMappingError({ ...explicit, northing: 99 }, 5), /valid column/);
const xy = readGisPointTable(
  "Longitude;Latitude\n174.76;-36.88\n174.77;-36.89",
  "xy.csv",
);
assert.equal(xy.delimiterLabel, "Semicolon-separated");
const twoD = mapGisPointTable(xy, xy.suggested, true);
assert.equal(twoD.points.length, 2);
assert.equal(twoD.points[0].elevation, 0);
assert.match(twoD.warnings.join(" "), /Z values are set to 0/);
const comments = readGisPointTable(
  "# Survey export\n// Metadata\nName\tE\tN\tRL\nA\t1755000\t5923000\t12",
  "tabs.txt",
);
assert.equal(
  mapGisPointTable(comments, comments.suggested, true).points[0].id,
  "A",
);
for (const text of ["", "   ", "SingleColumn"])
  assert.throws(() => readGisPointTable(text, "empty.csv"));
for (const value of ["", "NaN", "Infinity", "0x10", "12,34", "12m"])
  assert.equal(mappedNumber(value), null);
assert.equal(mappedNumber("-1.25e3"), -1250);
assert.equal(mappedNumber("1,755,000.125"), 1755000.125);
assert.throws(
  () =>
    mapGisPointTable(
      readGisPointTable("E,N,Z\nbad,wrong,no", "bad.csv"),
      { easting: 0, northing: 1, elevation: 2, id: null, code: null },
      true,
    ),
  /No valid points/,
);

// Independently read the exported PointZ records, rather than only checking
// the in-memory mapped objects: X/Y must not be silently swapped on export.
const zip = new Uint8Array(
  createGeometryShapefileZip(layer, "EPSG:2193", "mapped"),
);
const zipView = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
let shp;
for (
  let offset = 0;
  offset + 30 <= zip.length && zipView.getUint32(offset, true) === 0x04034b50;
) {
  assert.equal(zipView.getUint16(offset + 8, true), 0);
  const size = zipView.getUint32(offset + 18, true),
    nameLength = zipView.getUint16(offset + 26, true),
    extra = zipView.getUint16(offset + 28, true);
  const name = new TextDecoder().decode(
    zip.subarray(offset + 30, offset + 30 + nameLength),
  );
  const start = offset + 30 + nameLength + extra;
  if (name.endsWith(".shp")) shp = zip.subarray(start, start + size);
  offset = start + size;
}
assert.ok(shp);
const shape = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
let position = 100,
  index = 0;
while (position < shp.length) {
  const body = position + 8;
  assert.equal(shape.getInt32(body, true), 11);
  assert.equal(shape.getFloat64(body + 4, true), layer.points[index].easting);
  assert.equal(shape.getFloat64(body + 12, true), layer.points[index].northing);
  assert.equal(
    shape.getFloat64(body + 20, true),
    layer.points[index].elevation,
  );
  position += 8 + shape.getInt32(position + 4, false) * 2;
  index++;
}
assert.equal(index, 2);
console.log(
  "GIS column mapping passed: shuffled headers, explicit N/E order, optional Z, true zero/negative heights, names/codes, delimiters, invalid rows, duplicate guards, source immutability and exported PointZ X/Y/Z.",
);
