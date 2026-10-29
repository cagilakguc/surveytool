import { checkAsBuilt } from "../lib/asBuiltConformance";
import type { CheckRequest } from "../lib/asBuiltConformance";
self.onmessage = (event: MessageEvent<CheckRequest>) => {
  try {
    const result = checkAsBuilt(event.data, (percent) =>
      self.postMessage({ type: "progress", percent }),
    );
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "The design check could not be completed.",
    });
  }
};
