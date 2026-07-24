export interface RateLimitSnapshot {
  resource: string;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  resetAt: number | null;
  pausedUntil: number | null;
}

export interface GitHubGatewayMetrics {
  requestsTotal: number;
  requestsPerMinute: number;
  cacheHits: number;
  cacheMisses: number;
  deduplicatedRequests: number;
  skippedUnchangedFiles: number;
  activeRequests: number;
  delayedRetries: number;
  resumedJobs: number;
  failedJobs: number;
  retriesTotal: number;
  rateLimit: RateLimitSnapshot;
}

export interface GatewayRequestContext {
  method: string;
  endpoint: string;
  repository?: string;
  queue?: string;
  workerId?: string;
  cacheKey?: string;
  cacheTtlSeconds?: number;
  dedupeKey?: string;
}

export interface GatewayExecuteOptions extends GatewayRequestContext {
  retryable?: boolean;
  /** Skip local concurrency / min-time pacing (dose-scanner style burst). */
  unthrottled?: boolean;
  /** Do not pause when remaining quota nears the safety threshold. */
  ignoreSafetyThreshold?: boolean;
}

export interface GatewayThroughputProfile {
  apiConcurrency: number;
  apiMinTimeMs: number;
  unthrottled?: boolean;
  ignoreSafetyThreshold?: boolean;
}

export class GitHubRateLimitError extends Error {
  readonly retryAfterMs: number;
  readonly status: number;

  constructor(message: string, retryAfterMs: number, status = 403) {
    super(message);
    this.name = "GitHubRateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

export function isRetryableGitHubError(error: unknown): boolean {
  if (error instanceof GitHubRateLimitError) return true;
  const status = (error as { status?: number })?.status;
  return status === 403 || status === 429;
}
