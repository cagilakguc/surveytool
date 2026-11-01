import { createHash } from "node:crypto"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"

const dist = resolve("dist")
async function filesInside(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await filesInside(file))
    else if (entry.isFile()) output.push(file)
  }
  return output
}
for (const [name, dimension] of [["icon-192.png", 192], ["icon-512.png", 512], ["maskable-512.png", 512]]) {
  const bytes = await readFile(join(dist, "icons", name))
  if (bytes.toString("ascii", 1, 4) !== "PNG" || bytes.readUInt32BE(16) !== dimension || bytes.readUInt32BE(20) !== dimension) throw new Error(`Invalid PWA icon ${name}`)
}
const files = await filesInside(join(dist, "assets"))
const assets = files
  .filter((file) => /\.(js|css|png|svg|webp|woff2?)$/i.test(file) && !file.endsWith(".map"))
  .map((file) => "/" + relative(dist, file).replaceAll("\\", "/"))
  .sort()
const urls = Array.from(new Set(["/index.html", "/offline.html", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", ...assets]))
const version = createHash("sha256").update(JSON.stringify(urls)).digest("hex").slice(0, 16)
const template = await readFile("scripts/service-worker.template.js", "utf8")
await writeFile(join(dist, "service-worker.js"), template.replace("__CACHE_VERSION__", version).replace("__PRECACHE_URLS__", JSON.stringify(urls)))
console.log(`SurveyTool app shell: ${urls.length} static assets, cache ${version}`)
