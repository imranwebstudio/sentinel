import { Injectable } from "@nestjs/common";
import type { GitHubGatewayMetrics, RateLimitSnapshot } from "./types.js";

@Injectable()
export class GitHubMetricsService {
  private requestsTotal = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private deduplicatedRequests = 0;
  private skippedUnchangedFiles = 0;
  private activeRequests = 0;
  private delayedRetries = 0;
  private resumedJobs = 0;
  private failedJobs = 0;
  private retriesTotal = 0;
  private readonly requestTimestamps: number[] = [];

  recordRequest(): void {
    this.requestsTotal += 1;
    const now = Date.now();
    this.requestTimestamps.push(now);
    this.pruneTimestamps(now);
  }

  recordCacheHit(): void { this.cacheHits += 1; }
  recordCacheMiss(): void { this.cacheMisses += 1; }
  recordDedup(): void { this.deduplicatedRequests += 1; }
  recordSkippedUnchanged(): void { this.skippedUnchangedFiles += 1; }
  recordRetry(): void { this.retriesTotal += 1; }
  recordDelayedRetry(): void { this.delayedRetries += 1; }
  recordResumedJob(): void { this.resumedJobs += 1; }
  recordFailedJob(): void { this.failedJobs += 1; }

  beginActiveRequest(): void { this.activeRequests += 1; }
  endActiveRequest(): void { this.activeRequests = Math.max(0, this.activeRequests - 1); }

  snapshot(rateLimit: RateLimitSnapshot): GitHubGatewayMetrics {
    const now = Date.now();
    this.pruneTimestamps(now);
    const cacheTotal = this.cacheHits + this.cacheMisses;
    return {
      requestsTotal: this.requestsTotal,
      requestsPerMinute: this.requestTimestamps.length,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      deduplicatedRequests: this.deduplicatedRequests,
      skippedUnchangedFiles: this.skippedUnchangedFiles,
      activeRequests: this.activeRequests,
      delayedRetries: this.delayedRetries,
      resumedJobs: this.resumedJobs,
      failedJobs: this.failedJobs,
      retriesTotal: this.retriesTotal,
      rateLimit,
      ...(cacheTotal > 0 ? { cacheHitRate: this.cacheHits / cacheTotal } : {}),
    } as GitHubGatewayMetrics & { cacheHitRate?: number };
  }

  private pruneTimestamps(now: number): void {
    const cutoff = now - 60_000;
    while (this.requestTimestamps.length > 0 && (this.requestTimestamps[0] ?? 0) < cutoff) {
      this.requestTimestamps.shift();
    }
  }
}
