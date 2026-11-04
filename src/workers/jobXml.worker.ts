import { decodeJobXml, parseJobXml } from "../lib/jobXml"
import type { JobXmlPoint } from "../lib/jobXml"
import { jobXmlDxfPoints, jobXmlPointCsv } from "../lib/jobXmlExport"
import { createPointDxf } from "../lib/pointDxf"
import type { DxfSettings } from "../components/DxfExportSettings"
type Request = { type: "parse"; buffer: ArrayBuffer; fileName: string } | { type: "export"; points: JobXmlPoint[]; mode: "3d" | "2d"; format: "dxf" | "csv"; settings: DxfSettings }
self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const request = event.data
    if (request.type === "parse") self.postMessage({ result: parseJobXml(decodeJobXml(request.buffer), request.fileName) })
    else {
      const content = request.format === "dxf" ? createPointDxf(jobXmlDxfPoints(request.points, request.mode), request.settings, { metres: true, flatten: request.mode === "2d" }) : jobXmlPointCsv(request.points)
      const buffer = new TextEncoder().encode(content).buffer
      self.postMessage({ buffer }, { transfer: [buffer] })
    }
  }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "The JobXML file could not be read." }) }
}
