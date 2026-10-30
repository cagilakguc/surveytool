import type { LandXmlDocument } from "./landxml";
import type { SurveyPointLayer } from "./surveyPoints";

export const projectRoutes: Record<string, string> = {
  asbuilt: "/tools/as-built-check",
  landxml: "/tools/landxml-viewer",
  surfaces: "/tools/surface-compare",
  sections: "/tools/cross-section",
  pavement: "/tools/pavement-conformance",
  coordinates: "/tools/coordinate-converter",
  gis: "/tools/gis-export",
};
export const projectLabels: Record<string, string> = {
  asbuilt: "As-built vs Design",
  landxml: "LandXML Viewer",
  surfaces: "Surface Compare",
  sections: "Cross Sections",
  pavement: "Pavement Conformance",
  coordinates: "Coordinate Converter",
  gis: "GIS Export",
};
export type WorkspaceProject = {
  format: "surveytool-project";
  version: 1;
  id: string;
  tool: string;
  title: string;
  savedAt: string;
  state: Record<string, unknown>;
};
export const maximumProjectBytes = 100 * 1024 * 1024;
export function workspaceId() {
  if (typeof globalThis.crypto?.randomUUID === "function")
    return globalThis.crypto.randomUUID();
  const bytes = new Uint32Array(4);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
    return `project-${Array.from(bytes, (n) => n.toString(16).padStart(8, "0")).join("")}`;
  }
  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid project data.");
  return value as Record<string, unknown>;
}
export function assertDocument(
  value: unknown,
): asserts value is LandXmlDocument {
  const doc = record(value);
  if (
    typeof doc.fileName !== "string" ||
    typeof doc.units !== "string" ||
    !Array.isArray(doc.surfaces) ||
    !Array.isArray(doc.alignments) ||
    !Array.isArray(doc.cogoPoints)
  )
    throw new Error("The project contains an invalid LandXML document.");
  let pointCount = 0,
    faceCount = 0;
  for (const item of doc.surfaces) {
    const surface = record(item),
      points = record(surface.points);
    if (typeof surface.name !== "string" || !Array.isArray(surface.faces))
      throw new Error("Invalid saved surface.");
    pointCount += Object.keys(points).length;
    faceCount += surface.faces.length;
    if (pointCount > 2_000_000 || faceCount > 2_000_000)
      throw new Error("The saved surface exceeds the workspace limits.");
    for (const raw of Object.values(points)) {
      const point = record(raw);
      if (
        !Number.isFinite(point.easting) ||
        !Number.isFinite(point.northing) ||
        (point.elevation !== null && !Number.isFinite(point.elevation))
      )
        throw new Error("Invalid saved surface coordinates.");
    }
    for (const face of surface.faces)
      if (
        !Array.isArray(face) ||
        face.length !== 3 ||
        face.some((id) => typeof id !== "string")
      )
        throw new Error("Invalid saved TIN face.");
  }
  for (const raw of doc.alignments) {
    const line = record(raw);
    if (
      typeof line.name !== "string" ||
      !Array.isArray(line.points) ||
      line.points.some(
        (p) =>
          !p || !Number.isFinite(p.easting) || !Number.isFinite(p.northing),
      )
    )
      throw new Error("Invalid saved alignment.");
    if (line.horizontalGeometry !== undefined) {
      if (!Array.isArray(line.horizontalGeometry) || line.horizontalGeometry.length > 100_000) throw new Error("Invalid saved horizontal geometry.");
      for (const rawGeometry of line.horizontalGeometry) {
        const geometry = record(rawGeometry), attributes = record(geometry.attributes);
        if (typeof geometry.type !== "string" || Object.values(attributes).some((v) => typeof v !== "string")) throw new Error("Invalid saved alignment geometry.");
        for (const rawPoint of [geometry.start, geometry.end, geometry.center]) if (rawPoint !== undefined && rawPoint !== null) {
          const point = record(rawPoint);
          if (!Number.isFinite(point.easting) || !Number.isFinite(point.northing)) throw new Error("Invalid saved alignment coordinates.");
        }
        if (geometry.points !== undefined && (!Array.isArray(geometry.points) || geometry.points.length > 500_000 || geometry.points.some((p) => !p || !Number.isFinite(p.easting) || !Number.isFinite(p.northing)))) throw new Error("Invalid saved alignment point list.");
      }
    }
    if (line.pointChainages !== undefined && (!Array.isArray(line.pointChainages) || line.pointChainages.length !== line.points.length || !line.pointChainages.every(Number.isFinite))) throw new Error("Invalid saved alignment chainages.");
  }
}
export function assertPointLayer(
  value: unknown,
): asserts value is SurveyPointLayer {
  const layer = record(value);
  if (
    typeof layer.name !== "string" ||
    !["CSV", "TXT", "DXF"].includes(String(layer.format)) ||
    !Array.isArray(layer.points) ||
    layer.points.length > 500_000 ||
    !Array.isArray(layer.warnings) ||
    layer.warnings.some((warning) => typeof warning !== "string")
  )
    throw new Error("Invalid saved point file.");
  for (const raw of layer.points) {
    const point = record(raw);
    if (
      typeof point.id !== "string" ||
      typeof point.code !== "string" ||
      ![point.easting, point.northing, point.elevation].every(Number.isFinite)
    )
      throw new Error("Invalid saved measured point.");
  }
}
export function validateProject(value: unknown): WorkspaceProject {
  const data = record(value);
  if (
    data.format !== "surveytool-project" ||
    data.version !== 1 ||
    typeof data.tool !== "string" ||
    !projectRoutes[data.tool] ||
    typeof data.id !== "string" ||
    !/^[\w-]{1,100}$/.test(data.id) ||
    typeof data.title !== "string" ||
    data.title.length > 200 ||
    typeof data.savedAt !== "string" ||
    !Number.isFinite(Date.parse(data.savedAt))
  )
    throw new Error("This is not a supported SurveyTool project file.");
  record(data.state);
  return data as WorkspaceProject;
}
export function parseProjectFile(text: string) {
  if (text.length > maximumProjectBytes)
    throw new Error("Choose a project file smaller than 100 MB.");
  return validateProject(JSON.parse(text));
}
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("surveytool-workspaces", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("projects"))
        request.result.createObjectStore("projects", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Project storage is unavailable."));
    request.onblocked = () =>
      reject(
        new Error("Close other SurveyTool tabs and retry project storage."),
      );
  });
}
export async function saveWorkspace(project: WorkspaceProject) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").put(project);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(
        tx.error ??
          new Error(
            "Project could not be saved. Download a project file instead.",
          ),
      );
    };
    tx.onabort = tx.onerror;
  });
}
export async function listWorkspaces(tool?: string) {
  const db = await database();
  return new Promise<WorkspaceProject[]>((resolve, reject) => {
    const tx = db.transaction("projects", "readonly"),
      request = tx.objectStore("projects").getAll();
    request.onsuccess = () => {
      db.close();
      resolve(
        (request.result as WorkspaceProject[])
          .filter((item) => !tool || item.tool === tool)
          .sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
      );
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}
export async function loadWorkspace(id: string) {
  const db = await database();
  return new Promise<WorkspaceProject>((resolve, reject) => {
    const request = db
      .transaction("projects", "readonly")
      .objectStore("projects")
      .get(id);
    request.onsuccess = () => {
      db.close();
      try {
        resolve(validateProject(request.result));
      } catch (error) {
        reject(error);
      }
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export function assertGeometryLayer(value: unknown) {
  const layer = record(value);
  assertPointLayer(value);
  if (
    !Array.isArray(layer.lines) ||
    !Array.isArray(layer.polygons) ||
    layer.lines.length + layer.polygons.length > 500_000
  )
    throw new Error("Invalid saved GIS geometry.");
  let vertices = 0;
  const path = (items: unknown) => {
    if (!Array.isArray(items)) throw new Error("Invalid saved vertices.");
    vertices += items.length;
    if (vertices > 2_000_000)
      throw new Error("Saved geometry exceeds the vertex limit.");
    for (const raw of items) {
      const p = record(raw);
      if (![p.easting, p.northing, p.elevation].every(Number.isFinite))
        throw new Error("Invalid saved vertex.");
    }
  };
  for (const raw of layer.lines) {
    const line = record(raw);
    if (typeof line.id !== "string" || typeof line.code !== "string")
      throw new Error("Invalid saved line.");
    path(line.vertices);
  }
  for (const raw of layer.polygons) {
    const polygon = record(raw);
    if (
      typeof polygon.id !== "string" ||
      typeof polygon.code !== "string" ||
      !Array.isArray(polygon.rings)
    )
      throw new Error("Invalid saved polygon.");
    for (const ring of polygon.rings) path(ring);
  }
}
