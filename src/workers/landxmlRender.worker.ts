import type { DisplaySurface } from "../lib/landxmlDisplay";
import { rasterTin, type RasterView } from "../lib/rasterTin";
let meshes: DisplaySurface[] = [];
self.onmessage = (
  event: MessageEvent<{
    type: string;
    meshes: DisplaySurface[];
    id: number;
    width: number;
    height: number;
    view: RasterView;
    elevation: boolean;
    showFaces: boolean;
  }>,
) => {
  const input = event.data;
  if (input.type === "init") {
    meshes = input.meshes;
    return;
  }
  if (input.type !== "draw") return;
  try {
    const pixels = rasterTin(
      meshes,
      input.width,
      input.height,
      input.view,
      input.elevation,
      input.showFaces,
    );
    self.postMessage(
      {
        id: input.id,
        width: input.width,
        height: input.height,
        pixels: pixels.buffer,
      },
      { transfer: [pixels.buffer] },
    );
  } catch {
    self.postMessage({
      id: input.id,
      error: "The surface display could not be drawn at this size.",
    });
  }
};
