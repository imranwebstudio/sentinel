import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, CheckCircle2, Clock3, FileWarning, GitBranch, Play, ScanSearch, ShieldAlert, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { githubApi, loadSelectedRepositoryIds } from "../api/github.ts";
import { formatDuration, useScan } from "../state/scan-store.tsx";

export function DashboardPage() {
  const reduceMotion = useReducedMotion();
  const connection = useQuery({ queryKey: ["github", "connection"], queryFn: githubApi.connection });
  const repositories = useQuery({
    queryKey: ["github", "repositories"],
    queryFn: githubApi.repositories,
    enabled: connection.data?.connected === true,
  });
  const history = useQuery({
    queryKey: ["github", "scan-history"],
    queryFn: () => githubApi.listScanHistory(8),
    enabled: connection.data?.connected === true && connection.data.databaseConfigured !== false,
  });
  const { running, results, findings, completedAt, lastSavedHistoryId } = useScan();
  const selectedCount = loadSelectedRepositoryIds().length;
  const repoCount = repositories.data?.length ?? 0;
  const historyRows = history.data ?? [];
  const latestHistory = historyRows[0];
  const scannedRepos = latestHistory?.completedCount ?? results.length;
  const openFindings = latestHistory?.openFindingsCount ?? findings.length;
  const coverage = repoCount > 0 ? Math.min(100, Math.round((scannedRepos / repoCount) * 100)) : null;
  const connected = connection.data?.connected === true;

  const stats = [
    {
      label: "Repositories",
      value: connected ? String(repoCount) : "—",
      detail: connected ? `${selectedCount} selected for scanning` : "Connect GitHub to load repos",
      icon: GitBranch,
      tone: connected ? "good" : "neutral",
    },
    {
      label: "Active scans",
      value: running ? "1" : "0",
      detail: running ? "Scan in progress" : "Queue is clear",
      icon: ScanSearch,
      tone: running ? "warn" : "good",
    },
    {
      label: "Open findings",
      value: scannedRepos > 0 || openFindings > 0 ? String(openFindings) : "—",
      detail: openFindings > 0 ? "Needs remediation" : scannedRepos > 0 ? "No open findings" : "Awaiting first scan",
      icon: ShieldAlert,
      tone: openFindings > 0 ? "warn" : scannedRepos > 0 ? "good" : "neutral",
    },
    {
      label: "Coverage",
      value: coverage === null ? "—" : `${coverage}%`,
      detail: coverage === null ? "No baseline yet" : `${scannedRepos} of ${repoCount} repos in latest history`,
      icon: CheckCircle2,
      tone: coverage !== null && coverage >= 50 ? "good" : "neutral",
    },
  ] as const;

  const statusLabel = running
    ? "Scan running"
    : latestHistory?.completedAt
      ? `Last scan ${new Date(latestHistory.completedAt).toLocaleString()}`
      : completedAt
        ? `Session scan ${new Date(completedAt).toLocaleString()}`
        : connected
          ? "Connected · waiting for first saved scan"
          : "No scan data yet";

  return (
    <div>
      <section className="relative overflow-hidden rounded-3xl border border-white/8 bg-[linear-gradient(135deg,rgba(16,185,129,.12),rgba(15,23,42,.25)_52%,rgba(6,182,212,.08))] p-6 sm:p-9">
        <div className="grid-glow" aria-hidden="true" />
        <div className="relative max-w-3xl">
          <div className="eyebrow"><Sparkles size={13} /> Modernization foundation</div>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-.035em] text-white sm:text-5xl">Repository security,<br /><span className="text-gradient">built to move fast.</span></h1>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">A durable control plane for high-speed malware scans, precise findings, and reviewable remediation—saved to Postgres for your authenticated GitHub identity.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/scans" className="primary-button"><Play size={16} fill="currentColor" />Start a scan</Link>
            <Link to="/projects" className="secondary-button">Connect repositories <ArrowRight size={16} /></Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="security-summary" className="mt-8">
        <div className="section-heading">
          <div><p className="eyebrow-plain">At a glance</p><h2 id="security-summary">Security posture</h2></div>
          <span className="text-xs text-slate-500">{statusLabel}</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat, index) => <StatCard key={stat.label} {...stat} index={index} reduceMotion={Boolean(reduceMotion)} />)}
        </div>
      </section>

      <div className="mt-8 grid gap-5 xl:grid-cols-[1.45fr_.75fr]">
        <section className="panel" aria-labelledby="recent-scans">
          <div className="section-heading">
            <div><p className="eyebrow-plain">Operations</p><h2 id="recent-scans">Recent scans</h2></div>
            <Link to="/reports" className="text-link">View reports <ArrowRight size={14} /></Link>
          </div>
          {history.isLoading ? (
            <p className="mt-5 text-sm text-slate-500">Loading history…</p>
          ) : historyRows.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon"><ScanSearch size={24} /></span>
              <h3>Your scan history starts here</h3>
              <p>Completed scans are saved to database for your GitHub account and will show up here.</p>
              <Link to="/scans" className="secondary-button mt-5"><Play size={15} />Create baseline scan</Link>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {historyRows.map((row) => (
                <article key={row.id} className="finding-item">
                  <span className={row.openFindingsCount > 0 ? "finding-icon-danger" : "finding-icon-warn"}>
                    {row.openFindingsCount > 0 ? <ShieldAlert size={16} /> : <CheckCircle2 size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">
                      {row.mode} scan · {row.completedCount}/{row.repositoryCount} repos
                      {row.id === lastSavedHistoryId ? " · just saved" : ""}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {new Date(row.startedAt).toLocaleString()}
                      {row.durationMs != null ? ` · ${formatDuration(row.durationMs)}` : ""}
                      {` · ${row.openFindingsCount} open / ${row.findingsCount} findings`}
                    </p>
                  </div>
                  <Link to={`/reports?history=${row.id}`} className="text-link">
                    Details
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
        <aside className="panel" aria-labelledby="setup-title">
          <div><p className="eyebrow-plain">Getting started</p><h2 id="setup-title" className="mt-1">Launch checklist</h2></div>
          <ol className="mt-6 space-y-5">
            <ChecklistItem done title="Control plane" detail="React and NestJS foundation" />
            <ChecklistItem done={connected} title="Connect GitHub" detail={connected ? `Signed in as @${connection.data?.viewer?.login}` : "Install with least privilege"} />
            <ChecklistItem done={selectedCount > 0} title="Select repositories" detail={selectedCount > 0 ? `${selectedCount} repositories selected` : "Choose repositories to scan"} />
            <ChecklistItem done={historyRows.length > 0} title="Baseline scan" detail={historyRows.length > 0 ? `${historyRows.length} saved scan(s) in Postgres` : "Establish durable history"} />
          </ol>
        </aside>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
  index,
  reduceMotion,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof GitBranch;
  tone: string;
  index: number;
  reduceMotion: boolean;
}) {
  return (
    <motion.article initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .05 }} className="stat-card">
      <div className={`stat-icon stat-${tone}`}><Icon size={18} /></div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <p className="text-3xl font-semibold tracking-tight text-white">{value}</p>
          <p className="mt-1 text-sm font-medium text-slate-300">{label}</p>
        </div>
      </div>
      <p className="mt-4 flex items-center gap-1.5 border-t border-white/7 pt-3 text-xs text-slate-500"><Clock3 size={12} />{detail}</p>
    </motion.article>
  );
}

function ChecklistItem({ done = false, title, detail }: { done?: boolean; title: string; detail: string }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border ${done ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-white/10 bg-white/[.03] text-slate-600"}`}>
        {done ? <CheckCircle2 size={14} /> : <FileWarning size={13} />}
      </span>
      <div>
        <p className="text-sm font-medium text-slate-200">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
      </div>
    </li>
  );
}
