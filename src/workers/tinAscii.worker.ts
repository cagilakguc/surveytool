import { parseTinAscii } from "../lib/tinAscii"

self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer; fileName: string }>) => {
  try {
    self.postMessage({ type: "progress", stage: "Reading ASCII TIN", percent: 30 })
    const text = new TextDecoder("utf-8", { fatal: true }).decode(event.data.buffer)
    const document = parseTinAscii(text, event.data.fileName)
    self.postMessage({ type: "result", document })
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "Unable to read this TIN file." })
  }
}
