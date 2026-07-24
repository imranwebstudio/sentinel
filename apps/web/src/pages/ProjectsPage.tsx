import { useQuery } from "@tanstack/react-query";
import { Check, CheckSquare, ExternalLink, Github, LoaderCircle, Lock, RefreshCw, Search, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { githubApi, loadSelectedRepositoryIds, saveSelectedRepositoryIds } from "../api/github.ts";

export function ProjectsPage() {
  const connection = useQuery({ queryKey: ["github", "connection"], queryFn: githubApi.connection });
  const repositories = useQuery({ queryKey: ["github", "repositories"], queryFn: githubApi.repositories, enabled: connection.data?.connected === true });
  const [selected, setSelected] = useState<Set<number>>(() => new Set(loadSelectedRepositoryIds()));
  const [query, setQuery] = useState("");
  const allRepos = repositories.data ?? [];
  const visible = useMemo(() => allRepos.filter((repository) => repository.fullName.toLowerCase().includes(query.toLowerCase())), [allRepos, query]);
  const allSelected = allRepos.length > 0 && allRepos.every((repository) => selected.has(repository.id));

  function persistSelection(next: Set<number>): void {
    setSelected(next);
    saveSelectedRepositoryIds([...next]);
  }

  function toggle(id: number): void {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    persistSelection(next);
  }

  function toggleAll(): void {
    const next = new Set(selected);
    if (allSelected) {
      for (const repository of allRepos) next.delete(repository.id);
    } else {
      for (const repository of allRepos) next.add(repository.id);
    }
    persistSelection(next);
  }

  if (connection.isLoading) return <Loading label="Checking GitHub connection…" />;
  if (connection.isError) return <ErrorPanel message={connection.error.message} retry={() => void connection.refetch()} />;
  if (!connection.data?.connected) return <section className="panel"><div className="empty-state min-h-[55vh]"><span className="empty-icon"><Github size={25} /></span><h1 className="mt-4 text-2xl font-semibold text-white">Connect GitHub</h1><p>{connection.data?.mode === "invalid_credentials" ? "The configured development token has expired. Sign in with GitHub to grant fresh repository access." : "Sign in with GitHub to list and scan repositories you can access."}</p>{connection.data?.oauthConfigured ? <a className="primary-button mt-5" href="/api/v1/github/oauth/start"><Github size={16} />Connect GitHub</a> : <><p className="mt-3 text-amber-300">OAuth is not configured. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.</p><button className="secondary-button mt-5" onClick={() => void connection.refetch()}><RefreshCw size={15} />Check again</button></>}{connection.data?.callbackUrl && <p className="mt-4 max-w-xl text-xs text-slate-600">OAuth callback: <code>{connection.data.callbackUrl}</code></p>}</div></section>;

  return <div>
    <div className="section-heading"><div><p className="eyebrow-plain">GitHub connection</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Repositories</h1><p className="mt-2 text-sm text-slate-500">Connected as <strong className="text-slate-300">@{connection.data.viewer?.login}</strong>. Select repositories to scan.</p></div><Link to="/scans" className={`primary-button ${selected.size === 0 ? "pointer-events-none opacity-50" : ""}`}>Scan {selected.size || "selected"}</Link></div>
    <section className="panel mt-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center"><label className="relative flex-1"><span className="sr-only">Search repositories</span><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" size={16} /><input className="repo-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search repositories…" /></label><button className="secondary-button" disabled={allRepos.length === 0} onClick={toggleAll}>{allSelected ? <Square size={15} /> : <CheckSquare size={15} />}{allSelected ? "Deselect all" : `Select all (${allRepos.length})`}</button><button className="secondary-button" onClick={() => void repositories.refetch()}><RefreshCw size={15} />Refresh</button></div>
      {repositories.isLoading ? <Loading label="Loading accessible repositories…" /> : repositories.isError ? <ErrorPanel message={repositories.error.message} retry={() => void repositories.refetch()} /> : <div className="mt-5 divide-y divide-white/6 overflow-hidden rounded-xl border border-white/8">{visible.map((repository) => <label key={repository.id} className="repo-item"><input className="sr-only" type="checkbox" checked={selected.has(repository.id)} onChange={() => toggle(repository.id)} /><span className={`repo-check ${selected.has(repository.id) ? "repo-check-selected" : ""}`}>{selected.has(repository.id) && <Check size={13} />}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-sm font-medium text-slate-200">{repository.private && <Lock size={12} className="text-slate-500" />}{repository.fullName}</span><span className="mt-1 block text-xs text-slate-600">{repository.defaultBranch} · {repository.writable ? "Writable" : "Read only"}{repository.archived ? " · Archived" : ""}</span></span><a href={repository.htmlUrl} onClick={(event) => event.stopPropagation()} target="_blank" rel="noreferrer" className="icon-button" aria-label={`Open ${repository.fullName} on GitHub`}><ExternalLink size={15} /></a></label>)}</div>}
      {!repositories.isLoading && visible.length === 0 && <p className="py-12 text-center text-sm text-slate-600">No repositories match your search.</p>}
    </section>
  </div>;
}

function Loading({ label }: { label: string }) { return <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={18} />{label}</div>; }
function ErrorPanel({ message, retry }: { message: string; retry: () => void }) { return <div className="empty-state min-h-64"><p className="text-red-300">{message}</p><button className="secondary-button mt-4" onClick={retry}>Try again</button></div>; }
