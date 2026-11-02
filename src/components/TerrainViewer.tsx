import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { TerrainMesh } from "../lib/contourTerrain";
import CanvasTerrainView from "./CanvasTerrainView";

export default function TerrainViewer({ mesh, smooth = false, label = "Interactive 3D contour terrain; drag to rotate, use two fingers or the wheel to zoom", caption = "Exports always retain true elevations.", fallbackFaceLimit = Infinity }: { mesh: TerrainMesh; smooth?: boolean; label?: string; caption?: string; fallbackFaceLimit?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [exaggeration, setExaggeration] = useState(1),
    [wireframe, setWireframe] = useState(false),
    [reset, setReset] = useState(0),
    [fallback, setFallback] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element || fallback) return;
    const canvas = document.createElement("canvas"),
      context = canvas.getContext("webgl2", { antialias: true, alpha: true });
    if (!context) {
      setFallback(true);
      return;
    }
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        context,
        antialias: true,
        alpha: true,
      });
    } catch {
      setFallback(true);
      return;
    }
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    mesh.vertices.forEach((v) => {
      minX = Math.min(minX, v[0]);
      maxX = Math.max(maxX, v[0]);
      minY = Math.min(minY, v[1]);
      maxY = Math.max(maxY, v[1]);
    });
    const span = Math.max(maxX - minX, maxY - minY),
      cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2,
      scale = 2 / span;
    const positions = new Float32Array(mesh.vertices.length * 3),
      colours = new Float32Array(mesh.vertices.length * 3),
      colour = new THREE.Color();
    mesh.vertices.forEach((v, i) => {
      positions.set(
        [
          (v[0] - cx) * scale,
          (v[2] - mesh.minZ) * scale * exaggeration,
          -(v[1] - cy) * scale,
        ],
        i * 3,
      );
      const t = (v[2] - mesh.minZ) / (mesh.maxZ - mesh.minZ || 1);
      colour.setHSL(0.53 - t * 0.31, 0.65, 0.45 + t * 0.12);
      colours.set([colour.r, colour.g, colour.b], i * 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    geometry.setIndex(mesh.faces.flat());
    geometry.computeVertexNormals();
    const scene = new THREE.Scene(),
      material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        roughness: 0.86,
        flatShading: !smooth,
      }),
      surface = new THREE.Mesh(geometry, material);
    scene.add(surface);
    scene.add(new THREE.AmbientLight(0xffffff, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(-1, 3, 2);
    scene.add(light);
    let wires: THREE.LineSegments | undefined;
    if (wireframe) {
      wires = new THREE.LineSegments(
        new THREE.WireframeGeometry(geometry),
        new THREE.LineBasicMaterial({
          color: 0x14283a,
          transparent: true,
          opacity: 0.5,
        }),
      );
      scene.add(wires);
    }
    const box = new THREE.Box3().setFromObject(surface),
      center = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3()),
      radius = Math.max(size.x, size.y, size.z) * 1.2;
    const camera = new THREE.PerspectiveCamera(
      45,
      1,
      0.001,
      Math.max(100, radius * 100),
    );
    camera.position
      .copy(center)
      .add(new THREE.Vector3(radius, radius * 0.9, radius));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x091523, 1);
    renderer.domElement.setAttribute(
      "aria-label",
      label,
    );
    renderer.domElement.setAttribute("role", "img");
    element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = false;
    controls.minDistance = radius * 0.05;
    controls.maxDistance = radius * 12;
    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);
    const resize = () => {
      const width = element.clientWidth,
        height = element.clientHeight;
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    controls.update();
    render();
    return () => {
      observer.disconnect();
      controls.removeEventListener("change", render);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      if (wires) {
        wires.geometry.dispose();
        (wires.material as THREE.Material).dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [mesh, exaggeration, wireframe, reset, fallback, smooth, label]);
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-xs text-slate-300">
        <span>Drag to rotate · pinch / scroll to zoom</span>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={wireframe}
              onChange={(e) => setWireframe(e.target.checked)}
            />
            TIN edges
          </label>
          <label className="flex items-center gap-2">
            Vertical exaggeration{" "}
            <select
              aria-label="Vertical exaggeration"
              value={exaggeration}
              onChange={(e) => setExaggeration(Number(e.target.value))}
              className="rounded border border-white/20 bg-slate-900 p-1"
            >
              {[1, 2, 3, 5].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </label>
          <button
            className="text-cyan-300 underline"
            onClick={() => setReset((n) => n + 1)}
          >
            Reset view
          </button>
        </div>
      </div>
      <div ref={host} className="h-[380px] w-full touch-none sm:h-[480px]">
        {fallback && mesh.faces.length > fallbackFaceLimit ? <div role="status" className="flex h-full items-center justify-center p-8 text-center text-sm text-amber-200">This browser cannot use hardware 3D. Use the full-detail plan or map for this large surface, or open 3D in a browser with WebGL enabled.</div> : fallback && (
          <CanvasTerrainView
            key={reset}
            mesh={mesh}
            exaggeration={exaggeration}
            wireframe={wireframe}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-white/10 px-4 py-3 text-xs text-slate-400">
        <span>{mesh.minZ.toFixed(3)}</span>
        <span className="h-2 w-32 rounded-full bg-gradient-to-r from-cyan-500 to-lime-400" />
        <span>{mesh.maxZ.toFixed(3)}</span>
        <span className="ml-auto">{caption}</span>
      </div>
    </div>
  );
}
