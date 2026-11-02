import { checkPavementDesign } from "../lib/pavementDesign"
import type { PavementDesignRequest } from "../lib/pavementDesign"

self.onmessage = (event: MessageEvent<PavementDesignRequest>) => {
  try {
    const result = checkPavementDesign(event.data, (percent) => self.postMessage({ type: "progress", percent }))
    self.postMessage({ type: "result", result })
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "The pavement design check failed." })
  }
}
