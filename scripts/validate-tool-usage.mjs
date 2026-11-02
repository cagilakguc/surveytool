import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../src/lib/toolUsage.ts", import.meta.url),
  "utf8",
);
const compiled = ts
  .transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  })
  .outputText.replaceAll("import.meta.env", "__env");
function sandbox({
  configured = true,
  production = true,
  hostname = "www.surveytool.io",
  dnt = "0",
  gpc = false,
  online = true,
} = {}) {
  const saved = new Map(),
    scripts = [];
  const window = {
    location: {
      hostname,
      origin: "https://" + hostname,
      pathname: "/tools/landxml-viewer",
      search: "?project=private",
      hash: "#secret",
    },
  };
  const document = {
    cookie: "",
    getElementById: (id) => scripts.find((s) => s.id === id),
    createElement: () => ({}),
    head: { appendChild: (script) => scripts.push(script) },
  };
  const context = {
    exports: {},
    __env: {
      PROD: production,
      VITE_GA_MEASUREMENT_ID: configured ? "G-TEST1234" : "",
    },
    navigator: { doNotTrack: dnt, globalPrivacyControl: gpc, onLine: online },
    window,
    document,
    localStorage: {
      getItem: (k) => saved.get(k) ?? null,
      setItem: (k, v) => saved.set(k, v),
    },
  };
  vm.runInNewContext(compiled, context);
  return { api: context.exports, window, scripts, document };
}
const state = sandbox();
state.api.trackToolAction("landxml", "import_complete", {
  source: "upload",
  format: "xml",
  filename: "private-survey.xml",
  easting: 1755000,
});
assert.equal(state.scripts.length, 0, "No optional analytics before consent");
state.api.setUsageConsent("deny");
state.api.trackToolAction("landxml", "import_complete");
assert.equal(state.scripts.length, 0);
state.api.setUsageConsent("allow");
state.api.trackToolAction("landxml", "import_complete", {
  source: "upload",
  format: "xml",
  filename: "private-survey.xml",
  coordinates: [1755000, 5923000],
  projectId: "secret",
});
state.api.trackToolAction("csv_dxf", "export_prepared", { format: "dxf" });
assert.equal(state.scripts.length, 1);
const payload = JSON.stringify(state.window.dataLayer);
for (const secret of [
  "private-survey",
  "1755000",
  "5923000",
  "?project",
  "#secret",
  "projectId",
])
  assert.equal(payload.includes(secret), false);
assert.ok(payload.includes("landxml_import_complete"));
assert.ok(payload.includes("csv_dxf_export_prepared"));
const before = state.window.dataLayer.length;
state.api.trackToolAction("unknown", "import_complete");
assert.equal(state.window.dataLayer.length, before);
state.api.setUsageConsent("deny");
const denied = state.window.dataLayer.length;
state.api.trackToolAction("landxml", "import_complete");
assert.equal(state.window.dataLayer.length, denied);
for (const settings of [
  { configured: false },
  { production: false },
  { hostname: "preview.vercel.app" },
  { dnt: "1" },
  { gpc: true },
  { online: false },
]) {
  const test = sandbox(settings);
  test.api.setUsageConsent("allow");
  test.api.trackToolAction("landxml", "import_complete");
  assert.equal(test.scripts.length, 0, JSON.stringify(settings));
}
console.log(
  "Tool usage: consent, revocation, offline/preview exclusion, DNT/GPC, bounded events, and no filenames/coordinates/project identifiers passed.",
);
