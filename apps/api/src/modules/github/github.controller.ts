import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { GitHubService } from "./github.service.js";
import { GitHubAuthService } from "./github-auth.service.js";
import { ScanHistoryService } from "./scan-history.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const scanRequestSchema = z.object({
  mode: z.enum(["fast", "deep"]).default("fast"),
  repositories: z.array(z.object({
    owner: z.string().min(1).max(100),
    repo: z.string().min(1).max(100),
    branch: z.string().min(1).max(255),
  })).min(1),
});

const remediateRequestSchema = z.object({
  findings: z.array(z.object({
    id: z.string().min(1),
    owner: z.string().min(1).max(100),
    repo: z.string().min(1).max(100),
    branch: z.string().min(1).max(255),
    path: z.string().min(1).max(500),
    action: z.enum(["REVIEW_DELETE", "REMOVE_MALWARE"]),
    blobSha: z.string().min(1),
  })).min(1).max(50),
});

const saveHistorySchema = z.object({
  mode: z.enum(["fast", "deep"]),
  status: z.enum(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]).default("COMPLETED"),
  startedAt: z.string().min(1),
  completedAt: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  repositoryCount: z.number().int().nonnegative(),
  results: z.array(z.object({
    repository: z.string().min(1),
    branch: z.string().min(1),
    scanned: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    findings: z.array(z.object({
      id: z.string().min(1),
      repository: z.string().min(1),
      branch: z.string().min(1),
      path: z.string().min(1),
      action: z.enum(["REVIEW_DELETE", "REMOVE_MALWARE"]),
      snippets: z.number().int().nonnegative(),
      blobSha: z.string().min(1),
      htmlUrl: z.string().min(1),
    })),
    errors: z.array(z.object({
      path: z.string(),
      message: z.string(),
    })),
    truncated: z.boolean(),
    durationMs: z.number().int().nonnegative().optional(),
    discovered: z.number().int().nonnegative().optional(),
    mode: z.string().optional(),
    files: z.array(z.unknown()).optional(),
  })),
  failedRepositories: z.array(z.object({
    repository: z.string().min(1),
    message: z.string().optional(),
  })).optional(),
});

const remediateHistorySchema = z.object({
  externalIds: z.array(z.string().min(1)).min(1).max(200),
});

@ApiTags("github")
@Controller("github")
export class GitHubController {
  constructor(
    @Inject(GitHubService) private readonly github: GitHubService,
    @Inject(GitHubAuthService) private readonly auth: GitHubAuthService,
    @Inject(ScanHistoryService) private readonly history: ScanHistoryService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get("oauth/start")
  start(@Res() reply: FastifyReply): void { this.auth.start(reply); }

  @Get("oauth/callback")
  async callback(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const query = request.query as { code?: string; state?: string };
    await this.auth.callback(request, reply, query.code ?? "", query.state ?? "");
  }

  @Post("logout")
  @HttpCode(204)
  logout(@Res() reply: FastifyReply): void { this.auth.logout(reply); reply.status(204).send(); }

  @Get("connection")
  @ApiOperation({ summary: "Get local GitHub connection status" })
  async connection(@Req() request: FastifyRequest) {
    const oauthToken = this.auth.token(request);
    if (!oauthToken && !this.github.isConnected()) {
      return {
        connected: false,
        mode: "not_configured",
        oauthConfigured: this.auth.configured(),
        callbackUrl: this.auth.callbackUrl(),
        databaseConfigured: this.prisma.enabled,
      };
    }
    try {
      const viewer = await this.github.getViewer(oauthToken);
      if (this.prisma.enabled) {
        await this.history.ensureUser(viewer).catch(() => undefined);
      }
      return {
        connected: true,
        mode: oauthToken ? "oauth" : "development_token",
        viewer,
        oauthConfigured: this.auth.configured(),
        databaseConfigured: this.prisma.enabled,
      };
    } catch {
      return {
        connected: false,
        mode: "invalid_credentials",
        oauthConfigured: this.auth.configured(),
        callbackUrl: this.auth.callbackUrl(),
        databaseConfigured: this.prisma.enabled,
      };
    }
  }

  @Get("repositories")
  @ApiOperation({ summary: "List repositories accessible to the connected GitHub identity" })
  async repositories(@Req() request: FastifyRequest) {
    return { repositories: await this.github.listRepositories(this.auth.token(request)) };
  }

  @Get("metrics/rate-limit")
  @ApiOperation({ summary: "GitHub API rate-limit and gateway metrics" })
  metrics() {
    return this.github.getGatewayMetrics();
  }

  @Post("scans/stream")
  @HttpCode(200)
  @ApiOperation({ summary: "Scan selected repositories and stream NDJSON progress (fast or deep)" })
  async scan(@Body() body: unknown, @Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const parsed = scanRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Provide a valid scan mode and at least one repository.");
    }
    const input = parsed.data;
    const max = input.mode === "fast" ? 1000 : 25;
    if (input.repositories.length > max) {
      throw new BadRequestException(`Select between 1 and ${max} valid repositories to scan (${input.mode}).`);
    }
    const workerCount = this.github.repositoryConcurrencyFor(input.mode);
    reply.raw.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    });
    const send = (event: Record<string, unknown>) => {
      reply.raw.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`);
      const flushable = reply.raw as typeof reply.raw & { flush?: () => void };
      flushable.flush?.();
    };
    send({
      type: "scan:started",
      mode: input.mode,
      repositoryCount: input.repositories.length,
      workerCount,
    });

    const results = await this.github.scanRepositories(
      input.repositories,
      input.mode,
      send,
      this.auth.token(request),
    );

    send({ type: "scan:completed", mode: input.mode, results });
    reply.raw.end();
  }

  @Post("scan-history")
  @HttpCode(201)
  @ApiOperation({ summary: "Persist a completed scan for the authenticated GitHub user" })
  async saveHistory(@Body() body: unknown, @Req() request: FastifyRequest) {
    const viewer = await this.requireViewer(request);
    const parsed = saveHistorySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid scan history payload.");
    const input = parsed.data;
    return this.history.save(viewer, {
      mode: input.mode,
      status: input.status,
      startedAt: input.startedAt,
      repositoryCount: input.repositoryCount,
      results: input.results,
      ...(input.completedAt ? { completedAt: input.completedAt } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.failedRepositories ? { failedRepositories: input.failedRepositories } : {}),
    });
  }

  @Get("scan-history")
  @ApiOperation({ summary: "List durable scan history for the authenticated GitHub user" })
  async listHistory(@Req() request: FastifyRequest, @Query("limit") limit?: string) {
    const viewer = await this.requireViewer(request);
    const parsedLimit = limit ? Number(limit) : 20;
    return { history: await this.history.list(viewer, Number.isFinite(parsedLimit) ? parsedLimit : 20) };
  }

  @Get("scan-history/:id")
  @ApiOperation({ summary: "Get one scan history record with repositories and findings" })
  async getHistory(@Param("id") id: string, @Req() request: FastifyRequest) {
    const viewer = await this.requireViewer(request);
    return this.history.get(viewer, id);
  }

  @Post("scan-history/findings/remediated")
  @HttpCode(200)
  @ApiOperation({ summary: "Mark history findings as remediated after cleanup" })
  async markRemediated(@Body() body: unknown, @Req() request: FastifyRequest) {
    const viewer = await this.requireViewer(request);
    const parsed = remediateHistorySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Provide finding ids to mark remediated.");
    return this.history.markFindingsRemediated(viewer, parsed.data.externalIds);
  }

  @Post("remediate")
  @HttpCode(200)
  @ApiOperation({ summary: "Remove malware or delete flagged files in selected repositories" })
  async remediate(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = remediateRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Provide between 1 and 50 valid findings to remediate.");
    const result = await this.github.remediateFindings(parsed.data.findings, this.auth.token(request));
    if (this.prisma.enabled && result.succeeded.length > 0) {
      try {
        const viewer = await this.github.getViewer(this.auth.token(request));
        await this.history.markFindingsRemediated(viewer, result.succeeded);
      } catch {
        // History sync is best-effort; remediation itself already succeeded.
      }
    }
    return result;
  }

  private async requireViewer(request: FastifyRequest) {
    const token = this.auth.token(request);
    if (!token && !this.github.isConnected()) throw new UnauthorizedException("Connect GitHub before saving scan history.");
    return this.github.getViewer(token);
  }
}
