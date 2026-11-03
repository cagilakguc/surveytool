import { checkBottomSurfaceThickness } from "../lib/pavementBottomSurface"
import type { SurfaceThicknessRequest } from "../lib/pavementBottomSurface"
self.onmessage = (event: MessageEvent<SurfaceThicknessRequest>) => {
  try {
    const result = checkBottomSurfaceThickness(event.data, (percent) => self.postMessage({ type: "progress", percent }))
    self.postMessage({ type: "result", result })
  } catch (error) { self.postMessage({ type: "error", message: error instanceof Error ? error.message : "The bottom surface thickness check failed." }) }
}
