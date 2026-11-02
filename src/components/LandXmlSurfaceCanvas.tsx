import { useEffect, useMemo, useRef, useState } from "react";
import type { LandXmlSurface } from "../lib/landxml";
import { prepareDisplaySurface } from "../lib/landxmlDisplay";

type ViewBox = { x: number; y: number; width: number; height: number };
type Props = {
  surfaces: LandXmlSurface[];
  projection: {
    project: (point: {
      easting: number;
      northing: number;
      elevation: number | null;
    }) => { x: number; y: number };
  };
  viewBox: ViewBox;
  showFaces: boolean;
  showVertices: boolean;
  edges: boolean;
  elevation: boolean;
};
type Frame = {
  id: number;
  width: number;
  height: number;
  view: ViewBox;
  showFaces: boolean;
  showVertices: boolean;
  edges: boolean;
  elevation: boolean;
};

export default function LandXmlSurfaceCanvas({
  surfaces,
  projection,
  viewBox,
  showFaces,
  showVertices,
  edges,
  elevation,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const redraw = useRef<() => void>(() => {});
  const latest = useRef({ viewBox, showFaces, showVertices, edges, elevation });
  latest.current = { viewBox, showFaces, showVertices, edges, elevation };
  const [error, setError] = useState("");
  const meshes = useMemo(
    () =>
      surfaces.map((surface) =>
        prepareDisplaySurface(surface, (easting, northing) => {
          const p = projection.project({ easting, northing, elevation: null });
          return [p.x, p.y];
        }),
      ),
    [surfaces, projection],
  );
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const worker = new Worker(
      new URL("../workers/landxmlRender.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.postMessage({ type: "init", meshes });
    let sequence = 0,
      busy = false,
      pending: Frame | null = null,
      running: Frame | null = null,
      raf = 0;
    function send(frame: Frame) {
      busy = true;
      running = frame;
      worker.postMessage({ type: "draw", ...frame });
    }
    function request() {
      raf = 0;
      const rect = canvas!.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        3,
        Math.sqrt(8_000_000 / (rect.width * rect.height)),
      );
      const options = latest.current;
      const next: Frame = {
        id: ++sequence,
        width: Math.max(1, Math.round(rect.width * ratio)),
        height: Math.max(1, Math.round(rect.height * ratio)),
        view: options.viewBox,
        showFaces: options.showFaces,
        showVertices: options.showVertices,
        edges: options.edges,
        elevation: options.elevation,
      };
      if (busy) pending = next;
      else send(next);
    }
    redraw.current = () => {
      if (!raf) raf = requestAnimationFrame(request);
    };
    worker.onmessage = (event) => {
      const result = event.data;
      const frame = running;
      busy = false;
      if (result.error) setError(result.error);
      else if (frame && result.id === sequence) {
        setError("");
        canvas.width = result.width;
        canvas.height = result.height;
        ctx.putImageData(
          new ImageData(
            new Uint8ClampedArray(result.pixels),
            result.width,
            result.height,
          ),
          0,
          0,
        );
        const sx = result.width / frame.view.width,
          sy = result.height / frame.view.height;
        ctx.setTransform(sx, 0, 0, sy, -frame.view.x * sx, -frame.view.y * sy);
        if (frame.edges && frame.showFaces) {
          const path = new Path2D();
          for (const mesh of meshes)
            for (let f = 0; f < mesh.indices.length; f += 3) {
              const [a, b, c] = [
                  mesh.indices[f] * 3,
                  mesh.indices[f + 1] * 3,
                  mesh.indices[f + 2] * 3,
                ],
                p = mesh.positions;
              path.moveTo(p[a], p[a + 1]);
              path.lineTo(p[b], p[b + 1]);
              path.lineTo(p[c], p[c + 1]);
              path.closePath();
            }
          ctx.strokeStyle = "rgba(3,16,32,.65)";
          ctx.lineWidth = (0.7 * result.width) / canvas.clientWidth / sx;
          ctx.stroke(path);
        }
        if (frame.showVertices) {
          ctx.fillStyle = "#e0f2fe";
          for (const mesh of meshes)
            for (let i = 0; i < mesh.positions.length; i += 3) {
              const x = mesh.positions[i],
                y = mesh.positions[i + 1];
              if (
                x < frame.view.x ||
                x > frame.view.x + frame.view.width ||
                y < frame.view.y ||
                y > frame.view.y + frame.view.height
              )
                continue;
              ctx.beginPath();
              ctx.arc(
                x,
                y,
                (1.6 * result.width) / canvas.clientWidth / sx,
                0,
                Math.PI * 2,
              );
              ctx.fill();
            }
        }
      }
      if (pending) {
        const next = pending;
        pending = null;
        send(next);
      }
    };
    worker.onerror = () =>
      setError("The full-detail plan could not start. Try map or 3D view.");
    const observer = new ResizeObserver(() => redraw.current());
    observer.observe(canvas);
    redraw.current();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      worker.terminate();
      redraw.current = () => {};
    };
  }, [meshes]);
  useEffect(() => {
    redraw.current();
  }, [viewBox, showFaces, showVertices, edges, elevation]);
  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {error && (
        <p
          role="status"
          className="pointer-events-none absolute bottom-3 left-3 z-10 rounded bg-slate-950/95 p-3 text-xs text-amber-200"
        >
          {error}
        </p>
      )}
    </>
  );
}
