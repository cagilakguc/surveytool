import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  offlineAvailability,
  protectProjectStorage,
} from "../lib/offlineAccess";

function useConnection() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function OfflineNotice() {
  const online = useConnection();
  if (online) return null;
  return (
    <aside
      role="status"
      className="fixed bottom-4 left-4 z-50 max-w-[min(340px,calc(100vw-90px))] rounded-2xl border border-amber-300/30 bg-slate-950/95 px-4 py-3 text-xs text-amber-100 shadow-xl"
    >
      <strong>You’re offline.</strong> Saved survey data and local calculations
      remain available. Background maps, sign-in and cloud services need a
      connection.
      <Link
        to="/projects"
        className="mt-2 block font-semibold text-cyan-200 underline"
      >
        Open saved projects →
      </Link>
    </aside>
  );
}

export default function OfflineStatus() {
  const online = useConnection(),
    [availability, setAvailability] = useState({
      ready: false,
      updateReady: false,
    }),
    [checking, setChecking] = useState(true),
    [persistent, setPersistent] = useState(false);
  const check = useCallback(async () => {
    setChecking(true);
    try {
      setAvailability(await offlineAvailability());
      setPersistent((await navigator.storage?.persisted?.()) ?? false);
    } catch {
      setAvailability({ ready: false, updateReady: false });
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    void check();
    const changed = () => void check();
    window.addEventListener("surveytool:offline-ready", changed);
    navigator.serviceWorker?.addEventListener("controllerchange", changed);
    return () => {
      window.removeEventListener("surveytool:offline-ready", changed);
      navigator.serviceWorker?.removeEventListener("controllerchange", changed);
    };
  }, [check]);
  return (
    <section className="mt-6 rounded-2xl border border-cyan-300/20 bg-cyan-300/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-cyan-100">
            {checking
              ? "Checking offline availability…"
              : availability.ready
                ? "App ready for offline use"
                : availability.updateReady
                  ? "App update ready"
                  : "Prepare before going offline"}
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-6 text-slate-400">
            {availability.updateReady
              ? "Save your work, close all SurveyTool windows, then reopen the app to use the latest offline version."
              : availability.ready
                ? "The app, coordinate catalogue and report font are saved on this device. Your saved project data can be reopened and processed offline."
                : "Open the app online once and allow it to finish loading. Keep a downloaded project file as a backup. If an update is ready, close all SurveyTool windows and reopen."}{" "}
            Background maps and cloud services require internet.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs ${online ? "bg-emerald-300/10 text-emerald-200" : "bg-amber-300/10 text-amber-200"}`}
        >
          {online ? "Online" : "Offline"}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          disabled={checking}
          onClick={() => void check()}
          className="min-h-11 rounded-xl border border-white/15 px-4 py-2 text-xs disabled:opacity-40"
        >
          Check readiness
        </button>
        <button
          disabled={persistent}
          onClick={() => void protectProjectStorage().then(setPersistent)}
          className="min-h-11 rounded-xl border border-white/15 px-4 py-2 text-xs disabled:opacity-40"
        >
          {persistent
            ? "Persistent storage granted"
            : "Request persistent storage"}
        </button>
        <p className="text-xs text-slate-500">
          Browser storage can still be removed by clearing site data. Keep a
          project backup.
        </p>
      </div>
    </section>
  );
}
