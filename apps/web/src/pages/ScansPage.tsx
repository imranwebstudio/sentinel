import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileSearch,
  LoaderCircle,
  Play,
  Search,
  Square,
  Timer,
  XCircle,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  githubApi,
  loadSelectedRepositoryIds,
  scanBatchSize,
  type RepositoryScanResult,
  type ScanMode,
} from "../api/github.ts";
import { formatDuration, useScan, type RepoProgress } from "../state/scan-store.tsx";

export function ScansPage() {
  const repositories = useQuery({ queryKey: ["github", "repositories"], queryFn: githubApi.repositories });
  const selectedIds = useMemo(() => new Set(loadSelectedRepositoryIds()), []);
  const selected = useMemo(
    () => (repositories.data ?? []).filter((repository) => selectedIds.has(repository.id)),
    [repositories.data, selectedIds],
  );
  const { running, events, results, repoProgress, findings, error, start, stop, elapsedMs, durationMs, startedAt, completedAt, lastMode, lastSavedHistoryId, historySaveError } = useScan();
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<ScanMode>(lastMode ?? "fast");

  const batchSize = scanBatchSize(mode);
  const batchCount = mode === "fast" ? 1 : Math.ceil(selected.length / batchSize);
  const activeCount = repoProgress.filter((row) => row.status === "running").length;
  const totals = results.reduce(
    (total, result) => ({
      files: total.files + result.scanned,
      findings: total.findings + result.findings.length,
      errors: total.errors + result.errors.length,
    }),
    { files: 0, findings: 0, errors: 0 },
  );
  const progressRows = repoProgress.length > 0
    ? repoProgress
    : results.map((result) => ({
      repository: result.repository,
      branch: result.branch,
      status: "completed" as const,
      scanned: result.scanned,
      total: result.scanned,
      findings: result.findings.length,
      errors: result.errors.length,
      elapsedMs: result.durationMs ?? 0,
    }));

  function toggleExpanded(repository: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(repository)) next.delete(repository);
      else next.add(repository);
      return next;
    });
  }

  if (repositories.isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center gap-3 text-slate-500">
        <LoaderCircle className="animate-spin" />
        Loading repositories…
      </div>
    );
  }

  return (
    <div>
      <div className="section-heading">
        <div>
          <p className="eyebrow-plain">Live scanner</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">New scan</h1>
          <p className="mt-2 text-sm text-slate-500">
            {selected.length} repositories selected · {mode === "fast" ? "20 parallel live workers" : "deep metadata content scan"}
            {mode === "deep" && batchCount > 1 ? ` · ${batchCount} batches of up to ${batchSize}` : ""}
            {running ? " · repos appear as they start · finished sink to the bottom" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="scan-mode-toggle" role="group" aria-label="Scan mode">
            <button
              type="button"
              className={mode === "fast" ? "active" : ""}
              disabled={running}
              onClick={() => setMode("fast")}
            >
              <Zap size={14} />
              Fast
            </button>
            <button
              type="button"
              className={mode === "deep" ? "active" : ""}
              disabled={running}
              onClick={() => setMode("deep")}
            >
              <FileSearch size={14} />
              Deep clean
            </button>
          </div>
          {running && (
            <button className="secondary-button" onClick={stop}>
              <Square size={14} />
              Stop
            </button>
          )}
          <button className="primary-button" disabled={running || selected.length === 0} onClick={() => void start(selected, mode)}>
            {running ? <LoaderCircle className="animate-spin" size={16} /> : <Play size={16} fill="currentColor" />}
            {running ? "Scanning…" : mode === "fast" ? "Start fast scan" : "Start deep scan"}
          </button>
        </div>
      </div>

      {selected.length === 0 && (
        <section className="panel mt-7">
          <div className="empty-state">
            <span className="empty-icon"><Search size={24} /></span>
            <h2>Select repositories first</h2>
            <p>Choose one or more repositories before starting a scan.</p>
            <Link className="primary-button mt-5" to="/projects">Choose repositories</Link>
          </div>
        </section>
      )}

      {selected.length > 0 && (
        <>
          <section className="panel mt-7">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="eyebrow-plain">Fast scan</p>
                <p className="mt-2 text-sm text-slate-300">Fast root `.bat` presence and known config signatures — high parallel Octokit throughput. Skips `.gitignore`.</p>
              </div>
              <div>
                <p className="eyebrow-plain">Deep clean</p>
                <p className="mt-2 text-sm text-slate-300">Broader metadata/content inspection across config files, workflows, and all `.bat` paths. Slower, more thorough.</p>
              </div>
            </div>
          </section>

          <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <TimerCard
              label={running ? "Elapsed" : "Total time"}
              value={formatDuration(running ? elapsedMs : (durationMs ?? elapsedMs))}
              detail={running ? `${mode === "fast" ? "Fast" : "Deep"} scan in progress` : completedAt ? `Finished ${new Date(completedAt).toLocaleString()}` : startedAt ? `Started ${new Date(startedAt).toLocaleString()}` : "Not started"}
              active={running}
            />
            <TimerCard label="Repos done" value={`${results.length}/${selected.length}`} detail={running ? `${activeCount} scanning now` : "Selected batch"} />
            <TimerCard label="Files scanned" value={String(totals.files)} detail={`${totals.errors} errors`} />
            <Link to="/findings">
              <TimerCard
                label="Findings"
                value={String(findings.length || totals.findings)}
                detail={findings.length > 0 ? "Open Findings to remediate" : "No open findings"}
              />
            </Link>
          </div>

          <div className="mt-7 grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow-plain">Progress</p>
                  <h2>Repository timing</h2>
                </div>
                {findings.length > 0 && <Link to="/findings" className="text-link">Open findings</Link>}
              </div>
              {error && (
                <p className="mt-4 rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">{error}</p>
              )}
              {historySaveError && (
                <p className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">
                  Scan finished, but history was not saved: {historySaveError}
                </p>
              )}
              {lastSavedHistoryId && !running && (
                <p className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-200">
                  Saved history. <Link className="text-link" to={`/reports?history=${lastSavedHistoryId}`}>Open report</Link>
                </p>
              )}

              {!running && results.length === 0 && events.length === 0 ? (
                <div className="empty-state min-h-64">
                  <span className="empty-icon"><Timer size={24} /></span>
                  <h3>Ready to scan</h3>
                  <p>Start a fast scan for dose-scanner speed, or deep clean for a thorough pass. Select all or any subset of repos.</p>
                </div>
              ) : running && progressRows.length === 0 ? (
                <div className="empty-state min-h-64">
                  <span className="empty-icon"><LoaderCircle className="animate-spin" size={24} /></span>
                  <h3>Starting workers…</h3>
                  <p>Repositories will appear here as each scan begins.</p>
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  <AnimatePresence initial={false}>
                    {progressRows.map((row) => {
                      const result = results.find((item) => item.repository === row.repository);
                      const open = expanded.has(row.repository);
                      return (
                        <RepoProgressCard
                          key={row.repository}
                          row={row}
                          {...(result ? { result } : {})}
                          open={open}
                          reduceMotion={Boolean(reduceMotion)}
                          onToggle={() => toggleExpanded(row.repository)}
                        />
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </section>

            <aside className="panel">
              <div>
                <p className="eyebrow-plain">Activity</p>
                <h2 className="mt-1">Scan stream</h2>
              </div>
              <div className="scan-log mt-5" aria-live="polite">
                {events.map((event, index) => (
                  <div key={index}>
                    <span>{String(event.type ?? "event")}</span>
                    {event.mode ? ` · ${String(event.mode)}` : ""}
                    {event.repository ? ` · ${String(event.repository)}` : ""}
                    {event.scanned !== undefined ? ` · ${String(event.scanned)}/${String(event.total)}` : ""}
                    {event.latestFile ? ` · ${String(event.latestFile)}` : ""}
                    {event.elapsedMs !== undefined ? ` · ${formatDuration(Number(event.elapsedMs))}` : ""}
                    {event.batch !== undefined ? ` · batch ${String(event.batch)}/${String(event.batchCount)}` : ""}
                  </div>
                ))}
                {events.length === 0 && <div>Waiting to start…</div>}
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function TimerCard({ label, value, detail, active = false }: { label: string; value: string; detail: string; active?: boolean }) {
  return (
    <article className={`stat-card ${active ? "border-emerald-400/20" : ""}`}>
      <div className="flex items-center gap-2 text-emerald-300"><Clock3 size={15} /><span className="text-xs font-semibold uppercase tracking-[.12em]">{label}</span></div>
      <p className="mt-3 font-mono text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

function RepoProgressCard({
  row,
  result,
  open,
  reduceMotion,
  onToggle,
}: {
  row: RepoProgress;
  result?: RepositoryScanResult | undefined;
  open: boolean;
  reduceMotion: boolean;
  onToggle: () => void;
}) {
  const percent = row.total > 0 ? Math.min(100, Math.round((row.scanned / row.total) * 100)) : row.status === "completed" ? 100 : 0;
  const files = result?.files ?? [];

  return (
    <motion.article
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className={`overflow-hidden rounded-xl border bg-white/[.02] ${row.status === "running"
          ? "border-emerald-400/25"
          : row.status === "failed"
            ? "border-red-400/20"
            : "border-white/8"
        }`}
    >
      <button type="button" className="flex w-full items-start gap-3 p-4 text-left" onClick={onToggle}>
        <StatusIcon status={row.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-slate-200">{row.repository}</p>
            <span className="font-mono text-xs text-emerald-300">{formatDuration(row.elapsedMs)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {row.branch ?? "default"} · {row.scanned}/{row.total || "?"} files · {row.findings} findings · {row.errors} errors
            {result?.mode ? ` · ${result.mode}` : ""}
            {row.latestFile && row.status === "running" ? ` · ${row.latestFile}` : ""}
            {row.message ? ` · ${row.message}` : ""}
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5">
            <motion.div
              className={`h-full rounded-full ${row.status === "failed" ? "bg-red-400" : "bg-emerald-400"}`}
              initial={false}
              animate={{ width: `${percent}%` }}
              transition={{ duration: 0.25 }}
            />
          </div>
        </div>
        <ChevronDown size={16} className={`mt-1 shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            {...(!reduceMotion ? { exit: { height: 0, opacity: 0 } } : {})}
            className="overflow-hidden border-t border-white/6"
          >
            <div className="max-h-64 space-y-1 overflow-auto p-4">
              {files.length === 0 ? (
                <p className="text-xs text-slate-600">
                  {row.status === "running" ? "Collecting scanned files…" : "No inspected metadata files recorded for this repository."}
                </p>
              ) : files.map((file) => (
                <div key={file.path} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-xs hover:bg-white/[.03]">
                  <span className="min-w-0 truncate text-slate-300">{file.path}</span>
                  <span className={`shrink-0 uppercase tracking-wide ${fileStatusClass(file.status)}`}>{file.status.replaceAll("_", " ")}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function StatusIcon({ status }: { status: RepoProgress["status"] }) {
  if (status === "completed") return <span className="finding-icon-warn"><CheckCircle2 size={16} /></span>;
  if (status === "failed") return <span className="finding-icon-danger"><XCircle size={16} /></span>;
  if (status === "running") return <span className="finding-icon-warn"><LoaderCircle className="animate-spin" size={16} /></span>;
  return <span className="finding-icon-warn"><FileSearch size={16} /></span>;
}

function fileStatusClass(status: string): string {
  if (status === "infected" || status === "cached_infected" || status === "bat") return "text-red-300";
  if (status === "error") return "text-amber-300";
  if (status === "cached_clean") return "text-cyan-300";
  return "text-emerald-300";
}
