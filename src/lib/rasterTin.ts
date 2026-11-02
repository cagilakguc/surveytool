import type { DisplaySurface } from "./landxmlDisplay";

export type RasterView = {
  x: number;
  y: number;
  width: number;
  height: number;
};
const stops = [
  [37, 99, 235],
  [6, 182, 212],
  [132, 204, 22],
  [251, 191, 36],
];
const uniform = [
  [34, 211, 238],
  [96, 165, 250],
  [167, 139, 250],
  [52, 211, 153],
  [244, 114, 182],
];

// Scanline rasterisation interpolates the original triangle plane at each
// screen pixel. Shared edges have identical heights and leave no dark seams.
// This runs in a worker, and redraws at display resolution after every zoom.
export function rasterTin(
  meshes: DisplaySurface[],
  width: number,
  height: number,
  view: RasterView,
  elevation: boolean,
  showFaces: boolean,
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 9_000_000 ||
    !Number.isFinite(view.width) ||
    !Number.isFinite(view.height) ||
    view.width <= 0 ||
    view.height <= 0
  )
    throw new Error("Invalid display size.");
  const pixels = new Uint8ClampedArray(width * height * 4);
  if (!showFaces) return pixels;
  const sx = width / view.width,
    sy = height / view.height;
  meshes.forEach((mesh, surfaceIndex) => {
    const p = mesh.positions,
      indices = mesh.indices,
      range = mesh.maxZ - mesh.minZ;
    for (let f = 0; f < indices.length; f += 3) {
      const a = indices[f] * 3,
        b = indices[f + 1] * 3,
        c = indices[f + 2] * 3;
      const ax = (p[a] - view.x) * sx,
        ay = (p[a + 1] - view.y) * sy;
      const bx = (p[b] - view.x) * sx,
        by = (p[b + 1] - view.y) * sy;
      const cx = (p[c] - view.x) * sx,
        cy = (p[c + 1] - view.y) * sy;
      const firstY = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5));
      const lastY = Math.min(
        height - 1,
        Math.floor(Math.max(ay, by, cy) - 0.5),
      );
      if (
        firstY > lastY ||
        Math.max(ax, bx, cx) < 0 ||
        Math.min(ax, bx, cx) > width
      )
        continue;
      const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (!det || !Number.isFinite(det)) continue;
      const coloured =
        elevation && Number.isFinite(p[a + 2] + p[b + 2] + p[c + 2]);
      const gx = coloured
        ? ((p[b + 2] - p[a + 2]) * (cy - ay) -
            (p[c + 2] - p[a + 2]) * (by - ay)) /
          det
        : 0;
      const gy = coloured
        ? ((bx - ax) * (p[c + 2] - p[a + 2]) -
            (cx - ax) * (p[b + 2] - p[a + 2])) /
          det
        : 0;
      const base = uniform[surfaceIndex % uniform.length];
      for (let y = firstY; y <= lastY; y++) {
        const py = y + 0.5;
        let left = Infinity,
          right = -Infinity;
        if ((ay <= py && by > py) || (by <= py && ay > py)) {
          const x = ax + ((py - ay) * (bx - ax)) / (by - ay);
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
        if ((by <= py && cy > py) || (cy <= py && by > py)) {
          const x = bx + ((py - by) * (cx - bx)) / (cy - by);
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
        if ((cy <= py && ay > py) || (ay <= py && cy > py)) {
          const x = cx + ((py - cy) * (ax - cx)) / (ay - cy);
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
        const firstX = Math.max(0, Math.ceil(left - 0.5 - 1e-7)),
          lastX = Math.min(width - 1, Math.floor(right - 0.5 + 1e-7));
        let z = p[a + 2] + gx * (firstX + 0.5 - ax) + gy * (py - ay);
        for (let x = firstX; x <= lastX; x++, z += gx) {
          const offset = (y * width + x) * 4;
          if (coloured) {
            const t =
              Math.max(0, Math.min(1, (z - mesh.minZ) / (range || 1))) * 3;
            const i = Math.min(2, Math.floor(t)),
              fraction = t - i;
            pixels[offset] =
              stops[i][0] + (stops[i + 1][0] - stops[i][0]) * fraction;
            pixels[offset + 1] =
              stops[i][1] + (stops[i + 1][1] - stops[i][1]) * fraction;
            pixels[offset + 2] =
              stops[i][2] + (stops[i + 1][2] - stops[i][2]) * fraction;
          } else {
            pixels[offset] = base[0];
            pixels[offset + 1] = base[1];
            pixels[offset + 2] = base[2];
          }
          pixels[offset + 3] = 255;
        }
      }
    }
  });
  return pixels;
}
