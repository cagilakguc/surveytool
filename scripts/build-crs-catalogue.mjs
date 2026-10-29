import { createRequire } from "node:module"
import { mkdir, writeFile, copyFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const definitions = require("epsg-index/all.json")
// OpenLayers' documented Helmert transform permits a BNG background without an NTv2 download.
// This approximation is only for the map; calculations never use transformed coordinates.
definitions["27700"].proj4 = "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs"
definitions["27700"].note = "Background positioning uses an approximate datum transformation. Keep survey checks in the source grid."
const catalogue = Object.values(definitions)
  .filter((entry) => entry.proj4 && ["CRS-PROJCRS", "CRS-GEOGCRS"].includes(entry.kind) && !/\+proj=(geocent|pipeline)\b/.test(entry.proj4))
  .map((entry) => ({ code: `EPSG:${entry.code}`, name: entry.name, proj4: entry.proj4, area: entry.area ?? "", bbox: entry.bbox ?? null, unit: entry.unit ?? "", ...(entry.note ? { note: entry.note } : {}) }))
await mkdir(resolve(root, "public/data"), { recursive: true })
await writeFile(resolve(root, "public/data/coordinate-systems.json"), JSON.stringify(catalogue))
await copyFile(require.resolve("epsg-index/license.md"), resolve(root, "public/data/epsg-index-license.txt"))
console.log(`Prepared ${catalogue.length.toLocaleString()} horizontal coordinate systems.`)
