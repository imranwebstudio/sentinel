import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Check, CheckSquare, ExternalLink, LoaderCircle, Search, Square, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Finding } from "../api/github.ts";
import { useScan } from "../state/scan-store.tsx";

interface FindingsPanelProps {
  compact?: boolean;
}

export function FindingsPanel({ compact = false }: FindingsPanelProps) {
  const { findings, running, remediate, remediateRunning, remediateError } = useScan();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [removing, setRemoving] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const reduceMotion = useReducedMotion();

  const visible = useMemo(
    () => findings.filter((finding) => {
      const haystack = `${finding.repository} ${finding.path}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    }),
    [findings, query],
  );
  const allSelected = visible.length > 0 && visible.every((finding) => selected.has(finding.id));

  function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected((current) => {
      const next = new Set(current);
      if (allSelected) {
        for (const finding of visible) next.delete(finding.id);
      } else {
        for (const finding of visible) next.add(finding.id);
      }
      return next;
    });
  }

  async function removeFindingIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const confirmed = window.confirm(
      `Remove ${ids.length} selected finding(s)? This commits directly to the affected repository branches.`,
    );
    if (!confirmed) return;

    setRemoving(new Set(ids));
    try {
      const result = await remediate(ids);
      setSelected((current) => {
        const next = new Set(current);
        for (const id of result.succeeded) next.delete(id);
        return next;
      });
    } finally {
      setRemoving(new Set());
    }
  }

  if (findings.length === 0) {
    return (
      <div className="empty-state min-h-48">
        <span className="empty-icon"><Search size={23} /></span>
        <h3>{running ? "Scan in progress…" : "No findings yet"}</h3>
        <p>{running ? "Findings appear here as repositories finish scanning." : "Run a scan from Projects or Scans to detect malware."}</p>
        {!running && !compact && <Link className="primary-button mt-5" to="/scans">Go to scans</Link>}
      </div>
    );
  }

  return (
    <div>
      <div className={`flex flex-col gap-3 ${compact ? "" : "sm:flex-row sm:items-center"}`}>
        {!compact && (
          <label className="relative flex-1">
            <span className="sr-only">Search findings</span>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" size={16} />
            <input className="repo-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search findings…" />
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="secondary-button" disabled={visible.length === 0 || remediateRunning} onClick={toggleAll}>
            {allSelected ? <Square size={15} /> : <CheckSquare size={15} />}
            {allSelected ? "Deselect all" : `Select all (${visible.length})`}
          </button>
          <button
            className="danger-button"
            disabled={selected.size === 0 || remediateRunning}
            onClick={() => void removeFindingIds([...selected])}
          >
            {remediateRunning ? <LoaderCircle className="animate-spin" size={15} /> : <Trash2 size={15} />}
            Remove selected ({selected.size || 0})
          </button>
        </div>
      </div>

      {remediateError && (
        <p className="mt-4 rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">{remediateError}</p>
      )}

      <div className="mt-5 space-y-3">
        <AnimatePresence mode="popLayout" initial={false}>
          {visible.map((finding) => (
            <FindingRow
              key={finding.id}
              finding={finding}
              checked={selected.has(finding.id)}
              removing={removing.has(finding.id)}
              disabled={remediateRunning}
              reduceMotion={Boolean(reduceMotion)}
              onToggle={() => toggle(finding.id)}
              onRemove={() => void removeFindingIds([finding.id])}
            />
          ))}
        </AnimatePresence>
        {visible.length === 0 && <p className="py-10 text-center text-sm text-slate-600">No findings match your search.</p>}
      </div>
    </div>
  );
}

function FindingRow({
  finding,
  checked,
  removing,
  disabled,
  reduceMotion,
  onToggle,
  onRemove,
}: {
  finding: Finding;
  checked: boolean;
  removing: boolean;
  disabled: boolean;
  reduceMotion: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <motion.article
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.96 }}
      animate={
        removing
          ? { opacity: 0.35, scale: 0.97, x: 8, filter: "blur(0.5px) grayscale(0.5)" }
          : { opacity: 1, y: 0, scale: 1, x: 0, filter: "blur(0px) grayscale(0)" }
      }
      {...(!reduceMotion
        ? {
            exit: {
              opacity: 0,
              x: 80,
              scale: 0.9,
              height: 0,
              marginTop: 0,
              marginBottom: 0,
              paddingTop: 0,
              paddingBottom: 0,
              borderWidth: 0,
              transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const },
            },
          }
        : {})}
      transition={{ type: "spring", stiffness: 320, damping: 28, mass: 0.8 }}
      className={`finding-item overflow-hidden ${removing ? "pointer-events-none border-emerald-400/25 bg-emerald-400/10 shadow-[0_0_24px_rgba(52,211,153,.12)]" : ""}`}
    >
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
        <input className="sr-only" type="checkbox" checked={checked} onChange={onToggle} disabled={disabled} />
        <span className={`repo-check ${checked ? "repo-check-selected" : ""}`}>{checked && <Check size={13} />}</span>
        <span className={finding.action === "REVIEW_DELETE" ? "finding-icon-warn" : "finding-icon-danger"}>
          {removing ? <LoaderCircle className="animate-spin" size={16} /> : <AlertTriangle size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-200">{finding.path}</p>
          <p className="mt-1 text-xs text-slate-600">
            {removing
              ? "Cleaning and committing…"
              : `${finding.repository} · ${finding.action === "REVIEW_DELETE" ? ".bat file will be deleted" : `${finding.snippets} snippet(s) will be removed`}`}
          </p>
        </span>
      </label>
      <div className="flex gap-1">
        <button className="danger-button danger-button-compact" disabled={disabled} onClick={onRemove} aria-label={`Remove ${finding.path}`}>
          <Trash2 size={14} />
        </button>
        <a href={finding.htmlUrl} target="_blank" rel="noreferrer" className="icon-button" aria-label="Open finding on GitHub">
          <ExternalLink size={14} />
        </a>
      </div>
    </motion.article>
  );
}
