import { useQuery } from "@tanstack/react-query";
import { Download, FileBarChart2, ShieldAlert } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { githubApi } from "../api/github.ts";
import { formatDuration, useScan } from "../state/scan-store.tsx";

export function ReportsPage() {
  const [params] = useSearchParams();
  const selectedHistoryId = params.get("history");
  const connection = useQuery({ queryKey: ["github", "connection"], queryFn: githubApi.connection });
  const historyList = useQuery({
    queryKey: ["github", "scan-history"],
    queryFn: () => githubApi.listScanHistory(30),
    enabled: connection.data?.connected === true,
  });
  const historyDetail = useQuery({
    queryKey: ["github", "scan-history", selectedHistoryId],
    queryFn: () => githubApi.getScanHistory(selectedHistoryId!),
    enabled: Boolean(selectedHistoryId),
  });
  const { results, findings, completedAt, running } = useScan();

  const active = historyDetail.data;
  const reportResults = active?.repositories.map((repo) => ({
    repository: repo.fullName,
    branch: repo.branch,
    scanned: repo.scanned,
    skipped: repo.skipped,
    findingsCount: repo.findingsCount,
    errors: repo.errorCount,
    truncated: repo.truncated,
  })) ?? results.map((result) => ({
    repository: result.repository,
    branch: result.branch,
    scanned: result.scanned,
    skipped: result.skipped,
    findingsCount: result.findings.length,
    errors: result.errors.length,
    truncated: result.truncated,
  }));
  const reportFindings = active?.findings.filter((finding) => finding.status === "open") ?? findings;
  const totals = useMemo(() => reportResults.reduce(
    (sum, result) => ({
      scanned: sum.scanned + result.scanned,
      findings: sum.findings + result.findingsCount,
      errors: sum.errors + result.errors,
      skipped: sum.skipped + result.skipped,
    }),
    { scanned: 0, findings: 0, errors: 0, skipped: 0 },
  ), [reportResults]);

  function downloadJson(): void {
    const payload = active ?? {
      generatedAt: new Date().toISOString(),
      completedAt: completedAt ?? null,
      running,
      summary: {
        repositories: results.length,
        ...totals,
        openFindings: findings.length,
      },
      results,
      findings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sentinel-scan-report-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadCsv(): void {
    const header = ["repository", "branch", "path", "action", "snippets", "htmlUrl"];
    const rows = reportFindings.map((finding) => [
      finding.repository,
      finding.branch,
      finding.path,
      finding.action,
      String(finding.snippets),
      finding.htmlUrl,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sentinel-findings-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="section-heading">
        <div>
          <p className="eyebrow-plain">Exports</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Reports</h1>
          <p className="mt-2 text-sm text-slate-500">
            {active
              ? `${active.mode} scan · ${new Date(active.startedAt).toLocaleString()}${active.durationMs != null ? ` · ${formatDuration(active.durationMs)}` : ""}`
              : completedAt
                ? `Current session · last scan ${new Date(completedAt).toLocaleString()}`
                : "Saved Postgres history and current session exports"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="secondary-button" disabled={reportResults.length === 0} onClick={downloadJson}>
            <Download size={15} />Export JSON
          </button>
          <button className="primary-button" disabled={reportFindings.length === 0} onClick={downloadCsv}>
            <Download size={15} />Export findings CSV
          </button>
        </div>
      </div>

      <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Repositories scanned" value={String(reportResults.length)} />
        <SummaryCard label="Files scanned" value={String(totals.scanned)} />
        <SummaryCard label="Findings" value={String(active?.findingsCount ?? totals.findings)} />
        <SummaryCard label="Open findings" value={String(active?.openFindingsCount ?? reportFindings.length)} />
      </div>

      <div className="mt-7 grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow-plain">History</p>
              <h2>Past scans</h2>
            </div>
            <Link to="/scans" className="text-link">New scan</Link>
          </div>
          {(historyList.data ?? []).length === 0 ? (
            <div className="empty-state min-h-64">
              <span className="empty-icon"><FileBarChart2 size={24} /></span>
              <h3>No saved history yet</h3>
              <p>Run a scan while connected to GitHub. Results are stored in Postgres for your account.</p>
              <Link className="primary-button mt-5" to="/scans">Start a scan</Link>
            </div>
          ) : (
            <div className="mt-5 space-y-2">
              {(historyList.data ?? []).map((row) => (
                <Link
                  key={row.id}
                  to={`/reports?history=${row.id}`}
                  className={`finding-item block ${selectedHistoryId === row.id ? "border-emerald-400/25 bg-emerald-400/5" : ""}`}
                >
                  <span className={row.openFindingsCount > 0 ? "finding-icon-danger" : "finding-icon-warn"}>
                    <ShieldAlert size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">
                      {row.mode} · {row.completedCount}/{row.repositoryCount} repos · {row.status.toLowerCase()}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {new Date(row.startedAt).toLocaleString()}
                      {row.durationMs != null ? ` · ${formatDuration(row.durationMs)}` : ""}
                      {` · ${row.openFindingsCount} open`}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow-plain">{active ? "Saved scan" : "Current session"}</p>
              <h2>Repository results</h2>
            </div>
            {selectedHistoryId && <Link to="/reports" className="text-link">Clear selection</Link>}
          </div>

          {reportResults.length === 0 ? (
            <div className="empty-state min-h-64">
              <span className="empty-icon"><FileBarChart2 size={24} /></span>
              <h3>No report data yet</h3>
              <p>Run a scan first, or pick a saved history entry on the left.</p>
              <Link className="primary-button mt-5" to="/scans">Start a scan</Link>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {reportResults.map((result) => (
                <article key={`${result.repository}:${result.branch}`} className="finding-item">
                  <span className={result.findingsCount > 0 ? "finding-icon-danger" : "finding-icon-warn"}>
                    <ShieldAlert size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">{result.repository}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {result.branch} · {result.scanned} scanned · {result.findingsCount} findings · {result.errors} errors
                      {result.truncated ? " · truncated tree" : ""}
                    </p>
                  </div>
                  <Link to="/findings" className="text-link">
                    {result.findingsCount > 0 ? "Review" : "Clean"}
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="stat-card">
      <p className="text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-sm font-medium text-slate-300">{label}</p>
    </article>
  );
}
