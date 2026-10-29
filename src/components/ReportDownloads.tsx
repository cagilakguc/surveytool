import { useEffect, useState } from "react";
import type { SurveyReport } from "../lib/surveyReports";
import {
  createReportCsv,
  createReportExcel,
  createReportPdf,
  downloadReportBlob,
  safeReportName,
} from "../lib/surveyReports";
export default function ReportDownloads({
  report,
  disabled = false,
}: {
  report: SurveyReport | null;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<{
    url: string;
    fileName: string;
  } | null>(null);
  useEffect(() => {
    setPrepared(null);
  }, [report]);
  useEffect(
    () => () => {
      if (prepared) URL.revokeObjectURL(prepared.url);
    },
    [prepared],
  );
  async function download(format: "csv" | "xlsx" | "pdf") {
    if (!report) return;
    setBusy(format);
    setError("");
    try {
      const name = `${safeReportName(report.project || report.title)}-${report.createdAt.slice(0, 10)}.${format}`;
      if (format === "csv")
        setPrepared(
          downloadReportBlob(
            createReportCsv(report),
            "text/csv;charset=utf-8",
            name,
            true,
          ),
        );
      else if (format === "xlsx")
        setPrepared(
          downloadReportBlob(
            await createReportExcel(report),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            name,
            true,
          ),
        );
      else
        setPrepared(
          downloadReportBlob(
            await createReportPdf(report),
            "application/pdf",
            name,
            true,
          ),
        );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The report could not be created.",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {(["pdf", "xlsx", "csv"] as const).map((format) => (
          <button
            key={format}
            type="button"
            disabled={!report || disabled || !!busy}
            onClick={() => void download(format)}
            className="rounded-full border border-cyan-300/30 bg-cyan-300/5 px-4 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/15 disabled:opacity-40"
          >
            {busy === format
              ? "Preparing…"
              : `Download ${format.toUpperCase()}`}
          </button>
        ))}
      </div>
      {prepared && (
        <a
          href={prepared.url}
          download={prepared.fileName}
          className="block text-xs text-cyan-300 underline"
        >
          Download prepared {prepared.fileName.split(".").at(-1)?.toUpperCase()}
        </a>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
