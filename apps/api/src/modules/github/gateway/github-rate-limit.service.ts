import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import type { Environment } from "../../../config/environment.js";
import type { RateLimitSnapshot } from "./types.js";

const REDIS_PREFIX = "github:ratelimit";

@Injectable()
export class GitHubRateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(GitHubRateLimitService.name);
  private readonly redis: Redis | null;
  private readonly safetyThreshold: number;
  private local: RateLimitSnapshot = {
    resource: "core",
    limit: null,
    used: null,
    remaining: null,
    resetAt: null,
    pausedUntil: null,
  };

  constructor(@Inject(ConfigService) config: ConfigService<Environment, true>) {
    const redisUrl = config.get("REDIS_URL", { infer: true });
    this.redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true }) : null;
    this.safetyThreshold = config.get("GITHUB_RATE_LIMIT_SAFETY_THRESHOLD", { infer: true });
    void this.redis?.connect().catch(() => {
      this.logger.warn("Redis unavailable for shared rate-limit coordination; using in-process state only.");
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit();
  }

  getSnapshot(): RateLimitSnapshot {
    return { ...this.local };
  }

  async updateFromHeaders(headers: Record<string, unknown>, options?: { applySafetyThreshold?: boolean }): Promise<void> {
    const resource = headerString(headers["x-ratelimit-resource"]) ?? "core";
    const limit = parseHeaderNumber(headerString(headers["x-ratelimit-limit"]));
    const used = parseHeaderNumber(headerString(headers["x-ratelimit-used"]));
    const remaining = parseHeaderNumber(headerString(headers["x-ratelimit-remaining"]));
    const resetAt = parseHeaderNumber(headerString(headers["x-ratelimit-reset"]));
    const resetAtMs = resetAt ? resetAt * 1000 : null;

    this.local = {
      resource,
      limit,
      used,
      remaining,
      resetAt: resetAtMs,
      pausedUntil: this.local.pausedUntil,
    };

    if (this.redis) {
      const pipeline = this.redis.pipeline();
      if (limit !== null) pipeline.set(`${REDIS_PREFIX}:limit`, String(limit), "EX", 3600);
      if (used !== null) pipeline.set(`${REDIS_PREFIX}:used`, String(used), "EX", 3600);
      if (remaining !== null) pipeline.set(`${REDIS_PREFIX}:remaining`, String(remaining), "EX", 3600);
      if (resetAtMs !== null) pipeline.set(`${REDIS_PREFIX}:reset`, String(resetAtMs), "EX", 3600);
      pipeline.set(`${REDIS_PREFIX}:resource`, resource, "EX", 3600);
      await pipeline.exec().catch(() => undefined);
    }

    const applySafetyThreshold = options?.applySafetyThreshold !== false;
    if (applySafetyThreshold && resource === "core" && remaining !== null && remaining <= this.safetyThreshold) {
      const pauseUntil = resetAtMs ?? Date.now() + 60_000;
      await this.pauseUntil(pauseUntil, `core remaining ${remaining} <= safety threshold ${this.safetyThreshold}`);
    }
  }

  async pauseUntil(untilMs: number, reason: string): Promise<void> {
    const current = this.local.pausedUntil ?? 0;
    if (untilMs <= current) return;
    this.local.pausedUntil = untilMs;
    if (this.redis) {
      await this.redis.set(`${REDIS_PREFIX}:paused_until`, String(untilMs), "PX", Math.max(1000, untilMs - Date.now())).catch(() => undefined);
    }
    this.logger.warn(`GitHub API paused until ${new Date(untilMs).toISOString()} (${reason})`);
  }

  async waitIfPaused(): Promise<void> {
    const pausedUntil = await this.getPausedUntil();
    const waitMs = pausedUntil - Date.now();
    if (waitMs > 0) await sleep(waitMs);
  }

  private async getPausedUntil(): Promise<number> {
    if (this.redis) {
      const value = await this.redis.get(`${REDIS_PREFIX}:paused_until`).catch(() => null);
      if (value) {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) {
          this.local.pausedUntil = parsed;
          return parsed;
        }
      }
    }
    return this.local.pausedUntil ?? 0;
  }
}

function parseHeaderNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function headerString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
