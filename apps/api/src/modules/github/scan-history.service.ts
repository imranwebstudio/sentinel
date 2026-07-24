import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import {
  HistoryFindingStatus,
  RuntimeScanMode,
  RuntimeScanStatus,
} from "../../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";

export interface HistoryViewerInput {
  id: number;
  login: string;
  name: string | null;
  email?: string | null;
  avatarUrl: string;
}

export interface SaveScanHistoryInput {
  mode: "fast" | "deep";
  status: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
  startedAt: string;
  completedAt?: string | undefined;
  durationMs?: number | undefined;
  repositoryCount: number;
  results: Array<{
    repository: string;
    branch: string;
    status?: string | undefined;
    discovered?: number | undefined;
    scanned: number;
    skipped: number;
    findings: Array<{
      id: string;
      repository: string;
      branch: string;
      path: string;
      action: string;
      snippets: number;
      blobSha: string;
      htmlUrl: string;
    }>;
    errors: Array<{ path: string; message: string }>;
    truncated: boolean;
    durationMs?: number | undefined;
    mode?: string | undefined;
    files?: unknown;
  }>;
  failedRepositories?: Array<{ repository: string; message?: string | undefined }> | undefined;
}

@Injectable()
export class ScanHistoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  assertEnabled(): void {
    if (!this.prisma.enabled) {
      throw new ServiceUnavailableException("Database is not configured. Set DATABASE_URL and start Postgres.");
    }
  }

  async ensureUser(viewer: HistoryViewerInput) {
    this.assertEnabled();
    const providerSubject = String(viewer.id);
    const email = viewer.email?.trim() || `${viewer.login.toLowerCase()}@users.noreply.github.com`;
    const existing = await this.prisma.db.authIdentity.findUnique({
      where: { provider_providerSubject: { provider: "github", providerSubject } },
      include: { user: true },
    });
    if (existing) {
      return this.prisma.db.user.update({
        where: { id: existing.userId },
        data: {
          displayName: viewer.name ?? viewer.login,
          avatarUrl: viewer.avatarUrl,
          lastLoginAt: new Date(),
          status: "ACTIVE",
        },
      });
    }

    const byEmail = await this.prisma.db.user.findUnique({ where: { email } });
    if (byEmail) {
      await this.prisma.db.authIdentity.create({
        data: {
          userId: byEmail.id,
          provider: "github",
          providerSubject,
          scopes: ["repo", "read:org"],
        },
      });
      return this.prisma.db.user.update({
        where: { id: byEmail.id },
        data: {
          displayName: viewer.name ?? viewer.login,
          avatarUrl: viewer.avatarUrl,
          lastLoginAt: new Date(),
        },
      });
    }

    return this.prisma.db.user.create({
      data: {
        email,
        displayName: viewer.name ?? viewer.login,
        avatarUrl: viewer.avatarUrl,
        lastLoginAt: new Date(),
        identities: {
          create: {
            provider: "github",
            providerSubject,
            scopes: ["repo", "read:org"],
          },
        },
      },
    });
  }

  async save(viewer: HistoryViewerInput, input: SaveScanHistoryInput) {
    const user = await this.ensureUser(viewer);
    const findings = input.results.flatMap((result) => result.findings);
    const failedCount = input.failedRepositories?.length ?? 0;
    const completedCount = input.results.length;
    const filesScanned = input.results.reduce((sum, result) => sum + result.scanned, 0);

    const history = await this.prisma.db.scanHistory.create({
      data: {
        userId: user.id,
        githubLogin: viewer.login,
        mode: input.mode === "fast" ? RuntimeScanMode.FAST : RuntimeScanMode.DEEP,
        status: RuntimeScanStatus[input.status],
        repositoryCount: input.repositoryCount,
        completedCount,
        failedCount,
        findingsCount: findings.length,
        openFindingsCount: findings.length,
        filesScanned,
        durationMs: input.durationMs ?? null,
        startedAt: new Date(input.startedAt),
        completedAt: input.completedAt ? new Date(input.completedAt) : new Date(),
        repositories: {
          create: [
            ...input.results.map((result) => ({
              fullName: result.repository,
              branch: result.branch,
              status: "completed",
              scanned: result.scanned,
              skipped: result.skipped,
              findingsCount: result.findings.length,
              errorCount: result.errors.length,
              durationMs: result.durationMs ?? null,
              truncated: result.truncated,
              result: result as object,
            })),
            ...(input.failedRepositories ?? []).map((failed) => ({
              fullName: failed.repository,
              branch: "unknown",
              status: "failed",
              scanned: 0,
              skipped: 0,
              findingsCount: 0,
              errorCount: 1,
              truncated: false,
              result: { message: failed.message ?? "Scan failed" },
            })),
          ],
        },
        findings: {
          create: findings.map((finding) => ({
            externalId: finding.id,
            repository: finding.repository,
            branch: finding.branch,
            path: finding.path,
            action: finding.action,
            snippets: finding.snippets,
            blobSha: finding.blobSha,
            htmlUrl: finding.htmlUrl,
            status: HistoryFindingStatus.OPEN,
          })),
        },
      },
      include: {
        repositories: { orderBy: { fullName: "asc" } },
        findings: { where: { status: HistoryFindingStatus.OPEN }, orderBy: { createdAt: "desc" } },
      },
    });

    return this.serializeHistory(history);
  }

  async list(viewer: HistoryViewerInput, limit = 20) {
    const user = await this.ensureUser(viewer);
    const rows = await this.prisma.db.scanHistory.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        _count: { select: { findings: true, repositories: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      mode: row.mode === RuntimeScanMode.FAST ? "fast" : "deep",
      status: row.status,
      githubLogin: row.githubLogin,
      repositoryCount: row.repositoryCount,
      completedCount: row.completedCount,
      failedCount: row.failedCount,
      findingsCount: row.findingsCount,
      openFindingsCount: row.openFindingsCount,
      filesScanned: row.filesScanned,
      durationMs: row.durationMs,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      repositoryRecords: row._count.repositories,
      findingRecords: row._count.findings,
    }));
  }

  async get(viewer: HistoryViewerInput, id: string) {
    const user = await this.ensureUser(viewer);
    const history = await this.prisma.db.scanHistory.findFirst({
      where: { id, userId: user.id },
      include: {
        repositories: { orderBy: { fullName: "asc" } },
        findings: { orderBy: [{ status: "asc" }, { createdAt: "desc" }] },
      },
    });
    if (!history) throw new NotFoundException("Scan history not found.");
    return this.serializeHistory(history);
  }

  async markFindingsRemediated(viewer: HistoryViewerInput, externalIds: string[]) {
    if (externalIds.length === 0) return { updated: 0 };
    const user = await this.ensureUser(viewer);
    const result = await this.prisma.db.scanHistoryFinding.updateMany({
      where: {
        externalId: { in: externalIds },
        status: HistoryFindingStatus.OPEN,
        scanHistory: { userId: user.id },
      },
      data: { status: HistoryFindingStatus.REMEDIATED },
    });

    const affected = await this.prisma.db.scanHistoryFinding.findMany({
      where: { externalId: { in: externalIds }, scanHistory: { userId: user.id } },
      select: { scanHistoryId: true },
      distinct: ["scanHistoryId"],
    });
    for (const row of affected) {
      const openFindingsCount = await this.prisma.db.scanHistoryFinding.count({
        where: { scanHistoryId: row.scanHistoryId, status: HistoryFindingStatus.OPEN },
      });
      await this.prisma.db.scanHistory.update({
        where: { id: row.scanHistoryId },
        data: { openFindingsCount },
      });
    }

    return { updated: result.count };
  }

  private serializeHistory(history: {
    id: string;
    mode: RuntimeScanMode;
    status: RuntimeScanStatus;
    githubLogin: string;
    repositoryCount: number;
    completedCount: number;
    failedCount: number;
    findingsCount: number;
    openFindingsCount: number;
    filesScanned: number;
    durationMs: number | null;
    startedAt: Date;
    completedAt: Date | null;
    repositories: Array<{
      id: string;
      fullName: string;
      branch: string;
      status: string;
      scanned: number;
      skipped: number;
      findingsCount: number;
      errorCount: number;
      durationMs: number | null;
      truncated: boolean;
      result: unknown;
    }>;
    findings: Array<{
      id: string;
      externalId: string;
      repository: string;
      branch: string;
      path: string;
      action: string;
      snippets: number;
      blobSha: string;
      htmlUrl: string;
      status: HistoryFindingStatus;
      createdAt: Date;
    }>;
  }) {
    return {
      id: history.id,
      mode: history.mode === RuntimeScanMode.FAST ? "fast" : "deep",
      status: history.status,
      githubLogin: history.githubLogin,
      repositoryCount: history.repositoryCount,
      completedCount: history.completedCount,
      failedCount: history.failedCount,
      findingsCount: history.findingsCount,
      openFindingsCount: history.openFindingsCount,
      filesScanned: history.filesScanned,
      durationMs: history.durationMs,
      startedAt: history.startedAt.toISOString(),
      completedAt: history.completedAt?.toISOString() ?? null,
      repositories: history.repositories.map((repo) => ({
        id: repo.id,
        fullName: repo.fullName,
        branch: repo.branch,
        status: repo.status,
        scanned: repo.scanned,
        skipped: repo.skipped,
        findingsCount: repo.findingsCount,
        errorCount: repo.errorCount,
        durationMs: repo.durationMs,
        truncated: repo.truncated,
        result: repo.result,
      })),
      findings: history.findings.map((finding) => ({
        id: finding.externalId,
        historyFindingId: finding.id,
        repository: finding.repository,
        branch: finding.branch,
        path: finding.path,
        action: finding.action as "REVIEW_DELETE" | "REMOVE_MALWARE",
        snippets: finding.snippets,
        blobSha: finding.blobSha,
        htmlUrl: finding.htmlUrl,
        status: finding.status === HistoryFindingStatus.OPEN ? "open" : "remediated",
        createdAt: finding.createdAt.toISOString(),
      })),
    };
  }
}
