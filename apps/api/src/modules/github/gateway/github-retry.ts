export interface RetryDelayInput {
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryAfterMs?: number;
  resetAtMs?: number;
}

export function computeRetryDelayMs(input: RetryDelayInput): number {
  const now = Date.now();
  if (input.retryAfterMs && input.retryAfterMs > 0) return input.retryAfterMs;
  if (input.resetAtMs && input.resetAtMs > now) return input.resetAtMs - now + 250;
  const exponential = Math.min(input.baseDelayMs * 2 ** input.attempt, input.maxDelayMs);
  const jitter = Math.floor(Math.random() * Math.min(1000, exponential * 0.25));
  return exponential + jitter;
}

export function parseRetryAfterHeader(value: string | null | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}
