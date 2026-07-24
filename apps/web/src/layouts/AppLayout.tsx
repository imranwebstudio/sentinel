import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { Activity, Bell, FileSearch, FolderKanban, LayoutDashboard, Menu, ScanSearch, Settings, ShieldCheck, Users, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { githubApi } from "../api/github.ts";
import { ScanProvider } from "../state/scan-store.tsx";

const navigation = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/scans", label: "Scans", icon: ScanSearch },
  { to: "/findings", label: "Findings", icon: FileSearch },
  { to: "/reports", label: "Reports", icon: Activity },
  { to: "/team", label: "Team", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const connection = useQuery({ queryKey: ["github", "connection"], queryFn: githubApi.connection });
  const viewer = connection.data?.connected ? connection.data.viewer : undefined;
  const displayName = viewer?.name?.trim() || viewer?.login || "Connect GitHub";
  const initials = initialsFrom(displayName);

  return (
    <ScanProvider>
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`} aria-label="Primary navigation">
        <div className="flex h-16 items-center justify-between border-b border-white/8 px-5">
          <NavLink to="/" className="flex items-center gap-3" onClick={() => setOpen(false)}>
            <span className="grid size-9 place-items-center rounded-xl bg-emerald-400 text-slate-950 shadow-[0_0_30px_rgba(52,211,153,.22)]"><ShieldCheck size={20} /></span>
            <span><strong className="block text-sm tracking-wide">SENTINEL</strong><span className="block text-[10px] uppercase tracking-[.22em] text-slate-500">Repository security</span></span>
          </NavLink>
          <button className="icon-button lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>
        <nav className="space-y-1 p-3">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} {...(end ? { end: true } : {})} onClick={() => setOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}>
              <Icon size={18} aria-hidden="true" /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto p-4">
          <div className="rounded-xl border border-emerald-300/10 bg-emerald-300/[.04] p-3">
            <p className="text-xs font-semibold text-emerald-300">Foundation build</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Control plane online. Durable workers are the next migration slice.</p>
          </div>
        </div>
      </aside>
      {open && <button className="fixed inset-0 z-30 bg-black/65 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation overlay" />}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-white/8 bg-[rgba(8,11,16,.82)] px-4 backdrop-blur-xl sm:px-7">
          <button className="icon-button lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex"><span className="status-dot" />All systems operational</div>
          <div className="ml-auto flex items-center gap-2">
            <button className="icon-button" aria-label="Notifications"><Bell size={18} /></button>
            <Link
              to="/projects"
              className="flex max-w-[14rem] items-center gap-2 rounded-full border border-white/10 bg-white/[.04] py-1.5 pl-1.5 pr-3 text-sm hover:bg-white/[.07]"
              title={viewer ? `@${viewer.login}` : "Connect GitHub"}
            >
              {viewer?.avatarUrl ? (
                <img src={viewer.avatarUrl} alt="" className="size-7 rounded-full object-cover" />
              ) : (
                <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-emerald-300 to-cyan-500 text-xs font-bold text-slate-950">{initials}</span>
              )}
              <span className="hidden truncate sm:inline">{displayName}</span>
            </Link>
          </div>
        </header>
        <motion.main id="main-content" tabIndex={-1} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .28 }} className="mx-auto max-w-[1500px] px-4 py-7 outline-none sm:px-7 sm:py-9">
          <Outlet />
        </motion.main>
      </div>
    </div>
    </ScanProvider>
  );
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}
