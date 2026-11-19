import type { LandXmlDocument } from "./landxml"
import { parseLandXmlFile } from "./landxmlAsync"

type ParseOptions = {
  signal?: AbortSignal
  onProgress?: (stage: string, percent: number) => void
}

export async function parsePavementSurfaceFile(file: File, options: ParseOptions = {}): Promise<LandXmlDocument> {
  if (!/\.tin$/i.test(file.name)) return parseLandXmlFile(file, options)
  if (options.signal?.aborted) throw new DOMException("TIN loading was cancelled.", "AbortError")
  const worker = new Worker(new URL("../workers/tinAscii.worker.ts", import.meta.url), { type: "module" })
  return new Promise<LandXmlDocument>((resolve, reject) => {
    let settled = false
    const finish = () => { worker.terminate(); options.signal?.removeEventListener("abort", abort) }
    const abort = () => {
      if (settled) return
      settled = true; finish(); reject(new DOMException("TIN loading was cancelled.", "AbortError"))
    }
    options.signal?.addEventListener("abort", abort, { once: true })
    worker.onmessage = (event: MessageEvent<{ type: string; stage?: string; percent?: number; document?: LandXmlDocument; message?: string }>) => {
      const message = event.data
      if (message.type === "progress") { options.onProgress?.(message.stage ?? "Reading TIN", message.percent ?? 0); return }
      if (settled) return
      settled = true; finish()
      if (message.type === "result" && message.document) resolve(message.document)
      else reject(new Error(message.message || "Unable to read this TIN file."))
    }
    worker.onerror = () => {
      if (settled) return
      settled = true; finish(); reject(new Error("The TIN parser stopped unexpectedly."))
    }
    file.arrayBuffer().then((buffer) => { if (!settled) worker.postMessage({ buffer, fileName: file.name }, [buffer]) })
      .catch((error) => { if (!settled) { settled = true; finish(); reject(error) } })
  })
}
