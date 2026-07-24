import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  API_VERSION: z.string().default("0.1.0"),
  WEB_ORIGIN: z.url().default("http://localhost:5173"),
  API_PUBLIC_URL: z.url().default("http://localhost:3001"),
  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
  GITHUB_PAT: z.string().min(1).optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(16).optional(),
  FETCH_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(20),
  REPOSITORY_FETCH_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
  FAST_REPOSITORY_FETCH_CONCURRENCY: z.coerce.number().int().min(1).max(40).default(20),
  LOCAL_SCAN_WORKERS: z.coerce.number().int().min(1).max(100).default(20),
  GITHUB_API_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  GITHUB_API_MIN_TIME_MS: z.coerce.number().int().min(0).max(10_000).default(250),
  FAST_GITHUB_API_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(40),
  FAST_GITHUB_API_MIN_TIME_MS: z.coerce.number().int().min(0).max(10_000).default(0),
  GITHUB_RATE_LIMIT_SAFETY_THRESHOLD: z.coerce.number().int().min(0).max(5000).default(100),
  GITHUB_MAX_RETRIES: z.coerce.number().int().min(0).max(20).default(5),
  GITHUB_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  GITHUB_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(1000).max(600_000).default(60_000),
  GITHUB_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(86_400).default(300),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): Environment {
  return environmentSchema.parse(input);
}
