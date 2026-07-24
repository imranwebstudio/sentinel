export interface GitHubViewer { id?: number; login: string; name: string | null; email?: string | null; avatarUrl: string; htmlUrl: string }
export interface GitHubConnection { connected: boolean; mode: string; viewer?: GitHubViewer; oauthConfigured?: boolean; callbackUrl?: string; databaseConfigured?: boolean }
export interface Repository { id: number; owner: string; name: string; fullName: string; defaultBranch: string; private: boolean; archived: boolean; writable: boolean; htmlUrl: string; updatedAt: string | null }
export interface Finding { id: string; repository: string; branch: string; path: string; action: "REVIEW_DELETE" | "REMOVE_MALWARE"; snippets: number; blobSha: string; htmlUrl: string }
export type ScanMode = "fast" | "deep";
export interface RepositoryScanResult {
  repository: string;
  branch: string;
  discovered: number;
  scanned: number;
  skipped: number;
  findings: Finding[];
  errors: Array<{ path: string; message: string }>;
  truncated: boolean;
  durationMs?: number;
  mode?: ScanMode;
  files?: Array<{ path: string; status: "clean" | "infected" | "bat" | "error" | "cached_clean" | "cached_infected" }>;
}
export interface RemediationResult { succeeded: string[]; failed: Array<{ id: string; message: string }> }

export interface ScanHistorySummary {
  id: string;
  mode: ScanMode;
  status: string;
  githubLogin: string;
  repositoryCount: number;
  completedCount: number;
  failedCount: number;
  findingsCount: number;
  openFindingsCount: number;
  filesScanned: number;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ScanHistoryDetail extends ScanHistorySummary {
  repositories: Array<{
    id: string;
    fullName: string;
    branch: string;
    status: string;
    scanned: number;
    skipped: number;
    findingsCount: number;
    errorCount: number;
    durationMs: number | null;
    truncated: boolean;
  }>;
  findings: Array<Finding & { status: "open" | "remediated"; historyFindingId: string; createdAt: string }>;
}

export interface SaveScanHistoryPayload {
  mode: ScanMode;
  status: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  repositoryCount: number;
  results: RepositoryScanResult[];
  failedRepositories?: Array<{ repository: string; message?: string }>;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail ?? body.message ?? `Request failed (${response.status})`);
  return body as T;
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail ?? body.message ?? `Request failed (${response.status})`);
  return body as T;
}

export const githubApi = {
  connection: () => getJson<GitHubConnection>("/api/v1/github/connection"),
  repositories: async () => (await getJson<{ repositories: Repository[] }>("/api/v1/github/repositories")).repositories,
  logout: async () => {
    const response = await fetch("/api/v1/github/logout", { method: "POST" });
    if (!response.ok && response.status !== 204) throw new Error(`Logout failed (${response.status})`);
  },
  rateLimitMetrics: () => getJson<Record<string, unknown>>("/api/v1/github/metrics/rate-limit"),
  saveScanHistory: (payload: SaveScanHistoryPayload) => postJson<ScanHistoryDetail>("/api/v1/github/scan-history", payload),
  listScanHistory: async (limit = 20) => (await getJson<{ history: ScanHistorySummary[] }>(`/api/v1/github/scan-history?limit=${limit}`)).history,
  getScanHistory: (id: string) => getJson<ScanHistoryDetail>(`/api/v1/github/scan-history/${id}`),
};

export function loadSelectedRepositoryIds(): number[] {
  try { return JSON.parse(localStorage.getItem("selectedRepositoryIds") ?? "[]") as number[]; } catch { return []; }
}

export function saveSelectedRepositoryIds(ids: number[]): void {
  localStorage.setItem("selectedRepositoryIds", JSON.stringify(ids));
}

export const FAST_SCAN_BATCH_SIZE = 500;
export const DEEP_SCAN_BATCH_SIZE = 25;
/** Dose-scanner style: 20 parallel single-repo scan requests from the browser. */
export const FAST_SCAN_CLIENT_CONCURRENCY = 20;
/** @deprecated Prefer scanBatchSize(mode) */
export const SCAN_BATCH_SIZE = DEEP_SCAN_BATCH_SIZE;

export function scanBatchSize(mode: ScanMode): number {
  return mode === "fast" ? FAST_SCAN_BATCH_SIZE : DEEP_SCAN_BATCH_SIZE;
}

function toScanPayload(repositories: Repository[]) {
  return repositories.map(({ owner, name: repo, defaultBranch: branch }) => ({ owner, repo, branch }));
}

async function streamScanBatch(
  repositories: Repository[],
  mode: ScanMode,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/v1/github/scans/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode, repositories: toScanPayload(repositories) }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string; message?: string };
    throw new Error(body.detail ?? body.message ?? `Unable to start scan (${response.status})`);
  }
  if (!response.body) throw new Error("Unable to start scan (empty response body)");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as Record<string, unknown>);
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as Record<string, unknown>);
}

/** Continuous worker pool — same pattern as dose-scanner BATCH_CONCURRENCY = 20. */
async function streamScanParallel(
  repositories: Repository[],
  mode: ScanMode,
  onEvent: (event: Record<string, unknown>) => void,
  signal: AbortSignal | undefined,
  concurrency: number,
): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < repositories.length) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const index = cursor;
      cursor += 1;
      const repository = repositories[index];
      if (!repository) continue;
      await streamScanBatch([repository], mode, onEvent, signal);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, repositories.length) }, () => worker()));
}

export async function streamScan(
  repositories: Repository[],
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
  mode: ScanMode = "fast",
): Promise<void> {
  if (repositories.length === 0) return;
  if (mode === "fast") {
    onEvent({ type: "batch:started", batch: 1, batchCount: 1, repositoryCount: repositories.length, mode, workerCount: FAST_SCAN_CLIENT_CONCURRENCY });
    await streamScanParallel(repositories, mode, onEvent, signal, FAST_SCAN_CLIENT_CONCURRENCY);
    onEvent({ type: "batch:completed", batch: 1, batchCount: 1, mode });
    return;
  }
  const batchSize = scanBatchSize(mode);
  const batchCount = Math.ceil(repositories.length / batchSize);
  for (let index = 0; index < repositories.length; index += batchSize) {
    const batch = repositories.slice(index, index + batchSize);
    const batchNumber = Math.floor(index / batchSize) + 1;
    if (batchCount > 1) onEvent({ type: "batch:started", batch: batchNumber, batchCount, repositoryCount: batch.length, mode });
    await streamScanBatch(batch, mode, onEvent, signal);
    if (batchCount > 1) onEvent({ type: "batch:completed", batch: batchNumber, batchCount, mode });
  }
}

export const REMEDIATE_BATCH_SIZE = 50;

function findingToRemediationPayload(finding: Finding) {
  const slash = finding.repository.indexOf("/");
  const owner = slash === -1 ? finding.repository : finding.repository.slice(0, slash);
  const repo = slash === -1 ? "" : finding.repository.slice(slash + 1);
  return {
    id: finding.id,
    owner,
    repo,
    branch: finding.branch,
    path: finding.path,
    action: finding.action,
    blobSha: finding.blobSha,
  };
}

async function remediateBatch(findings: Finding[]): Promise<RemediationResult> {
  const response = await fetch("/api/v1/github/remediate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ findings: findings.map(findingToRemediationPayload) }),
  });
  const body = await response.json().catch(() => ({})) as RemediationResult & { detail?: string; message?: string };
  if (!response.ok) throw new Error(body.detail ?? body.message ?? `Remediation failed (${response.status})`);
  return { succeeded: body.succeeded ?? [], failed: body.failed ?? [] };
}

export async function remediateFindings(findings: Finding[]): Promise<RemediationResult> {
  const succeeded: string[] = [];
  const failed: RemediationResult["failed"] = [];
  for (let index = 0; index < findings.length; index += REMEDIATE_BATCH_SIZE) {
    const batch = findings.slice(index, index + REMEDIATE_BATCH_SIZE);
    const result = await remediateBatch(batch);
    succeeded.push(...result.succeeded);
    failed.push(...result.failed);
  }
  return { succeeded, failed };
}
