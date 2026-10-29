import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  checkAsBuilt,
  createTinSampler,
} from "../src/lib/asBuiltConformance.ts";
import {
  assertDocument,
  assertPointLayer,
  parseProjectFile,
} from "../src/lib/projectWorkspace.ts";
import {
  createReportCsv,
  createReportExcel,
  createReportPdf,
} from "../src/lib/surveyReports.ts";

const catalogue = JSON.parse(
  fs.readFileSync("public/data/coordinate-systems.json", "utf8"),
);
const e = 1755000,
  n = 5923000,
  z = (x, y) => 100 + x * 0.001 + y * 0.002;
const p = (x, y, h = z(x, y)) => ({
  easting: e + x,
  northing: n + y,
  elevation: h,
});
const surface = {
  name: "Analytical plane",
  points: { a: p(0, 0), b: p(200, 0), c: p(200, 150), d: p(0, 150) },
  faces: [
    ["a", "b", "c"],
    ["a", "c", "d"],
  ],
  minElevation: 100,
  maxElevation: 100.5,
};
const points = [
  [10, 10, 0.005],
  [30, 60, 0.027],
  [110, 80, -0.022],
  [50, 50, -0.01],
  [80, 80, 0.01],
  [230, 20, 0],
].map(([x, y, dz], i) => ({
  ...p(x, y, z(x, y) + dz),
  id: `P${i}`,
  code: "ASB",
}));
const request = {
  surface,
  inputs: [
    {
      id: "file",
      sourceCrs: "EPSG:2193",
      heightUnit: "metre",
      layer: { name: "measured.csv", format: "CSV", warnings: [], points },
    },
  ],
  catalogue,
  designCrs: "EPSG:2193",
  designHeightScale: 1,
  heightScales: { metre: 1, foot: 0.3048 },
  lowerMm: -10,
  upperMm: 10,
};
const original = structuredClone(request);
const result = checkAsBuilt(request);
assert.deepEqual(result.counts, {
  PASS: 3,
  HIGH: 1,
  LOW: 1,
  OUTSIDE: 1,
  NO_DESIGN_LEVEL: 0,
  AMBIGUOUS: 0,
  INVALID: 0,
});
assert.ok(Math.abs(result.rows[0].differenceMm - 5) < 1e-7);
assert.equal(result.rows.at(-1).designLevelM, null);
assert.equal(result.rows.at(-1).status, "OUTSIDE");
assert.deepEqual(request, original);
const feet = structuredClone(request);
feet.inputs[0].heightUnit = "foot";
feet.inputs[0].layer.points = points.map((point) => ({
  ...point,
  elevation: point.elevation / 0.3048,
}));
assert.deepEqual(checkAsBuilt(feet).counts, result.counts);
const invalid = structuredClone(request);
invalid.inputs[0].layer.points = [{ ...points[0], elevation: NaN }];
assert.equal(checkAsBuilt(invalid).counts.INVALID, 1);
assert.throws(
  () => checkAsBuilt({ ...request, lowerMm: 11, upperMm: 10 }),
  /lower ≤ upper/,
);
const missing = structuredClone(surface);
missing.points.a.elevation = null;
assert.equal(
  createTinSampler(missing).find(e + 5, n + 5).status,
  "NO_DESIGN_LEVEL",
);
const overlapping = structuredClone(surface);
overlapping.points.x = p(0, 0, 200);
overlapping.points.y = p(200, 0, 200);
overlapping.points.v = p(200, 150, 200);
overlapping.faces.push(["x", "y", "v"]);
assert.equal(
  createTinSampler(overlapping).find(e + 100, n + 20).status,
  "AMBIGUOUS",
);
const gap = {
  ...surface,
  points: {
    a: p(0, 0),
    b: p(1, 0),
    c: p(0, 1),
    d: p(9, 9),
    f: p(10, 9),
    g: p(9, 10),
  },
  faces: [
    ["a", "b", "c"],
    ["d", "f", "g"],
  ],
};
assert.equal(createTinSampler(gap).find(e + 5, n + 5).status, "OUTSIDE");
const degenerate = { ...surface, faces: [...surface.faces, ["a", "a", "b"]] };
assert.equal(createTinSampler(degenerate).rejectedFaces, 1);
const gda = structuredClone(request);
gda.designCrs = "EPSG:7856";
gda.inputs[0].sourceCrs = "EPSG:28356";
assert.throws(() => checkAsBuilt(gda), /documented transformation/);
assert.ok(
  Math.abs(createTinSampler(surface).find(e + 100, n + 75).level - z(100, 75)) <
    1e-10,
);
// Exercise the real upload parser so Civil 3D invisible faces cannot fill a hole.
const messages = [],
  context = {
    self: { postMessage: (message) => messages.push(message) },
    TextDecoder,
  };
vm.runInNewContext(
  fs.readFileSync("src/workers/landxmlParser.worker.js", "utf8"),
  context,
);
const xml =
  '<LandXML version="1.2"><Units><Metric linearUnit="meter"/></Units><Surface name="Hidden face"><Definition surfType="TIN"><Pnts><P id="a">0 0 0</P><P id="b">0 100 0</P><P id="c">100 100 0</P><P id="d">100 0 0</P></Pnts><Faces><F>a b c</F><F i="1">a c d</F></Faces></Definition></Surface></LandXML>';
context.self.onmessage({
  data: {
    buffer: new TextEncoder().encode(xml).buffer,
    fileName: "hidden-face.xml",
  },
});
const parsed = messages.find((message) => message.type === "result").document;
assert.equal(parsed.surfaces[0].faces.length, 1);
assert.equal(parsed.surfaces[0].excludedFaces, 1);
assert.equal(
  createTinSampler(parsed.surfaces[0]).find(10, 90).status,
  "OUTSIDE",
);
assert.throws(
  () =>
    createTinSampler({
      ...surface,
      hasBoundaryDefinitions: true,
      excludedFaces: 0,
    }),
  /boundary instructions/,
);

const document = {
  fileName: "design.xml",
  projectName: "Test",
  units: "meter",
  surfaces: [surface],
  alignments: [],
  cogoPoints: [],
};
assertDocument(document);
assertPointLayer(request.inputs[0].layer);
const project = {
  format: "surveytool-project",
  version: 1,
  id: "test",
  tool: "asbuilt",
  title: "Test",
  savedAt: "2026-10-30T00:00:00Z",
  state: { document, inputs: request.inputs },
};
assert.deepEqual(parseProjectFile(JSON.stringify(project)), project);
assert.throws(
  () => parseProjectFile(JSON.stringify({ ...project, version: 99 })),
  /supported SurveyTool/,
);
assert.throws(
  () =>
    assertDocument({
      ...document,
      surfaces: [
        {
          ...surface,
          points: { a: { easting: "x", northing: 0, elevation: 0 } },
        },
      ],
    }),
  /coordinates/,
);

const report = {
  title: "As-built vs Design Conformance",
  project: "Çalışma — test project",
  createdAt: "2026-10-30T00:00:00Z",
  metadata: [
    ["CRS", "EPSG:2193"],
    ["Height datum", "Project datum"],
    ["Lower / upper (mm)", "-10 / 10"],
  ],
  summary: Object.entries(result.counts),
  columns: ["Point", "Difference (mm)", "Status"],
  rows: result.rows.map((row) => [row.id, row.differenceMm, row.status]),
  notes: ["Analytical plane: z = 100 + 0.001x + 0.002y. No extrapolation."],
  plot: {
    points: result.rows.map((row) => ({
      easting: row.easting,
      northing: row.northing,
      colour: row.status === "PASS" ? "#34d399" : "#fb7185",
    })),
    legend: { PASS: "#34d399", OTHER: "#fb7185" },
  },
};
const csv = createReportCsv({
  ...report,
  rows: [...report.rows, ["=1+1", null, "@test"]],
});
assert.match(csv, /'=1\+1/);
assert.match(csv, /'@test/);
assert.match(csv, /OUTSIDE/);
const xlsx = await createReportExcel(report);
const ExcelJS = (await import("exceljs")).default;
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(xlsx);
assert.equal(workbook.getWorksheet("Results").rowCount, 7);
assert.equal(workbook.getWorksheet("Results").getCell("B2").type, 2);
assert.equal(
  workbook.getWorksheet("Summary").getCell("B2").value,
  report.project,
);
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  ok: true,
  arrayBuffer: async () => {
    const b = fs.readFileSync("public/fonts/survey-report.ttf");
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  },
});
const pdf = await createReportPdf(report);
globalThis.fetch = originalFetch;
fs.writeFileSync("/tmp/asbuilt-report-validation.pdf", new Uint8Array(pdf));
fs.writeFileSync("/tmp/asbuilt-report-validation.xlsx", new Uint8Array(xlsx));
fs.writeFileSync("/tmp/asbuilt-report-validation.csv", csv);
assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), "%PDF-");
console.log(
  "As-built conformance passed: analytical plane, inclusive tolerances, every point/status, source immutability, feet/metres, missing levels, conflicts, holes, degenerate faces, datum guard, saved project validation, CSV injection guard, numeric Excel cells and Unicode PDF output.",
);
