import type { LandXmlDocument } from "./landxml"

type ParseOptions = {
  signal?: AbortSignal
  onProgress?: (stage: string, percent: number) => void
}

type WorkerMessage =
  | {
      type: "progress"
      stage: string
      percent: number
    }
  | {
      type: "result"
      document: LandXmlDocument
    }
  | {
      type: "error"
      message: string
    }

export async function parseLandXmlFile(
  file: File,
  options: ParseOptions = {},
): Promise<LandXmlDocument> {
  if (options.signal?.aborted) {
    throw new DOMException("LandXML loading was cancelled.", "AbortError")
  }

  const worker = new Worker(
    new URL("../workers/landxmlParser.worker.js", import.meta.url),
    { type: "module" },
  )

  return new Promise<LandXmlDocument>((resolve, reject) => {
    let settled = false

    function finish() {
      worker.terminate()
      options.signal?.removeEventListener("abort", handleAbort)
    }

    function handleAbort() {
      if (settled) return
      settled = true
      finish()
      reject(new DOMException("LandXML loading was cancelled.", "AbortError"))
    }

    options.signal?.addEventListener("abort", handleAbort, { once: true })

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data

      if (message.type === "progress") {
        options.onProgress?.(message.stage, message.percent)
        return
      }

      if (settled) return
      settled = true
      finish()

      if (message.type === "result") {
        resolve(message.document)
      } else {
        reject(new Error(message.message))
      }
    }

    worker.onerror = (event) => {
      if (settled) return
      settled = true
      finish()
      reject(
        new Error(
          event.message ||
            "The LandXML parser stopped unexpectedly. The file may be too large or malformed.",
        ),
      )
    }

    file
      .arrayBuffer()
      .then((buffer) => {
        if (settled) return
        worker.postMessage(
          {
            buffer,
            fileName: file.name,
          },
          [buffer],
        )
      })
      .catch((error) => {
        if (settled) return
        settled = true
        finish()
        reject(
          error instanceof Error
            ? error
            : new Error("The selected file could not be opened."),
        )
      })
  })
}

export function countLandXmlGeometry(document: LandXmlDocument) {
  return document.surfaces.reduce(
    (summary, surface) => ({
      points: summary.points + Object.keys(surface.points).length,
      faces: summary.faces + surface.faces.length,
    }),
    { points: 0, faces: 0 },
  )
}
