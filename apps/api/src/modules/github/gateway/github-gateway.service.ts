import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Octokit, type RestEndpointMethodTypes } from "@octokit/rest";
import type { Environment } from "../../../config/environment.js";
import { GitHubCacheService } from "./github-cache.service.js";
import { GitHubMetricsService } from "./github-metrics.service.js";
import { computeRetryDelayMs, parseRetryAfterHeader } from "./github-retry.js";
import { GitHubRateLimitService } from "./github-rate-limit.service.js";
import {
  GitHubRateLimitError,
  type GatewayExecuteOptions,
  type GatewayThroughputProfile,
  type GitHubGatewayMetrics,
  isRetryableGitHubError,
} from "./types.js";

type OctokitResponse<T> = { data: T; headers: Record<string, unknown>; status: number };

@Injectable()
export class GitHubGatewayService {
  private readonly logger = new Logger(GitHubGatewayService.name);
  private readonly clients = new Map<string, Octokit>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly apiQueue: Array<() => void> = [];
  private activeApiCalls = 0;
  private lastApiCallAt = 0;
  private apiConcurrency: number;
  private apiMinTimeMs: number;
  private readonly defaultApiConcurrency: number;
  private readonly defaultApiMinTimeMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly ruleSetChecksum = "scanning-core-v1";
  private profileDepth = 0;
  private aggressiveRefCount = 0;
  private ignoreSafetyRefCount = 0;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
    @Inject(GitHubRateLimitService) private readonly rateLimit: GitHubRateLimitService,
    @Inject(GitHubCacheService) private readonly cache: GitHubCacheService,
    @Inject(GitHubMetricsService) private readonly metrics: GitHubMetricsService,
  ) {
    this.defaultApiConcurrency = config.get("GITHUB_API_CONCURRENCY", { infer: true });
    this.defaultApiMinTimeMs = config.get("GITHUB_API_MIN_TIME_MS", { infer: true });
    this.apiConcurrency = this.defaultApiConcurrency;
    this.apiMinTimeMs = this.defaultApiMinTimeMs;
    this.maxRetries = config.get("GITHUB_MAX_RETRIES", { infer: true });
    this.retryBaseDelayMs = config.get("GITHUB_RETRY_BASE_DELAY_MS", { infer: true });
    this.retryMaxDelayMs = config.get("GITHUB_RETRY_MAX_DELAY_MS", { infer: true });
    const pat = config.get("GITHUB_PAT", { infer: true });
    if (pat) this.clients.set("pat", this.createOctokit(pat));
  }

  async withThroughputProfile<T>(profile: GatewayThroughputProfile, fn: () => Promise<T>): Promise<T> {
    const previousConcurrency = this.apiConcurrency;
    const previousMinTime = this.apiMinTimeMs;
    const useAggressive = Boolean(profile.unthrottled);
    const ignoreSafety = Boolean(profile.ignoreSafetyThreshold);
    this.profileDepth += 1;
    if (useAggressive) this.aggressiveRefCount += 1;
    if (ignoreSafety) this.ignoreSafetyRefCount += 1;
    this.apiConcurrency = useAggressive
      ? Math.max(this.apiConcurrency, profile.apiConcurrency, 40)
      : Math.max(this.apiConcurrency, profile.apiConcurrency);
    this.apiMinTimeMs = useAggressive ? 0 : Math.min(this.apiMinTimeMs, profile.apiMinTimeMs);
    try {
      return await fn();
    } finally {
      this.profileDepth = Math.max(0, this.profileDepth - 1);
      if (useAggressive) this.aggressiveRefCount = Math.max(0, this.aggressiveRefCount - 1);
      if (ignoreSafety) this.ignoreSafetyRefCount = Math.max(0, this.ignoreSafetyRefCount - 1);
      if (this.profileDepth === 0) {
        this.apiConcurrency = this.defaultApiConcurrency;
        this.apiMinTimeMs = this.defaultApiMinTimeMs;
      } else {
        this.apiConcurrency = previousConcurrency;
        this.apiMinTimeMs = previousMinTime;
      }
    }
  }

  private get aggressiveMode(): boolean {
    return this.aggressiveRefCount > 0;
  }

  private get ignoreSafetyThreshold(): boolean {
    return this.ignoreSafetyRefCount > 0;
  }

  async invalidate(key: string): Promise<void> {
    await this.cache.invalidate(key);
  }

  getMetrics(): GitHubGatewayMetrics {
    return this.metrics.snapshot(this.rateLimit.getSnapshot());
  }

  getRuleSetChecksum(): string {
    return this.ruleSetChecksum;
  }

  getClient(token?: string): Octokit {
    if (token) {
      const key = `oauth:${token.slice(0, 8)}`;
      const existing = this.clients.get(key);
      if (existing) return existing;
      const client = this.createOctokit(token);
      this.clients.set(key, client);
      return client;
    }
    const patClient = this.clients.get("pat");
    if (!patClient) throw new Error("GitHub is not connected");
    return patClient;
  }

  async execute<T>(options: GatewayExecuteOptions, fn: () => Promise<OctokitResponse<T>>): Promise<T> {
    const dedupeKey = options.dedupeKey ?? (options.cacheKey ? `dedupe:${options.cacheKey}` : undefined);
    if (dedupeKey) {
      const existing = this.inFlight.get(dedupeKey);
      if (existing) {
        this.metrics.recordDedup();
        return existing as Promise<T>;
      }
    }

    const task = this.runWithGuards(options, fn).finally(() => {
      if (dedupeKey) this.inFlight.delete(dedupeKey);
    });

    if (dedupeKey) this.inFlight.set(dedupeKey, task);
    return task;
  }

  async getCachedBlobScanResult(blobSha: string, namespace = "deep"): Promise<"clean" | "infected" | "bat" | null> {
    return this.cache.get<"clean" | "infected" | "bat">(`blob:${namespace}:${this.ruleSetChecksum}:${blobSha}`);
  }

  async setCachedBlobScanResult(blobSha: string, result: "clean" | "infected" | "bat", namespace = "deep"): Promise<void> {
    await this.cache.set(`blob:${namespace}:${this.ruleSetChecksum}:${blobSha}`, result);
  }

  recordSkippedUnchanged(): void {
    this.metrics.recordSkippedUnchanged();
  }

  private async runWithGuards<T>(options: GatewayExecuteOptions, fn: () => Promise<OctokitResponse<T>>): Promise<T> {
    const unthrottled = this.aggressiveMode || options.unthrottled === true;
    const ignoreSafetyThreshold = this.ignoreSafetyThreshold || options.ignoreSafetyThreshold === true;

    if (!unthrottled && options.cacheKey) {
      const cached = await this.cache.get<T>(options.cacheKey);
      if (cached !== null) {
        this.metrics.recordCacheHit();
        return cached;
      }
      this.metrics.recordCacheMiss();
    }

    let attempt = 0;
    while (true) {
      if (unthrottled) {
        // Only wait if a hard rate-limit pause was set from a real 403/429.
        await this.rateLimit.waitIfPaused();
        this.metrics.beginActiveRequest();
      } else {
        await this.acquireApiSlot();
        this.metrics.beginActiveRequest();
      }
      const started = Date.now();
      try {
        const response = await fn();
        await this.rateLimit.updateFromHeaders(response.headers, { applySafetyThreshold: !ignoreSafetyThreshold });
        this.metrics.recordRequest();
        this.logger.debug({
          endpoint: options.endpoint,
          method: options.method,
          repository: options.repository,
          queue: options.queue,
          workerId: options.workerId,
          durationMs: Date.now() - started,
          remaining: response.headers["x-ratelimit-remaining"],
          reset: response.headers["x-ratelimit-reset"],
          retryCount: attempt,
          unthrottled,
        });
        if (!unthrottled && options.cacheKey && options.cacheTtlSeconds) {
          await this.cache.set(options.cacheKey, response.data, options.cacheTtlSeconds);
        }
        return response.data;
      } catch (error) {
        const status = (error as { status?: number })?.status;
        const headers = ((error as { response?: { headers?: Record<string, string> } }).response?.headers ?? {}) as Record<string, string | undefined>;
        await this.rateLimit.updateFromHeaders(headers, { applySafetyThreshold: !ignoreSafetyThreshold });
        const retryable = options.retryable !== false && isRetryableGitHubError(error);
        if (!retryable || attempt >= this.maxRetries) {
          this.metrics.recordFailedJob();
          throw normalizeGitHubError(error, headers);
        }
        const retryAfterMs = parseRetryAfterHeader(headerString(headers["retry-after"]));
        const resetAtMs = headerString(headers["x-ratelimit-reset"]) ? Number(headerString(headers["x-ratelimit-reset"])) * 1000 : undefined;
        const delayMs = computeRetryDelayMs({
          attempt,
          baseDelayMs: this.retryBaseDelayMs,
          maxDelayMs: this.retryMaxDelayMs,
          ...(retryAfterMs ? { retryAfterMs } : {}),
          ...(resetAtMs ? { resetAtMs } : {}),
        });
        attempt += 1;
        this.metrics.recordRetry();
        this.metrics.recordDelayedRetry();
        await this.rateLimit.pauseUntil(Date.now() + delayMs, `retryable ${status ?? "error"} on ${options.endpoint}`);
        this.logger.warn({
          endpoint: options.endpoint,
          method: options.method,
          repository: options.repository,
          retryCount: attempt,
          retryReason: error instanceof Error ? error.message : "retryable GitHub error",
          retryAt: new Date(Date.now() + delayMs).toISOString(),
        });
        await sleep(delayMs);
        this.metrics.recordResumedJob();
      } finally {
        this.metrics.endActiveRequest();
        if (!unthrottled) this.releaseApiSlot();
      }
    }
  }

  private async acquireApiSlot(): Promise<void> {
    await this.rateLimit.waitIfPaused();
    await new Promise<void>((resolve) => {
      const tryAcquire = (): void => {
        if (this.activeApiCalls < this.apiConcurrency) {
          const spacing = Math.max(0, this.apiMinTimeMs - (Date.now() - this.lastApiCallAt));
          const start = (): void => {
            this.activeApiCalls += 1;
            this.lastApiCallAt = Date.now();
            resolve();
          };
          if (spacing > 0) setTimeout(start, spacing);
          else start();
          return;
        }
        this.apiQueue.push(tryAcquire);
      };
      tryAcquire();
    });
  }

  private releaseApiSlot(): void {
    this.activeApiCalls = Math.max(0, this.activeApiCalls - 1);
    const next = this.apiQueue.shift();
    if (next) next();
  }

  private createOctokit(token: string): Octokit {
    return new Octokit({ auth: token, request: { timeout: 20_000 } });
  }
}

function normalizeGitHubError(error: unknown, headers: Record<string, unknown>): Error {
  const status = (error as { status?: number })?.status;
  if (status === 403 || status === 429) {
    const retryAfterMs = parseRetryAfterHeader(headerString(headers["retry-after"])) ?? 60_000;
    const message = error instanceof Error ? error.message : "GitHub API rate limit exceeded";
    return new GitHubRateLimitError(message, retryAfterMs, status);
  }
  return error instanceof Error ? error : new Error("GitHub API request failed");
}

function headerString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type GitHubRest = RestEndpointMethodTypes;
