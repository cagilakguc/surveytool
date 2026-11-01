import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import "fake-indexeddb/auto";
import {
  saveWorkspace,
  loadWorkspace,
  listWorkspaces,
  deleteWorkspace,
  parseProjectFile,
  assertDocument,
} from "../src/lib/projectWorkspace.ts";
import {
  demoTerrainInput,
  buildContourTerrain,
  terrainDocument,
} from "../src/lib/contourTerrain.ts";
import { sanitisePageView } from "../src/lib/visitorAnalytics.ts";
const settings = {
    name: "Offline field terrain",
    units: "meter",
    crs: "EPSG:2193",
    verticalDatum: "NZVD2016",
    boundaryId: "",
    spacing: 0,
  },
  input = demoTerrainInput(),
  mesh = buildContourTerrain(input, settings);
const doc = terrainDocument(mesh, settings);
const terrain = {
  format: "surveytool-project",
  version: 1,
  id: "offline-terrain",
  tool: "terrain",
  title: "Field job",
  savedAt: "2026-11-02T01:00:00Z",
  state: { input, settings, reviewed: true },
};
const sections = {
  ...terrain,
  id: "offline-sections",
  tool: "sections",
  state: {
    document: doc,
    pointLayers: [],
    lineMarking: null,
    xmlFiles: [doc.fileName],
    pointFiles: [],
    sectionSettings: null,
  },
};
await saveWorkspace(terrain);
await saveWorkspace(sections);
assert.deepEqual(await loadWorkspace(terrain.id), terrain);
const reopened = await loadWorkspace(sections.id);
assertDocument(reopened.state.document);
assert.deepEqual(reopened, sections);
assert.equal((await listWorkspaces()).length, 2);
assert.equal((await listWorkspaces("terrain")).length, 1);
const updated = {
  ...terrain,
  title: "Updated field job",
  savedAt: "2026-11-02T02:00:00Z",
};
await saveWorkspace(updated);
assert.deepEqual(await loadWorkspace(terrain.id), updated);
assert.deepEqual(parseProjectFile(JSON.stringify(sections)), sections);
assert.throws(
  () => parseProjectFile(JSON.stringify({ ...terrain, version: 2 })),
  /supported/,
);
// A failed write must not corrupt the previous saved copy.
const original = IDBObjectStore.prototype.put;
IDBObjectStore.prototype.put = function (...args) {
  const request = original.apply(this, args);
  this.transaction.abort();
  return request;
};
await assert.rejects(
  saveWorkspace({ ...updated, title: "This write must not commit" }),
);
IDBObjectStore.prototype.put = original;
assert.equal((await loadWorkspace(terrain.id)).title, "Updated field job");
await deleteWorkspace(terrain.id);
assert.equal((await listWorkspaces()).length, 1);
assert.equal((await loadWorkspace(sections.id)).id, sections.id);
const handlers = {},
  cacheData = new Map(),
  cacheNames = ["surveytool-shell-old", "unrelated-cache"],
  urls = [
    "/index.html",
    "/offline.html",
    "/assets/terrain.worker.js",
    "/data/coordinate-systems.json",
    "/fonts/survey-report.ttf",
  ];
const normal = (u) =>
  new URL(typeof u === "string" ? u : u.url, "https://www.surveytool.io")
    .pathname;
const cache = {
  addAll: async (list) =>
    list.forEach((u) =>
      cacheData.set(
        normal(u),
        new Response(
          u === "/index.html"
            ? "CURRENT_APP"
            : u.includes("coordinate-systems")
              ? '[{"code":"EPSG:2193"}]'
              : "ASSET",
        ),
      ),
    ),
  match: async (u, options) => {
    const raw = typeof u === "string" ? u : u.url;
    if (
      new URL(raw, "https://www.surveytool.io").search &&
      !options?.ignoreSearch
    )
      return undefined;
    return cacheData.get(normal(u))?.clone();
  },
};
const self = {
  location: { origin: "https://www.surveytool.io" },
  clients: { claim: async () => {} },
  addEventListener: (name, fn) => (handlers[name] = fn),
};
const caches = {
  open: async () => cache,
  keys: async () => cacheNames,
  delete: async (name) => {
    cacheNames.splice(cacheNames.indexOf(name), 1);
    return true;
  },
};
const template = (
  await readFile(
    new URL("./service-worker.template.js", import.meta.url),
    "utf8",
  )
)
  .replace("__CACHE_VERSION__", "current")
  .replace("__PRECACHE_URLS__", JSON.stringify(urls));
runInNewContext(template, {
  self,
  caches,
  URL,
  Promise,
  Response,
  fetch: async () => {
    throw new Error("OFFLINE");
  },
});
let pending;
handlers.install({ waitUntil: (p) => (pending = p) });
await pending;
async function fetchFromWorker(path, { mode = "cors", method = "GET" } = {}) {
  let response;
  handlers.fetch({
    request: {
      method,
      mode,
      url: new URL(path, self.location.origin).toString(),
    },
    respondWith: (p) => (response = p),
  });
  return response ? await response : undefined;
}
assert.equal(
  await (
    await fetchFromWorker("/tools/cross-section?project=offline-sections", {
      mode: "navigate",
    })
  ).text(),
  "CURRENT_APP",
);
assert.equal(
  await (
    await fetchFromWorker("/tools/contours-to-terrain", { mode: "navigate" })
  ).text(),
  "CURRENT_APP",
);
assert.ok(
  (
    await (await fetchFromWorker("/data/coordinate-systems.json?v=4")).text()
  ).includes("EPSG:2193"),
);
assert.equal(
  await (await fetchFromWorker("/fonts/survey-report.ttf")).text(),
  "ASSET",
);
assert.equal(await fetchFromWorker("/api/private"), undefined);
assert.equal(await fetchFromWorker("/auth/session"), undefined);
assert.equal(await fetchFromWorker("https://maps.google.com/tile"), undefined);
assert.equal(await fetchFromWorker("/private-survey.xml"), undefined);
assert.equal(
  await fetchFromWorker("/index.html", { method: "POST" }),
  undefined,
);
let status;
handlers.message({
  data: { type: "SURVEYTOOL_OFFLINE_STATUS" },
  ports: [{ postMessage: (value) => (status = value) }],
  waitUntil: (p) => (pending = p),
});
await pending;
assert.equal(status.ready, true);
cacheData.delete("/fonts/survey-report.ttf");
handlers.message({
  data: { type: "SURVEYTOOL_OFFLINE_STATUS" },
  ports: [{ postMessage: (value) => (status = value) }],
  waitUntil: (p) => (pending = p),
});
await pending;
assert.equal(status.ready, false);
handlers.activate({ waitUntil: (p) => (pending = p) });
await pending;
assert.deepEqual(cacheNames, ["unrelated-cache"]);
assert.equal(
  sanitisePageView({
    type: "pageview",
    url: "https://www.surveytool.io/tools/cross-section?project=PRIVATE#filename",
  }).url,
  "https://www.surveytool.io/tools/cross-section",
);
assert.equal(
  sanitisePageView({
    type: "pageview",
    url: "https://preview.vercel.app/tools/cross-section",
  }),
  null,
);
assert.equal(
  sanitisePageView({
    type: "pageview",
    url: "https://www.surveytool.io/auth?token=private",
  }),
  null,
);
assert.equal(
  sanitisePageView({ type: "event", url: "https://www.surveytool.io/" }),
  null,
);
console.log(
  "Offline validation passed: project persistence and atomic recovery, reopening, backups, offline deep links, catalogue/font cache, privacy and readiness checks.",
);
