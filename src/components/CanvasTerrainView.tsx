import { useEffect, useRef } from "react";
import type { TerrainMesh } from "../lib/contourTerrain";

// Software projection keeps the 3D preview usable when WebGL is unavailable.
export default function CanvasTerrainView({
  mesh,
  exaggeration,
  wireframe,
}: {
  mesh: TerrainMesh;
  exaggeration: number;
  wireframe: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    canvas.setAttribute("role", "img");
    canvas.setAttribute(
      "aria-label",
      "Interactive 3D contour terrain; drag to rotate, pinch or scroll to zoom",
    );
    element.appendChild(canvas);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const v of mesh.vertices) {
      minX = Math.min(minX, v[0]);
      maxX = Math.max(maxX, v[0]);
      minY = Math.min(minY, v[1]);
      maxY = Math.max(maxY, v[1]);
    }
    const span = Math.max(maxX - minX, maxY - minY),
      cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2,
      cz = (mesh.minZ + mesh.maxZ) / 2;
    const points = mesh.vertices.map((v) => [
      (v[0] - cx) / span,
      (v[1] - cy) / span,
      ((v[2] - cz) / span) * exaggeration,
    ]);
    let yaw = -0.65,
      pitch = 0.82,
      zoom = 1,
      width = 1,
      height = 1,
      frame = 0,
      lastX = 0,
      lastY = 0,
      pinch = 0;
    const pointers = new Map<number, [number, number]>();
    function draw() {
      frame = 0;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx!.fillStyle = "#091523";
      ctx!.fillRect(0, 0, width, height);
      const co = Math.cos(yaw),
        si = Math.sin(yaw),
        cp = Math.cos(pitch),
        sp = Math.sin(pitch);
      const projected = points.map((p) => {
        const x = p[0] * co - p[1] * si,
          y = p[0] * si + p[1] * co;
        return [x, y * cp - p[2] * sp, y * sp + p[2] * cp];
      });
      let minU = Infinity,
        maxU = -Infinity,
        minV = Infinity,
        maxV = -Infinity;
      for (const p of projected) {
        minU = Math.min(minU, p[0]);
        maxU = Math.max(maxU, p[0]);
        minV = Math.min(minV, p[1]);
        maxV = Math.max(maxV, p[1]);
      }
      const scale =
          Math.min(
            (width * 0.8) / (maxU - minU || 1),
            (height * 0.8) / (maxV - minV || 1),
          ) * zoom,
        ox = width / 2 - ((minU + maxU) / 2) * scale,
        oy = height / 2 - ((minV + maxV) / 2) * scale;
      const sorted = mesh.faces
        .map((f) => ({
          f,
          depth:
            (projected[f[0]][2] + projected[f[1]][2] + projected[f[2]][2]) / 3,
        }))
        .sort((a, b) => a.depth - b.depth);
      for (const { f } of sorted) {
        const [a, b, c] = f.map((i) => projected[i]),
          level = f.reduce((s, i) => s + mesh.vertices[i][2], 0) / 3,
          t = (level - mesh.minZ) / (mesh.maxZ - mesh.minZ || 1);
        const base = points[f[0]],
          u = points[f[1]].map((v, i) => v - base[i]),
          v = points[f[2]].map((v, i) => v - base[i]),
          normal = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
          ];
        const light =
          0.7 +
          0.3 *
            Math.abs(
              (normal[0] * -0.3 + normal[1] * -0.4 + normal[2] * 0.86) /
                (Math.hypot(...normal) || 1),
            );
        const colour = `rgb(${Math.round((20 + t * 143) * light)},${Math.round((184 + t * 46) * light)},${Math.round((216 - t * 163) * light)})`;
        ctx!.beginPath();
        ctx!.moveTo(ox + a[0] * scale, oy + a[1] * scale);
        ctx!.lineTo(ox + b[0] * scale, oy + b[1] * scale);
        ctx!.lineTo(ox + c[0] * scale, oy + c[1] * scale);
        ctx!.closePath();
        ctx!.fillStyle = colour;
        ctx!.fill();
        ctx!.strokeStyle = wireframe ? "#18333b" : colour;
        ctx!.lineWidth = wireframe ? 0.7 : 0.6;
        ctx!.stroke();
      }
      ctx!.fillStyle = "#94a3b8";
      ctx!.font = "12px sans-serif";
      ctx!.fillText("3D terrain · drag to rotate", 16, height - 18);
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const resize = () => {
      width = element.clientWidth;
      height = element.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      schedule();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      lastX = e.clientX;
      lastY = e.clientY;
      pinch = 0;
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()],
          distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) zoom = Math.max(0.2, Math.min(8, (zoom * distance) / pinch));
        pinch = distance;
      } else {
        yaw += (e.clientX - lastX) * 0.006;
        pitch = Math.max(
          0.12,
          Math.min(1.5, pitch + (e.clientY - lastY) * 0.006),
        );
      }
      lastX = e.clientX;
      lastY = e.clientY;
      schedule();
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = 0;
      const remaining = [...pointers.values()][0];
      if (remaining) {
        lastX = remaining[0];
        lastY = remaining[1];
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom = Math.max(0.2, Math.min(8, zoom * Math.exp(-e.deltaY * 0.001)));
      schedule();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
      canvas.remove();
    };
  }, [mesh, exaggeration, wireframe]);
  return <div ref={host} className="h-full w-full" />;
}
