import { adjustNetwork } from "../lib/networkAdjustment"
import type { NetworkInput } from "../lib/networkAdjustment"
self.onmessage = (event: MessageEvent<NetworkInput>) => {
  try { self.postMessage({ result: adjustNetwork(event.data) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "The network could not be adjusted." }) }
}
