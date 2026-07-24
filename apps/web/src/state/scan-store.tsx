import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  type Finding,
  type RemediationResult,
  type Repository,
  type RepositoryScanResult,
  type ScanHistoryDetail,
  type ScanMode,
  githubApi,
  remediateFindings,
  streamScan,
} from "../api/github.ts";

const STORAGE_KEY = "bat-remover.scan-session";

export interface RepoProgress {
  repository: string;
  branch?: string;
  status: "queued" | "running" | "completed" | "failed";
  scanned: number;
  total: number;
  findings: number;
  errors: number;
  elapsedMs: number;
  latestFile?: string;
  message?: string;
  startedAt?: number;
  finishedAt?: number;
}

function statusRank(status: RepoProgress["status"]): number {
  if (status === "running") return 0;
  if (status === "queued") return 1;
  return 2;
}

/** Running (newest) on top; finished repos sink to the bottom (oldest finished deepest). */
export function sortRepoProgress(items: RepoProgress[]): RepoProgress[] {
  return [...items].sort((left, right) => {
    const rank = statusRank(left.status) - statusRank(right.status);
    if (rank !== 0) return rank;
    if (left.status === "running") return (right.startedAt ?? 0) - (left.startedAt ?? 0);
    if (left.status === "completed" || left.status === "failed") {
      return (left.finishedAt ?? 0) - (right.finishedAt ?? 0);
    }
    return 0;
  });
}

interface PersistedScanState {
  events: Record<string, unknown>[];
  results: RepositoryScanResult[];
  repoProgress: RepoProgress[];
  error: string;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  durationMs?: number | undefined;
  lastMode?: ScanMode | undefined;
}

interface ScanContextValue {
  running: boolean;
  events: Record<string, unknown>[];
  results: RepositoryScanResult[];
  repoProgress: RepoProgress[];
  findings: Finding[];
  error: string;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  durationMs?: number | undefined;
  elapsedMs: number;
  start: (repositories: Repository[], mode?: ScanMode) => Promise<void>;
  stop: () => void;
  clear: () => void;
  remediate: (findingIds: string[]) => Promise<RemediationResult>;
  remediateRunning: boolean;
  remediateError: string;
  lastMode?: ScanMode | undefined;
  lastSavedHistoryId?: string | undefined;
  historySaveError: string;
}

const ScanContext = createContext<ScanContextValue | null>(null);

function loadPersistedState(): PersistedScanState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { events: [], results: [], repoProgress: [], error: "" };
    const parsed = JSON.parse(raw) as PersistedScanState;
    return {
      events: parsed.events ?? [],
      results: parsed.results ?? [],
      repoProgress: parsed.repoProgress ?? [],
      error: parsed.error ?? "",
      ...(parsed.startedAt ? { startedAt: parsed.startedAt } : {}),
      ...(parsed.completedAt ? { completedAt: parsed.completedAt } : {}),
      ...(parsed.durationMs !== undefined ? { durationMs: parsed.durationMs } : {}),
      ...(parsed.lastMode ? { lastMode: parsed.lastMode } : {}),
    };
  } catch {
    return { events: [], results: [], repoProgress: [], error: "" };
  }
}

function persistState(state: PersistedScanState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function ScanProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => loadPersistedState(), []);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState(initial.events);
  const [results, setResults] = useState(initial.results);
  const [repoProgress, setRepoProgress] = useState<RepoProgress[]>(initial.repoProgress);
  const [error, setError] = useState(initial.error);
  const [startedAt, setStartedAt] = useState(initial.startedAt);
  const [completedAt, setCompletedAt] = useState(initial.completedAt);
  const [durationMs, setDurationMs] = useState(initial.durationMs);
  const [elapsedMs, setElapsedMs] = useState(initial.durationMs ?? 0);
  const [remediateRunning, setRemediateRunning] = useState(false);
  const [remediateError, setRemediateError] = useState("");
  const [lastMode, setLastMode] = useState<ScanMode | undefined>(initial.lastMode);
  const [lastSavedHistoryId, setLastSavedHistoryId] = useState<string | undefined>();
  const [historySaveError, setHistorySaveError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const startedAtMs = useRef<number | null>(null);
  const resultsRef = useRef<RepositoryScanResult[]>([]);
  const failedReposRef = useRef<Array<{ repository: string; message?: string }>>([]);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  const findings = useMemo(() => results.flatMap((result) => result.findings), [results]);

  useEffect(() => {
    if (running) return;
    persistState({
      events,
      results,
      repoProgress,
      error,
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(lastMode ? { lastMode } : {}),
    });
  }, [running, events, results, repoProgress, error, startedAt, completedAt, durationMs, lastMode]);

  useEffect(() => {
    if (!running || !startedAtMs.current) return;
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - (startedAtMs.current ?? Date.now()));
    }, 250);
    return () => window.clearInterval(timer);
  }, [running]);

  const upsertProgress = useCallback((update: Partial<RepoProgress> & { repository: string }) => {
    setRepoProgress((current) => {
      const index = current.findIndex((item) => item.repository === update.repository);
      if (index === -1) {
        const row: RepoProgress = {
          repository: update.repository,
          status: update.status ?? "running",
          scanned: update.scanned ?? 0,
          total: update.total ?? 0,
          findings: update.findings ?? 0,
          errors: update.errors ?? 0,
          elapsedMs: update.elapsedMs ?? 0,
          ...(update.branch ? { branch: update.branch } : {}),
          ...(update.latestFile ? { latestFile: update.latestFile } : {}),
          ...(update.message ? { message: update.message } : {}),
          ...(update.startedAt ? { startedAt: update.startedAt } : {}),
          ...(update.finishedAt ? { finishedAt: update.finishedAt } : {}),
        };
        // New active repos appear at the top immediately.
        return sortRepoProgress([row, ...current]);
      }
      const existing = current[index]!;
      const next = [...current];
      next[index] = {
        ...existing,
        ...update,
        elapsedMs: update.elapsedMs ?? (existing.startedAt ? Date.now() - existing.startedAt : existing.elapsedMs),
      };
      return sortRepoProgress(next);
    });
  }, []);

  const start = useCallback(async (repositories: Repository[], mode: ScanMode = "fast") => {
    setRunning(true);
    setError("");
    setHistorySaveError("");
    setLastSavedHistoryId(undefined);
    setLastMode(mode);
    setEvents([]);
    setResults([]);
    resultsRef.current = [];
    failedReposRef.current = [];
    // Appear as each repo starts — do not dump the full selection as queued rows.
    setRepoProgress([]);
    const now = Date.now();
    startedAtMs.current = now;
    const startedIso = new Date(now).toISOString();
    setStartedAt(startedIso);
    setCompletedAt(undefined);
    setDurationMs(undefined);
    setElapsedMs(0);
    abort.current = new AbortController();
    let aborted = false;
    try {
      await streamScan(repositories, (event) => {
        setEvents((current) => [...current.slice(-199), event]);
        if (event.type === "repository:started" && typeof event.repository === "string") {
          upsertProgress({
            repository: event.repository,
            status: "running",
            ...(typeof event.branch === "string" ? { branch: event.branch } : {}),
            startedAt: Date.now(),
            elapsedMs: 0,
          });
        }
        if (event.type === "repository:discovered" && typeof event.repository === "string") {
          upsertProgress({
            repository: event.repository,
            status: "running",
            total: Number(event.candidates ?? 0),
            ...(typeof event.branch === "string" ? { branch: event.branch } : {}),
          });
        }
        if (event.type === "repository:progress" && typeof event.repository === "string") {
          upsertProgress({
            repository: event.repository,
            status: "running",
            scanned: Number(event.scanned ?? 0),
            total: Number(event.total ?? 0),
            findings: Number(event.findings ?? 0),
            errors: Number(event.errors ?? 0),
            elapsedMs: Number(event.elapsedMs ?? 0),
            ...(typeof event.latestFile === "string" ? { latestFile: event.latestFile } : {}),
          });
        }
        if (event.type === "repository:completed") {
          const result = event.result as RepositoryScanResult;
          resultsRef.current = [...resultsRef.current, result];
          setResults((current) => [...current, result]);
          upsertProgress({
            repository: result.repository,
            status: "completed",
            scanned: result.scanned,
            total: result.scanned,
            findings: result.findings.length,
            errors: result.errors.length,
            elapsedMs: result.durationMs ?? 0,
            branch: result.branch,
            finishedAt: Date.now(),
          });
        }
        if (event.type === "repository:failed" && typeof event.repository === "string") {
          const message = typeof event.message === "string" ? event.message : "Scan failed";
          failedReposRef.current = [...failedReposRef.current, { repository: event.repository, message }];
          upsertProgress({
            repository: event.repository,
            status: "failed",
            message,
            finishedAt: Date.now(),
          });
        }
      }, abort.current.signal, mode);
    } catch (scanError) {
      aborted = (scanError as Error).name === "AbortError";
      if (!aborted) setError((scanError as Error).message);
    } finally {
      const ended = Date.now();
      const totalDuration = ended - (startedAtMs.current ?? ended);
      const completedIso = new Date(ended).toISOString();
      setDurationMs(totalDuration);
      setElapsedMs(totalDuration);
      setCompletedAt(completedIso);
      setRunning(false);
      abort.current = null;
      startedAtMs.current = null;

      const savedResults = resultsRef.current;
      const failedRepositories = failedReposRef.current;
      if (savedResults.length > 0 || failedRepositories.length > 0) {
        const status = aborted
          ? "CANCELLED" as const
          : failedRepositories.length > 0 && savedResults.length > 0
            ? "PARTIAL" as const
            : failedRepositories.length > 0
              ? "FAILED" as const
              : "COMPLETED" as const;
        try {
          const saved: ScanHistoryDetail = await githubApi.saveScanHistory({
            mode,
            status,
            startedAt: startedIso,
            completedAt: completedIso,
            durationMs: totalDuration,
            repositoryCount: repositories.length,
            results: savedResults,
            ...(failedRepositories.length > 0 ? { failedRepositories } : {}),
          });
          setLastSavedHistoryId(saved.id);
          setHistorySaveError("");
        } catch (historyError) {
          setHistorySaveError(historyError instanceof Error ? historyError.message : "Failed to save scan history");
        }
      }
    }
  }, [upsertProgress]);

  const stop = useCallback(() => {
    abort.current?.abort();
  }, []);

  const clear = useCallback(() => {
    if (running) abort.current?.abort();
    setEvents([]);
    setResults([]);
    setRepoProgress([]);
    setError("");
    setStartedAt(undefined);
    setCompletedAt(undefined);
    setDurationMs(undefined);
    setElapsedMs(0);
    sessionStorage.removeItem(STORAGE_KEY);
  }, [running]);

  const remediate = useCallback(async (findingIds: string[]) => {
    setRemediateRunning(true);
    setRemediateError("");
    const selected = findings.filter((finding) => findingIds.includes(finding.id));
    try {
      const result = await remediateFindings(selected);
      const removed = new Set(result.succeeded);
      setResults((current) => current.map((scanResult) => ({
        ...scanResult,
        findings: scanResult.findings.filter((finding) => !removed.has(finding.id)),
      })));
      if (result.failed.length > 0) {
        setRemediateError(`${result.failed.length} file(s) could not be remediated. ${result.failed[0]?.message ?? ""}`);
      }
      return result;
    } catch (remediationError) {
      const message = remediationError instanceof Error ? remediationError.message : "Remediation failed";
      setRemediateError(message);
      throw remediationError;
    } finally {
      setRemediateRunning(false);
    }
  }, [findings]);

  const value = useMemo<ScanContextValue>(() => ({
    running,
    events,
    results,
    repoProgress,
    findings,
    error,
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    elapsedMs,
    start,
    stop,
    clear,
    remediate,
    remediateRunning,
    remediateError,
    ...(lastMode ? { lastMode } : {}),
    ...(lastSavedHistoryId ? { lastSavedHistoryId } : {}),
    historySaveError,
  }), [running, events, results, repoProgress, findings, error, startedAt, completedAt, durationMs, elapsedMs, start, stop, clear, remediate, remediateRunning, remediateError, lastMode, lastSavedHistoryId, historySaveError]);

  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}

export function useScan(): ScanContextValue {
  const context = useContext(ScanContext);
  if (!context) throw new Error("useScan must be used within ScanProvider");
  return context;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}.${tenths}s`;
  return `${seconds}.${tenths}s`;
}
