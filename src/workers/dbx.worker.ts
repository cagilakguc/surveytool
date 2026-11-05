import { parseDbxJob, prepareDbxPoints } from "../lib/leicaDbx"
import type { DbxComponent, DbxJob, DbxOptions, DbxPrepared } from "../lib/leicaDbx"
import { loadNzHeightGrid } from "../lib/nzHeightModels"
import { dbxDxf, dbxPointCsv } from "../lib/dbxExport"
import type { DxfSettings } from "../components/DxfExportSettings"

type Request = { type: "parse"; components: DbxComponent[] } | { type: "prepare"; job: DbxJob; options: DbxOptions } | { type: "export"; job: DbxJob; prepared: DbxPrepared; settings: DxfSettings; mode: "3d" | "2d"; format: "dxf" | "csv" }
self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const request = event.data
    if (request.type === "parse") self.postMessage({ result: parseDbxJob(request.components) })
    else if (request.type === "prepare") self.postMessage({ result: await prepareDbxPoints(request.job, request.options, loadNzHeightGrid) })
    else {
      const content = request.format === "dxf" ? dbxDxf(request.prepared, request.settings, request.mode) : dbxPointCsv(request.job, request.prepared)
      const buffer = new TextEncoder().encode(content).buffer
      self.postMessage({ buffer }, { transfer: [buffer] })
    }
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "The DBX job could not be read." }) }
}
