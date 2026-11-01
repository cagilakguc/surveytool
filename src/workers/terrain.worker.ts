import { readContourFile, buildContourTerrain } from "../lib/contourTerrain";
import type { TerrainInput, TerrainSettings } from "../lib/contourTerrain";
self.onmessage = async (
  event: MessageEvent<
    | { type: "parse"; file: File }
    | { type: "build"; input: TerrainInput; settings: TerrainSettings }
  >,
) => {
  try {
    const task = event.data;
    const value =
      task.type === "parse"
        ? await readContourFile(task.file)
        : buildContourTerrain(task.input, task.settings);
    self.postMessage({ ok: true, value });
  } catch (error) {
    self.postMessage({
      ok: false,
      error:
        error instanceof Error ? error.message : "Terrain processing failed.",
    });
  }
};
