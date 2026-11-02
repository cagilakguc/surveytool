import { useState } from "react";
import {
  analyticsPrivacyAllowed,
  getUsageConsent,
  setUsageConsent,
  usageMeasurementId,
  type UsageConsent,
} from "../lib/toolUsage";

export default function ToolUsageAnalytics() {
  const [consent, setConsent] = useState<UsageConsent>(getUsageConsent);
  const [open, setOpen] = useState(false);
  if (
    !usageMeasurementId() ||
    !import.meta.env.PROD ||
    !["surveytool.io", "www.surveytool.io"].includes(
      window.location.hostname,
    ) ||
    !analyticsPrivacyAllowed()
  )
    return null;
  function choose(value: "allow" | "deny") {
    setUsageConsent(value);
    setConsent(value);
    setOpen(false);
  }
  return (
    <aside className="fixed bottom-4 left-4 z-50 max-w-sm text-xs">
      {consent === "unknown" || open ? (
        <div className="rounded-2xl border border-white/15 bg-slate-950 p-4 text-slate-300 shadow-xl">
          <p className="font-semibold text-white">Optional usage analytics</p>
          <p className="mt-2 leading-5">
            Allow analytics cookies to count which tools and actions are used.
            Survey files, filenames, coordinates and project details stay
            private. Your choice does not affect the tools.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => choose("allow")}
              className="rounded-lg border border-cyan-300/40 px-3 py-2 text-cyan-200"
            >
              Allow analytics
            </button>
            <button
              onClick={() => choose("deny")}
              className="rounded-lg border border-white/20 px-3 py-2 text-slate-200"
            >
              Essential only
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full border border-white/15 bg-slate-950/95 px-3 py-2 text-slate-400"
        >
          Analytics settings
        </button>
      )}
    </aside>
  );
}
