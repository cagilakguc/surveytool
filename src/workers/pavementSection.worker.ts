import { analysePavementSection } from "../lib/pavementSection"
import type { PavementSectionRequest } from "../lib/pavementSection"
self.onmessage = (event: MessageEvent<PavementSectionRequest>) => {
  try { self.postMessage({ result: analysePavementSection(event.data) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "The section could not be created." }) }
}
