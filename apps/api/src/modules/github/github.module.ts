import { Module } from "@nestjs/common";
import { GitHubController } from "./github.controller.js";
import { GitHubService } from "./github.service.js";
import { GitHubAuthService } from "./github-auth.service.js";
import { ScanHistoryService } from "./scan-history.service.js";
import { GitHubGatewayService } from "./gateway/github-gateway.service.js";
import { GitHubRateLimitService } from "./gateway/github-rate-limit.service.js";
import { GitHubCacheService } from "./gateway/github-cache.service.js";
import { GitHubMetricsService } from "./gateway/github-metrics.service.js";
import { ScanRetryQueueService } from "./gateway/scan-retry-queue.service.js";

@Module({
  controllers: [GitHubController],
  providers: [
    GitHubService,
    GitHubAuthService,
    ScanHistoryService,
    GitHubGatewayService,
    GitHubRateLimitService,
    GitHubCacheService,
    GitHubMetricsService,
    ScanRetryQueueService,
  ],
})
export class GitHubModule {}
