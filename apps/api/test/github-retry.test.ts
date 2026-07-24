import assert from "node:assert/strict";
import test from "node:test";
import { computeRetryDelayMs, parseRetryAfterHeader } from "../src/modules/github/gateway/github-retry.js";

test("parseRetryAfterHeader supports seconds", () => {
  assert.equal(parseRetryAfterHeader("2"), 2000);
});

test("parseRetryAfterHeader supports HTTP date", () => {
  const future = new Date(Date.now() + 5000).toUTCString();
  const parsed = parseRetryAfterHeader(future);
  assert.ok(parsed !== null && parsed >= 4000 && parsed <= 6000);
});

test("computeRetryDelayMs prefers retry-after", () => {
  const delay = computeRetryDelayMs({ attempt: 0, baseDelayMs: 1000, maxDelayMs: 60000, retryAfterMs: 4500 });
  assert.equal(delay, 4500);
});

test("computeRetryDelayMs prefers reset time", () => {
  const resetAtMs = Date.now() + 8000;
  const delay = computeRetryDelayMs({ attempt: 0, baseDelayMs: 1000, maxDelayMs: 60000, resetAtMs });
  assert.ok(delay >= 8000 && delay <= 9000);
});

test("computeRetryDelayMs uses exponential backoff with jitter", () => {
  const delay = computeRetryDelayMs({ attempt: 2, baseDelayMs: 1000, maxDelayMs: 60000 });
  assert.ok(delay >= 4000 && delay <= 5500);
});
