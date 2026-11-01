import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  deleteWorkspace,
  listWorkspaces,
  projectLabels,
  projectRoutes,
} from "../lib/projectWorkspace";
import type { WorkspaceProject } from "../lib/projectWorkspace";
import PageSeo from "../components/PageSeo";
import OfflineStatus from "../components/OfflineStatus";
import { downloadReportBlob, safeReportName } from "../lib/surveyReports";
export default function LocalProjects() {
  const [projects, setProjects] = useState<WorkspaceProject[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState("");
  const [busy, setBusy] = useState(false);
  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      await deleteWorkspace(id);
      setProjects((items) => items.filter((p) => p.id !== id));
      setDeleting("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The saved project could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    listWorkspaces()
      .then((data) => {
        if (active) setProjects(data);
      })
      .catch(() => {
        if (active)
          setError(
            "Project storage is unavailable in this browser. You can still open downloaded project files inside each tool.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="relative z-10 mx-auto min-h-screen max-w-6xl px-6 py-20">
      <PageSeo
        title="Saved Survey Projects | SurveyTool.io"
        description="Reopen survey files and analysis settings saved on your device."
        canonicalUrl="https://www.surveytool.io/projects"
      />
      <Link to="/" className="text-cyan-300">
        ← SurveyTool
      </Link>
      <h1 className="mt-8 text-4xl font-bold">Saved projects</h1>
      <p className="mt-4 max-w-2xl leading-7 text-slate-400">
        Your saved files and settings are stored on this device. Use Download
        project file inside a tool to keep a portable backup. Reopening a
        project recalculates its results.
      </p>
      <OfflineStatus />
      <div className="mt-6 flex flex-wrap gap-3">
        {[
          ["Contours to 3D", "/tools/contours-to-terrain"],
          ["LandXML Viewer", "/tools/landxml-viewer"],
          ["Cross Sections", "/tools/cross-section"],
        ].map(([label, to]) => (
          <Link
            key={to}
            to={to}
            className="inline-flex min-h-11 items-center rounded-xl border border-white/15 px-4 py-2 text-sm text-cyan-200"
          >
            {label} →
          </Link>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-6 text-amber-200">
          {error}
        </p>
      )}
      {loading ? (
        <p className="mt-8">Loading projects…</p>
      ) : projects.length ? (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {projects.map((project) => (
            <article
              key={project.id}
              className="rounded-2xl border border-white/10 bg-white/5 p-6"
            >
              <p className="text-xs text-cyan-300">
                {projectLabels[project.tool]}
              </p>
              <h2 className="mt-2 text-xl font-semibold">{project.title}</h2>
              <p className="mt-2 text-xs text-slate-400">
                Saved {new Date(project.savedAt).toLocaleString()}
              </p>
              <Link
                to={`${projectRoutes[project.tool]}?project=${encodeURIComponent(project.id)}`}
                className="mt-5 inline-block rounded-full bg-cyan-300 px-5 py-2 text-sm font-semibold text-slate-950"
              >
                Open project
              </Link>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      downloadReportBlob(
                        JSON.stringify(project),
                        "application/json",
                        `${safeReportName(project.title)}.surveytool.json`,
                      );
                    } catch {
                      setError("The project backup could not be prepared.");
                    }
                  }}
                  className="min-h-11 rounded-xl border border-white/15 px-4 py-2 text-xs"
                >
                  Download backup
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDeleting(project.id)}
                  className="min-h-11 px-2 text-xs text-slate-400 underline"
                >
                  Remove
                </button>
              </div>
              {deleting === project.id && (
                <div
                  role="group"
                  aria-label={`Confirm removal of ${project.title}`}
                  className="mt-4 rounded-xl border border-rose-300/20 bg-rose-300/5 p-4 text-xs text-rose-100"
                >
                  <p>
                    Remove this saved copy from this device? Download a backup
                    first if you need to keep it.
                  </p>
                  <div className="mt-3 flex gap-4">
                    <button
                      disabled={busy}
                      onClick={() => void remove(project.id)}
                      className="min-h-10 rounded-lg bg-rose-300 px-4 font-semibold text-slate-950"
                    >
                      Remove saved copy
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setDeleting("")}
                      className="min-h-10 underline"
                    >
                      Keep project
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-10 rounded-2xl border border-dashed border-white/20 p-8 text-slate-400">
          No projects saved yet. Open a tool and use{" "}
          <strong className="text-white">Save / reopen project</strong>.
          <Link to="/tools/as-built-check" className="mt-5 block text-cyan-300">
            Open As-built vs Design →
          </Link>
        </div>
      )}
    </div>
  );
}
