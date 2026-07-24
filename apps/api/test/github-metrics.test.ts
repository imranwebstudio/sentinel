import assert from "node:assert/strict";
import test from "node:test";
import { GitHubMetricsService } from "../src/modules/github/gateway/github-metrics.service.js";

test("metrics snapshot tracks cache and dedup counters", () => {
  const metrics = new GitHubMetricsService();
  metrics.recordCacheHit();
  metrics.recordCacheMiss();
  metrics.recordDedup();
  metrics.recordSkippedUnchanged();
  const snapshot = metrics.snapshot({
    resource: "core",
    limit: 5000,
    used: 100,
    remaining: 4900,
    resetAt: Date.now() + 60_000,
    pausedUntil: null,
  });
  assert.equal(snapshot.cacheHits, 1);
  assert.equal(snapshot.cacheMisses, 1);
  assert.equal(snapshot.deduplicatedRequests, 1);
  assert.equal(snapshot.skippedUnchangedFiles, 1);
  assert.equal(snapshot.rateLimit.remaining, 4900);
});
