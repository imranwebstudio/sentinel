import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { Activity, Bell, FileSearch, FolderKanban, LayoutDashboard, Menu, ScanSearch, Settings, ShieldCheck, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { githubApi } from "../api/github.ts";
import { ScanProvider, useScan } from "../state/scan-store.tsx";

const navigation = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/scans", label: "Scans", icon: ScanSearch },
  { to: "/findings", label: "Findings", icon: FileSearch },
  { to: "/reports", label: "Reports", icon: Activity },
  { to: "/team", label: "Team", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
];

function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : true,
  );
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setDesktop(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

export function AppLayout() {
  const desktop = useDesktop();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    setSidebarOpen(desktop);
  }, [desktop]);

  const closeSidebar = () => setSidebarOpen(false);
  const toggleSidebar = () => setSidebarOpen((value) => !value);

  return (
    <ScanProvider>
      <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <a href="#main-content" className="skip-link">Skip to content</a>
        <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`} aria-label="Primary navigation">
          <div className="flex h-16 items-center justify-between border-b border-white/8 px-5">
            <NavLink to="/" className="flex items-center gap-3" onClick={() => { if (!desktop) closeSidebar(); }}>
              <span className="grid size-9 place-items-center rounded-xl bg-emerald-400 text-slate-950 shadow-[0_0_30px_rgba(52,211,153,.22)]"><ShieldCheck size={20} /></span>
              <span><strong className="block text-sm tracking-wide">SENTINEL</strong><span className="block text-[10px] uppercase tracking-[.22em] text-slate-500">Repository security</span></span>
            </NavLink>
            <button type="button" className="icon-button" onClick={closeSidebar} aria-label="Close navigation"><X size={19} /></button>
          </div>
          <nav className="space-y-1 p-3">
            {navigation.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                {...(end ? { end: true } : {})}
                onClick={() => { if (!desktop) closeSidebar(); }}
                className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}
              >
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
        {sidebarOpen && !desktop && (
          <button type="button" className="fixed inset-0 z-30 bg-black/65 backdrop-blur-sm" onClick={closeSidebar} aria-label="Close navigation overlay" />
        )}

        <div className={`min-h-screen transition-[padding] duration-200 ${sidebarOpen && desktop ? "pl-64" : "pl-0"}`}>
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-white/8 bg-[rgba(8,11,16,.82)] px-4 backdrop-blur-xl sm:px-7">
            <button
              type="button"
              className="icon-button"
              onClick={toggleSidebar}
              aria-label={sidebarOpen ? "Hide navigation" : "Open navigation"}
              aria-expanded={sidebarOpen}
            >
              <Menu size={20} />
            </button>
            <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex"><span className="status-dot" />All systems operational</div>
            <HeaderActions />
          </header>
          <motion.main id="main-content" tabIndex={-1} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .28 }} className="mx-auto max-w-[1500px] px-4 py-7 outline-none sm:px-7 sm:py-9">
            <Outlet />
          </motion.main>
        </div>
      </div>
    </ScanProvider>
  );
}

function HeaderActions() {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const { findings } = useScan();
  const connection = useQuery({ queryKey: ["github", "connection"], queryFn: githubApi.connection });
  const viewer = connection.data?.connected ? connection.data.viewer : undefined;
  const displayName = viewer?.name?.trim() || viewer?.login || "Connect GitHub";
  const initials = initialsFrom(displayName);
  // Badge matches Findings page: current session findings only (not old history totals).
  const sessionFindings = findings.length;

  useEffect(() => {
    if (!notificationsOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!notificationsRef.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [notificationsOpen]);

  return (
    <div className="relative ml-auto flex items-center gap-2" ref={notificationsRef}>
      <button
        type="button"
        className="icon-button relative"
        aria-label="Notifications"
        aria-expanded={notificationsOpen}
        aria-haspopup="dialog"
        onClick={() => setNotificationsOpen((value) => !value)}
      >
        <Bell size={18} />
        {sessionFindings > 0 && (
          <span className="absolute top-1.5 right-1.5 grid min-w-[0.95rem] h-[0.95rem] place-items-center rounded-full bg-emerald-400 px-0.5 text-[0.58rem] font-extrabold leading-none text-slate-950">
            {sessionFindings > 9 ? "9+" : sessionFindings}
          </span>
        )}
      </button>
      {notificationsOpen && (
        <div
          className="absolute top-[calc(100%+.55rem)] right-0 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[0.9rem] border border-white/10 bg-[rgba(10,14,20,.98)] shadow-[0_22px_60px_rgba(0,0,0,.45)] backdrop-blur-2xl"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
            <p className="text-sm font-semibold text-slate-100">Notifications</p>
            <button type="button" className="icon-button" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="space-y-2 p-3">
            <div className="rounded-lg border border-white/8 bg-white/[.03] px-3 py-2.5">
              <p className="text-xs font-semibold text-emerald-300">System</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">All systems operational.</p>
            </div>
            {connection.data?.connected ? (
              <div className="rounded-lg border border-white/8 bg-white/[.03] px-3 py-2.5">
                <p className="text-xs font-semibold text-slate-200">GitHub</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  Signed in as @{viewer?.login}.{" "}
                  {sessionFindings > 0
                    ? `${sessionFindings} finding${sessionFindings === 1 ? "" : "s"} in the current scan session.`
                    : "No findings in the current scan session."}
                </p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <Link to="/scans" className="text-link" onClick={() => setNotificationsOpen(false)}>View scan activity</Link>
                  {sessionFindings > 0 && (
                    <Link to="/findings" className="text-link" onClick={() => setNotificationsOpen(false)}>Review findings</Link>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-white/8 bg-white/[.03] px-3 py-2.5">
                <p className="text-xs font-semibold text-amber-300">GitHub</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">Connect GitHub to start scanning repositories.</p>
                <Link to="/projects" className="text-link mt-2" onClick={() => setNotificationsOpen(false)}>
                  Go to Projects
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
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
  );
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}
