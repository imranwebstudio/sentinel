import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type { Environment } from "../../../config/environment.js";
import type { ScanTargetInput } from "../github.service.js";

export interface ScanFileRetryJob {
  scanId: string;
  target: ScanTargetInput;
  path: string;
  blobSha: string;
  token?: string;
  attempt: number;
}

@Injectable()
export class ScanRetryQueueService implements OnModuleDestroy {
  private readonly connection: Redis | null;
  private readonly queue: Queue<ScanFileRetryJob> | null;
  private readonly worker: Worker<ScanFileRetryJob> | null;

  constructor(@Inject(ConfigService) config: ConfigService<Environment, true>) {
    const redisUrl = config.get("REDIS_URL", { infer: true });
    if (!redisUrl) {
      this.connection = null;
      this.queue = null;
      this.worker = null;
      return;
    }
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<ScanFileRetryJob>("github-scan-retry", { connection: this.connection });
    this.worker = new Worker<ScanFileRetryJob>("github-scan-retry", async (job) => this.process(job), {
      connection: this.connection,
      concurrency: config.get("LOCAL_SCAN_WORKERS", { infer: true }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit();
  }

  async enqueue(job: ScanFileRetryJob, delayMs: number): Promise<void> {
    if (!this.queue) return;
    await this.queue.add("scan-file-retry", job, {
      jobId: `${job.scanId}:${job.target.owner}/${job.target.repo}:${job.path}:${job.blobSha}`,
      delay: delayMs,
      removeOnComplete: 1000,
      removeOnFail: 1000,
      attempts: 1,
    });
  }

  private async process(_job: Job<ScanFileRetryJob>): Promise<void> {
    // Reserved for durable resume in a later slice; gateway inline retries cover current scans.
  }
}
