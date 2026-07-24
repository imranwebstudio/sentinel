import { z } from "zod";

export const scanStatusSchema = z.enum([
  "REQUESTED",
  "QUEUED",
  "DISCOVERING",
  "SCANNING",
  "AGGREGATING",
  "PAUSING",
  "PAUSED",
  "CANCELLING",
  "CANCELLED",
  "COMPLETED",
  "FAILED",
]);

export type ScanStatus = z.infer<typeof scanStatusSchema>;

export const createScanSchema = z.object({
  projectId: z.uuid(),
  mode: z.enum(["FULL", "INCREMENTAL"]).default("INCREMENTAL"),
  repositoryIds: z.array(z.uuid()).min(1).max(100),
  priority: z.number().int().min(1).max(100).default(50),
});

export type CreateScanInput = z.infer<typeof createScanSchema>;

export interface ScanProgress {
  scanId: string;
  status: ScanStatus;
  discovered: number;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  retried: number;
  skipped: number;
  workerCount: number;
  progressBasisPoints: number;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ApiHealth {
  status: "ok" | "degraded";
  service: string;
  version: string;
  timestamp: string;
  dependencies?: Record<string, "up" | "down" | "not_configured">;
}
