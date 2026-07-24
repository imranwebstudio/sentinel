import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { githubApi } from "../api/github.ts";
import { useScan } from "../state/scan-store.tsx";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const connection = useQuery({ queryKey: ["github", "connection"], queryFn: githubApi.connection });
  const metrics = useQuery({ queryKey: ["github", "metrics"], queryFn: githubApi.rateLimitMetrics, refetchInterval: 15_000 });
  const { clear, results, findings } = useScan();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const viewer = connection.data?.connected ? connection.data.viewer : undefined;
  const rateLimit = (metrics.data?.rateLimit ?? {}) as {
    remaining?: number | null;
    used?: number | null;
    limit?: number | null;
    resetAt?: number | null;
  };

  async function logout(): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      await githubApi.logout();
      clear();
      localStorage.removeItem("selectedRepositoryIds");
      await queryClient.invalidateQueries({ queryKey: ["github"] });
      setMessage("Signed out of GitHub on this browser.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Logout failed");
    } finally {
      setBusy(false);
    }
  }

  function clearSession(): void {
    clear();
    setMessage("Cleared in-browser scan session.");
  }

  return (
    <div>
      <div className="section-heading">
        <div>
          <p className="eyebrow-plain">Configuration</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Settings</h1>
          <p className="mt-2 text-sm text-slate-500">Connection, session data, and GitHub API usage for this local control plane.</p>
        </div>
        <button className="secondary-button" onClick={() => void metrics.refetch()}>
          <RefreshCw size={15} />Refresh metrics
        </button>
      </div>

      <div className="mt-7 grid gap-5 xl:grid-cols-2">
        <section className="panel">
          <p className="eyebrow-plain">Integrations</p>
          <h2 className="mt-1">GitHub connection</h2>
          {viewer ? (
            <div className="mt-5 space-y-3 text-sm text-slate-400">
              <p>Signed in as <strong className="text-slate-200">{viewer.name?.trim() || viewer.login}</strong> (@{viewer.login})</p>
              <p>Auth mode: <code className="text-slate-300">{connection.data?.mode}</code></p>
              {connection.data?.callbackUrl && <p>OAuth callback: <code className="break-all text-xs text-slate-500">{connection.data.callbackUrl}</code></p>}
            </div>
          ) : (
            <p className="mt-5 text-sm text-slate-500">Not connected. Connect GitHub from Projects to enable scanning.</p>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            <Link to="/projects" className="primary-button">Open projects</Link>
            <button className="danger-button" disabled={busy || !viewer} onClick={() => void logout()}>
              <LogOut size={15} />{busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow-plain">Session</p>
          <h2 className="mt-1">Local scan data</h2>
          <p className="mt-5 text-sm text-slate-500">
            Scan results are stored in this browser session ({results.length} repos, {findings.length} findings). Clearing removes them until the next scan.
          </p>
          <button className="secondary-button mt-6" onClick={clearSession}>
            <SettingsIcon size={15} />Clear scan session
          </button>
        </section>

        <section className="panel xl:col-span-2">
          <p className="eyebrow-plain">GitHub API</p>
          <h2 className="mt-1">Rate-limit metrics</h2>
          {metrics.isError ? (
            <p className="mt-5 text-sm text-red-300">{metrics.error.message}</p>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Remaining" value={String(rateLimit.remaining ?? "—")} />
              <Metric label="Used" value={String(rateLimit.used ?? "—")} />
              <Metric label="Limit" value={String(rateLimit.limit ?? "—")} />
              <Metric
                label="Reset"
                value={rateLimit.resetAt ? new Date(rateLimit.resetAt).toLocaleTimeString() : "—"}
              />
            </div>
          )}
          <p className="mt-4 text-xs text-slate-600">
            Requests this minute: {String(metrics.data?.requestsPerMinute ?? 0)} · Cache hits: {String(metrics.data?.cacheHits ?? 0)} · Deduped: {String(metrics.data?.deduplicatedRequests ?? 0)}
          </p>
        </section>
      </div>

      {message && <p className="mt-5 text-sm text-emerald-300">{message}</p>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="stat-card">
      <p className="text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </article>
  );
}
