import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import type { Environment } from "../../../config/environment.js";

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

@Injectable()
export class GitHubCacheService implements OnModuleDestroy {
  private readonly redis: Redis | null;
  private readonly defaultTtlSeconds: number;
  private readonly memory = new Map<string, CacheEntry<unknown>>();

  constructor(@Inject(ConfigService) config: ConfigService<Environment, true>) {
    const redisUrl = config.get("REDIS_URL", { infer: true });
    this.redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true }) : null;
    this.defaultTtlSeconds = config.get("GITHUB_CACHE_TTL_SECONDS", { infer: true });
    void this.redis?.connect().catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit();
  }

  async get<T>(key: string): Promise<T | null> {
    const memoryEntry = this.memory.get(key);
    if (memoryEntry && memoryEntry.expiresAt > Date.now()) return memoryEntry.value as T;
    if (memoryEntry) this.memory.delete(key);

    if (!this.redis) return null;
    const raw = await this.redis.get(`github:cache:${key}`).catch(() => null);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds = this.defaultTtlSeconds): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.memory.set(key, { expiresAt, value });
    if (this.redis) {
      await this.redis.set(`github:cache:${key}`, JSON.stringify(value), "EX", ttlSeconds).catch(() => undefined);
    }
  }

  async invalidate(key: string): Promise<void> {
    this.memory.delete(key);
    if (this.redis) await this.redis.del(`github:cache:${key}`).catch(() => undefined);
  }
}
