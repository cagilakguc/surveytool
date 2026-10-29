import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  listWorkspaces,
  loadWorkspace,
  maximumProjectBytes,
  parseProjectFile,
  projectLabels,
  saveWorkspace,
  workspaceId,
} from "../lib/projectWorkspace";
import type { WorkspaceProject } from "../lib/projectWorkspace";
import { downloadReportBlob, safeReportName } from "../lib/surveyReports";

export default function ProjectPanel({
  tool,
  state,
  onRestore,
  disabled = false,
}: {
  tool: string;
  state: Record<string, unknown>;
  onRestore: (state: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [id, setId] = useState("");
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [prepared, setPrepared] = useState<{
    url: string;
    fileName: string;
  } | null>(null);
  useEffect(() => {
    setPrepared(null);
  }, [state]);
  useEffect(
    () => () => {
      if (prepared) URL.revokeObjectURL(prepared.url);
    },
    [prepared],
  );
  const input = useRef<HTMLInputElement>(null),
    restore = useRef(onRestore);
  restore.current = onRestore;
  const requested = new URLSearchParams(window.location.search).get("project");
  useEffect(() => {
    let active = true;
    listWorkspaces(tool)
      .then((items) => {
        if (active) setProjects(items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [tool]);
  const apply = useCallback(
    (project: WorkspaceProject) => {
      if (project.tool !== tool)
        throw new Error(`Open this project in ${projectLabels[project.tool]}.`);
      restore.current(project.state);
      setTitle(project.title);
      setId(project.id);
      setMessage("Project opened. Run the check again to refresh results.");
    },
    [tool],
  );
  useEffect(() => {
    if (!requested) return;
    let active = true;
    loadWorkspace(requested)
      .then((project) => {
        if (active) apply(project);
      })
      .catch((error) => {
        if (active)
          setMessage(
            error instanceof Error
              ? error.message
              : "Project could not be opened.",
          );
      });
    return () => {
      active = false;
    };
  }, [tool, requested, apply]);
  function snapshot(): WorkspaceProject {
    return {
      format: "surveytool-project",
      version: 1,
      id: id || workspaceId(),
      tool,
      title: title.trim() || projectLabels[tool],
      savedAt: new Date().toISOString(),
      state,
    };
  }
  async function save() {
    setBusy(true);
    try {
      const project = snapshot();
      await saveWorkspace(project);
      setId(project.id);
      setTitle(project.title);
      setProjects(await listWorkspaces(tool));
      setMessage(
        "Saved on this device. Download a project file for a portable backup.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Project could not be saved. Download a project file instead.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function openFile(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > maximumProjectBytes)
        throw new Error("Choose a project file smaller than 100 MB.");
      apply(parseProjectFile(await file.text()));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Project file could not be opened.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="my-6 rounded-2xl border border-white/10 bg-slate-900/60 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-cyan-200">
        Save / reopen project
      </summary>
      <p className="mt-3 text-xs leading-5 text-slate-400">
        Files and settings are saved in this browser. Download a project file to
        back up or move your work. Results are recalculated after reopening.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          aria-label="Saved project name"
          maxLength={200}
          placeholder="Project name"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="min-w-0 rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => void save()}
          className="rounded-lg bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950"
        >
          {id ? "Save changes" : "Save project"}
        </button>
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => {
            try {
              const data = snapshot();
              setPrepared(
                downloadReportBlob(
                  JSON.stringify(data),
                  "application/json",
                  `${safeReportName(data.title)}.surveytool.json`,
                  true,
                ),
              );
              setMessage("Project file prepared.");
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Could not create the project file.",
              );
            }
          }}
          className="rounded-lg border border-white/20 px-3 py-2 text-xs"
        >
          Download project file
        </button>
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => input.current?.click()}
          className="rounded-lg border border-white/20 px-3 py-2 text-xs"
        >
          Open project file
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            void openFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <select
          aria-label="Saved projects on this device"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          className="min-w-0 max-w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-xs"
        >
          <option value="">Choose a saved project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title} · {new Date(project.savedAt).toLocaleString()}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selected || busy || disabled}
          onClick={() => {
            setBusy(true);
            loadWorkspace(selected)
              .then(apply)
              .catch((error) => setMessage(String(error)))
              .finally(() => setBusy(false));
          }}
          className="rounded-lg border border-white/20 px-3 py-2 text-xs disabled:opacity-40"
        >
          Open saved project
        </button>
        <Link
          to="/projects"
          className="px-2 py-2 text-xs text-cyan-300 underline"
        >
          All saved projects
        </Link>
      </div>
      {prepared && (
        <a
          href={prepared.url}
          download={prepared.fileName}
          className="mt-3 block text-xs text-cyan-300 underline"
        >
          Download prepared project file
        </a>
      )}
      {message && (
        <p role="status" className="mt-3 text-xs text-amber-100">
          {message}
        </p>
      )}
    </details>
  );
}
