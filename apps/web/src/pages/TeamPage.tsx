import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Github, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { githubApi, loadSelectedRepositoryIds } from "../api/github.ts";

export function TeamPage() {
  const connection = useQuery({ queryKey: ["github", "connection"], queryFn: githubApi.connection });
  const repositories = useQuery({
    queryKey: ["github", "repositories"],
    queryFn: githubApi.repositories,
    enabled: connection.data?.connected === true,
  });
  const viewer = connection.data?.connected ? connection.data.viewer : undefined;
  const selectedCount = loadSelectedRepositoryIds().length;
  const owners = [...new Set((repositories.data ?? []).map((repository) => repository.owner))].sort();

  return (
    <div>
      <div className="section-heading">
        <div>
          <p className="eyebrow-plain">Access</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Team</h1>
          <p className="mt-2 text-sm text-slate-500">
            Current GitHub identity and organizations/accounts you can access from this session.
          </p>
        </div>
        <Link to="/projects" className="secondary-button">Manage repositories</Link>
      </div>

      {!viewer ? (
        <section className="panel mt-7">
          <div className="empty-state min-h-[45vh]">
            <span className="empty-icon"><Users size={24} /></span>
            <h2>No GitHub identity connected</h2>
            <p>Connect GitHub to see the signed-in account and accessible organizations.</p>
            <Link className="primary-button mt-5" to="/projects"><Github size={16} />Connect GitHub</Link>
          </div>
        </section>
      ) : (
        <div className="mt-7 grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
          <section className="panel">
            <p className="eyebrow-plain">Signed in</p>
            <h2 className="mt-1">GitHub account</h2>
            <div className="mt-6 flex items-center gap-4">
              <img src={viewer.avatarUrl} alt="" className="size-14 rounded-full object-cover" />
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-white">{viewer.name?.trim() || viewer.login}</p>
                <p className="mt-1 text-sm text-slate-500">@{viewer.login}</p>
                <p className="mt-2 text-xs text-slate-600">Mode: {connection.data?.mode}</p>
              </div>
            </div>
            <a href={viewer.htmlUrl} target="_blank" rel="noreferrer" className="secondary-button mt-6">
              <ExternalLink size={15} />Open GitHub profile
            </a>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <article className="stat-card">
                <p className="text-2xl font-semibold text-white">{repositories.data?.length ?? 0}</p>
                <p className="mt-1 text-xs text-slate-500">Accessible repositories</p>
              </article>
              <article className="stat-card">
                <p className="text-2xl font-semibold text-white">{selectedCount}</p>
                <p className="mt-1 text-xs text-slate-500">Selected for scanning</p>
              </article>
            </div>
          </section>

          <section className="panel">
            <p className="eyebrow-plain">Scope</p>
            <h2 className="mt-1">Accounts & organizations</h2>
            <p className="mt-2 text-sm text-slate-500">
              Derived from repositories visible to this GitHub token. Full team invites/roles come later with durable tenancy.
            </p>
            <div className="mt-5 space-y-2">
              {owners.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-600">No repositories loaded yet.</p>
              ) : owners.map((owner) => {
                const count = (repositories.data ?? []).filter((repository) => repository.owner === owner).length;
                return (
                  <div key={owner} className="finding-item">
                    <span className="finding-icon-warn"><Users size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-200">{owner}</p>
                      <p className="mt-1 text-xs text-slate-600">{count} repositor{count === 1 ? "y" : "ies"}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
