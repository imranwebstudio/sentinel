import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  FAST_ROOT_PRESENCE_FILES,
  cleanInfectedContent,
  isFastScanCandidate,
  isRepositoryMetadataFile,
  needsFastContentRead,
  removeMalware,
  scanFastFileContent,
} from "@malware-remover/scanning-core";
import type { Environment } from "../../config/environment.js";
import { GitHubGatewayService } from "./gateway/github-gateway.service.js";
import { GitHubRateLimitError } from "./gateway/types.js";

export type ScanMode = "fast" | "deep";

export interface RepositorySummary {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  writable: boolean;
  htmlUrl: string;
  updatedAt: string | null;
}

export interface ScanTargetInput {
  owner: string;
  repo: string;
  branch: string;
}

export interface ScanFinding {
  id: string;
  repository: string;
  branch: string;
  path: string;
  action: "REVIEW_DELETE" | "REMOVE_MALWARE";
  snippets: number;
  blobSha: string;
  htmlUrl: string;
}

export interface RepositoryScanResult {
  repository: string;
  branch: string;
  discovered: number;
  scanned: number;
  skipped: number;
  findings: ScanFinding[];
  errors: Array<{ path: string; message: string }>;
  truncated: boolean;
  durationMs: number;
  mode: ScanMode;
  files: Array<{ path: string; status: "clean" | "infected" | "bat" | "error" | "cached_clean" | "cached_infected" }>;
}

export interface RemediationInput {
  id: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  action: ScanFinding["action"];
  blobSha: string;
}

export interface RemediationResult {
  succeeded: string[];
  failed: Array<{ id: string; message: string }>;
}

@Injectable()
export class GitHubService {
  readonly fileConcurrency: number;
  readonly repositoryConcurrency: number;
  readonly fastRepositoryConcurrency: number;
  readonly fastApiConcurrency: number;
  readonly fastApiMinTimeMs: number;

  constructor(
    @Inject(ConfigService) config: ConfigService<Environment, true>,
    @Inject(GitHubGatewayService) private readonly gateway: GitHubGatewayService,
  ) {
    this.fileConcurrency = config.get("LOCAL_SCAN_WORKERS", { infer: true });
    this.repositoryConcurrency = config.get("REPOSITORY_FETCH_CONCURRENCY", { infer: true });
    this.fastRepositoryConcurrency = config.get("FAST_REPOSITORY_FETCH_CONCURRENCY", { infer: true });
    this.fastApiConcurrency = config.get("FAST_GITHUB_API_CONCURRENCY", { infer: true });
    this.fastApiMinTimeMs = config.get("FAST_GITHUB_API_MIN_TIME_MS", { infer: true });
  }

  repositoryConcurrencyFor(mode: ScanMode): number {
    return mode === "fast" ? this.fastRepositoryConcurrency : this.repositoryConcurrency;
  }

  isConnected(): boolean {
    try {
      this.gateway.getClient();
      return true;
    } catch {
      return false;
    }
  }

  getGatewayMetrics() {
    return this.gateway.getMetrics();
  }

  async getViewer(token?: string): Promise<{ id: number; login: string; name: string | null; email: string | null; avatarUrl: string; htmlUrl: string }> {
    const client = this.gateway.getClient(token);
    const data = await this.gateway.execute({
      method: "GET",
      endpoint: "GET /user",
      cacheKey: `viewer:${token?.slice(0, 8) ?? "pat"}`,
      cacheTtlSeconds: 300,
      dedupeKey: `viewer:${token?.slice(0, 8) ?? "pat"}`,
    }, () => client.request("GET /user"));
    return {
      id: data.id,
      login: data.login,
      name: data.name,
      email: data.email ?? null,
      avatarUrl: data.avatar_url,
      htmlUrl: data.html_url,
    };
  }

  async listRepositories(token?: string): Promise<RepositorySummary[]> {
    const client = this.gateway.getClient(token);
    const cacheKey = `repos:${token?.slice(0, 8) ?? "pat"}`;
    const cached = await this.gateway.execute({
      method: "GET",
      endpoint: "GET /user/repos",
      cacheKey,
      cacheTtlSeconds: 300,
      dedupeKey: cacheKey,
    }, async () => {
      const repositories: Array<Record<string, unknown>> = [];
      let page = 1;
      while (true) {
        const pageData = await this.gateway.execute({
          method: "GET",
          endpoint: "GET /user/repos",
          dedupeKey: `${cacheKey}:page:${page}`,
        }, () => client.request("GET /user/repos", {
          visibility: "all",
          affiliation: "owner,collaborator,organization_member",
          sort: "updated",
          per_page: 100,
          page,
        }));
        repositories.push(...(pageData as Array<Record<string, unknown>>));
        if ((pageData as unknown[]).length < 100) break;
        page += 1;
      }
      return { data: repositories, headers: {}, status: 200 };
    });
    return (cached as Array<Record<string, unknown>>).map((repository) => ({
      id: repository.id as number,
      owner: (repository.owner as { login: string }).login,
      name: repository.name as string,
      fullName: repository.full_name as string,
      defaultBranch: repository.default_branch as string,
      private: repository.private as boolean,
      archived: repository.archived as boolean,
      writable: Boolean((repository.permissions as { push?: boolean } | undefined)?.push),
      htmlUrl: repository.html_url as string,
      updatedAt: (repository.updated_at as string | null) ?? null,
    }));
  }

  async scanRepositories(
    targets: ScanTargetInput[],
    mode: ScanMode,
    onProgress: (event: Record<string, unknown>) => void,
    token?: string,
  ): Promise<RepositoryScanResult[]> {
    const results: RepositoryScanResult[] = [];
    const concurrency = this.repositoryConcurrencyFor(mode);
    const run = async () => {
      await mapWithConcurrency(targets, concurrency, async (repository) => {
        onProgress({ type: "repository:started", repository: `${repository.owner}/${repository.repo}`, branch: repository.branch, mode });
        try {
          const result = await this.scanRepository(repository, mode, onProgress, token);
          results.push(result);
          onProgress({ type: "repository:completed", result });
        } catch (error) {
          onProgress({
            type: "repository:failed",
            repository: `${repository.owner}/${repository.repo}`,
            message: error instanceof Error ? error.message : "Scan failed",
            mode,
          });
        }
      });
    };

    if (mode === "fast") {
      await this.gateway.withThroughputProfile({
        apiConcurrency: this.fastApiConcurrency,
        apiMinTimeMs: this.fastApiMinTimeMs,
        unthrottled: true,
        ignoreSafetyThreshold: true,
      }, run);
    } else {
      await run();
    }

    return results;
  }

  async scanRepository(
    target: ScanTargetInput,
    mode: ScanMode,
    onProgress: (event: Record<string, unknown>) => void,
    token?: string,
  ): Promise<RepositoryScanResult> {
    return mode === "fast"
      ? this.scanRepositoryFast(target, onProgress, token)
      : this.scanRepositoryDeep(target, onProgress, token);
  }

  private async loadTree(target: ScanTargetInput, token?: string) {
    const client = this.gateway.getClient(token);
    const repository = `${target.owner}/${target.repo}`;

    // One commit lookup (by branch) + recursive tree — fewer calls than ref → commit → tree.
    const commit = await this.gateway.execute({
      method: "GET",
      endpoint: "GET /repos/{owner}/{repo}/commits/{ref}",
      repository,
      cacheKey: `commit-ref:${repository}:${target.branch}`,
      cacheTtlSeconds: 120,
      dedupeKey: `commit-ref:${repository}:${target.branch}`,
    }, () => client.request("GET /repos/{owner}/{repo}/commits/{ref}", {
      owner: target.owner,
      repo: target.repo,
      ref: target.branch,
    }));

    const treeSha = commit.commit.tree.sha;
    const tree = await this.gateway.execute({
      method: "GET",
      endpoint: "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
      repository,
      cacheKey: `tree:${repository}:${treeSha}`,
      cacheTtlSeconds: 300,
      dedupeKey: `tree:${repository}:${treeSha}`,
    }, () => client.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
      owner: target.owner,
      repo: target.repo,
      tree_sha: treeSha,
      recursive: "true",
    }));

    const blobs = tree.tree.filter((item): item is typeof item & { path: string; sha: string } =>
      item.type === "blob" && Boolean(item.path && item.sha));
    return { client, repository, blobs, truncated: Boolean(tree.truncated) };
  }

  private async scanRepositoryFast(
    target: ScanTargetInput,
    onProgress: (event: Record<string, unknown>) => void,
    token?: string,
  ): Promise<RepositoryScanResult> {
    const startedAt = Date.now();
    const client = this.gateway.getClient(token);
    const repository = `${target.owner}/${target.repo}`;
    const burst = { unthrottled: true, ignoreSafetyThreshold: true } as const;

    // Dose-scanner shape: getBranch → recursive tree → presence / tiny content set.
    const branch = await this.gateway.execute({
      method: "GET",
      endpoint: "GET /repos/{owner}/{repo}/branches/{branch}",
      repository,
      ...burst,
    }, () => client.request("GET /repos/{owner}/{repo}/branches/{branch}", {
      owner: target.owner,
      repo: target.repo,
      branch: target.branch,
    }));

    const treeSha = branch.commit.commit.tree.sha;
    const tree = await this.gateway.execute({
      method: "GET",
      endpoint: "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
      repository,
      ...burst,
    }, () => client.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
      owner: target.owner,
      repo: target.repo,
      tree_sha: treeSha,
      recursive: "true",
    }));

    const blobs = tree.tree.filter((item): item is typeof item & { path: string; sha: string } =>
      item.type === "blob" && Boolean(item.path && item.sha));
    const truncated = Boolean(tree.truncated);
    const candidates = blobs.filter((item) => isFastScanCandidate(item.path));
    const findings: ScanFinding[] = [];
    const errors: Array<{ path: string; message: string }> = [];
    const files: RepositoryScanResult["files"] = [];
    let scanned = 0;
    const skipped = blobs.length - candidates.length;

    onProgress({
      type: "repository:discovered",
      repository,
      branch: target.branch,
      discovered: blobs.length,
      candidates: candidates.length,
      truncated,
      mode: "fast",
    });

    // Fully parallel content reads for the tiny candidate set (dose uses Promise.all).
    await Promise.all(candidates.map(async (file) => {
      try {
        if (FAST_ROOT_PRESENCE_FILES.has(file.path)) {
          findings.push(this.finding(target, file.path, file.sha, "REVIEW_DELETE", 0));
          files.push({ path: file.path, status: "bat" });
          return;
        }

        if (!needsFastContentRead(file.path)) {
          files.push({ path: file.path, status: "clean" });
          return;
        }

        const content = await this.gateway.execute({
          method: "GET",
          endpoint: "GET /repos/{owner}/{repo}/contents/{path}",
          repository,
          ...burst,
        }, () => client.request("GET /repos/{owner}/{repo}/contents/{path}", {
          owner: target.owner,
          repo: target.repo,
          path: file.path,
          ref: target.branch,
        }));

        if (Array.isArray(content) || content.type !== "file" || !("content" in content) || !content.content) {
          files.push({ path: file.path, status: "clean" });
          return;
        }

        const text = Buffer.from(content.content.replace(/\s/g, ""), "base64").toString("utf8");
        const issues = scanFastFileContent(file.path, text);
        const blobSha = content.sha ?? file.sha;
        if (issues.length > 0) {
          findings.push(this.finding(target, file.path, blobSha, "REMOVE_MALWARE", issues.length));
          files.push({ path: file.path, status: "infected" });
        } else {
          files.push({ path: file.path, status: "clean" });
        }
      } catch (error) {
        const message = error instanceof GitHubRateLimitError
          ? `GitHub API rate limit exceeded; retry scheduled (${error.retryAfterMs}ms)`
          : error instanceof Error ? error.message : "Unknown GitHub error";
        errors.push({ path: file.path, message });
        files.push({ path: file.path, status: "error" });
      } finally {
        scanned += 1;
        if (scanned === candidates.length || scanned % 3 === 0) {
          onProgress({
            type: "repository:progress",
            repository,
            scanned,
            total: candidates.length,
            findings: findings.length,
            errors: errors.length,
            elapsedMs: Date.now() - startedAt,
            latestFile: file.path,
            mode: "fast",
          });
        }
      }
    }));

    return {
      repository,
      branch: target.branch,
      discovered: blobs.length,
      scanned,
      skipped,
      findings,
      errors,
      truncated,
      durationMs: Date.now() - startedAt,
      mode: "fast",
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  private async scanRepositoryDeep(
    target: ScanTargetInput,
    onProgress: (event: Record<string, unknown>) => void,
    token?: string,
  ): Promise<RepositoryScanResult> {
    const startedAt = Date.now();
    const { client, repository, blobs, truncated } = await this.loadTree(target, token);
    const candidates = blobs.filter((item) => isRepositoryMetadataFile(item.path));
    const findings: ScanFinding[] = [];
    const errors: Array<{ path: string; message: string }> = [];
    const files: RepositoryScanResult["files"] = [];
    let scanned = 0;
    const skipped = blobs.length - candidates.length;

    onProgress({
      type: "repository:discovered",
      repository,
      branch: target.branch,
      discovered: blobs.length,
      candidates: candidates.length,
      truncated,
      mode: "deep",
    });

    await mapWithConcurrency(candidates, this.fileConcurrency, async (file) => {
      try {
        if (file.path.toLowerCase().endsWith(".bat")) {
          findings.push(this.finding(target, file.path, file.sha, "REVIEW_DELETE", 0));
          files.push({ path: file.path, status: "bat" });
          await this.gateway.setCachedBlobScanResult(file.sha, "bat", "deep");
          return;
        }

        const cached = await this.gateway.getCachedBlobScanResult(file.sha, "deep");
        if (cached === "clean") {
          files.push({ path: file.path, status: "cached_clean" });
          this.gateway.recordSkippedUnchanged();
          return;
        }
        if (cached === "infected") {
          findings.push(this.finding(target, file.path, file.sha, "REMOVE_MALWARE", 1));
          files.push({ path: file.path, status: "cached_infected" });
          return;
        }

        const blob = await this.gateway.execute({
          method: "GET",
          endpoint: "GET /repos/{owner}/{repo}/git/blobs/{file_sha}",
          repository,
          dedupeKey: `blob:${file.sha}`,
        }, () => client.request("GET /repos/{owner}/{repo}/git/blobs/{file_sha}", {
          owner: target.owner,
          repo: target.repo,
          file_sha: file.sha,
        }));

        const buffer = Buffer.from(blob.content, "base64");
        if (buffer.includes(0)) {
          files.push({ path: file.path, status: "clean" });
          await this.gateway.setCachedBlobScanResult(file.sha, "clean", "deep");
          return;
        }
        const { matchCount } = removeMalware(buffer.toString("utf8"));
        if (matchCount > 0) {
          findings.push(this.finding(target, file.path, file.sha, "REMOVE_MALWARE", matchCount));
          files.push({ path: file.path, status: "infected" });
          await this.gateway.setCachedBlobScanResult(file.sha, "infected", "deep");
        } else {
          files.push({ path: file.path, status: "clean" });
          await this.gateway.setCachedBlobScanResult(file.sha, "clean", "deep");
        }
      } catch (error) {
        const message = error instanceof GitHubRateLimitError
          ? `GitHub API rate limit exceeded; retry scheduled (${error.retryAfterMs}ms)`
          : error instanceof Error ? error.message : "Unknown GitHub error";
        errors.push({ path: file.path, message });
        files.push({ path: file.path, status: "error" });
      } finally {
        scanned += 1;
        if (scanned === candidates.length || scanned % 5 === 0) {
          onProgress({
            type: "repository:progress",
            repository,
            scanned,
            total: candidates.length,
            findings: findings.length,
            errors: errors.length,
            elapsedMs: Date.now() - startedAt,
            latestFile: file.path,
            mode: "deep",
          });
        }
      }
    });

    return {
      repository,
      branch: target.branch,
      discovered: blobs.length,
      scanned,
      skipped,
      findings,
      errors,
      truncated,
      durationMs: Date.now() - startedAt,
      mode: "deep",
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  async remediateFindings(items: RemediationInput[], token?: string): Promise<RemediationResult> {
    const client = this.gateway.getClient(token);
    const succeeded: string[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    const groups = new Map<string, RemediationInput[]>();

    for (const item of items) {
      const key = `${item.owner}/${item.repo}@${item.branch}`;
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      const { owner, repo, branch } = group[0]!;
      const repository = `${owner}/${repo}`;
      const treeEntries: Array<{ path: string; mode: "100644"; type: "blob"; sha: string | null }> = [];
      const pending: string[] = [];

      for (const item of group) {
        try {
          if (item.action === "REVIEW_DELETE") {
            const content = await this.gateway.execute({
              method: "GET",
              endpoint: "GET /repos/{owner}/{repo}/contents/{path}",
              repository,
              dedupeKey: `content:${repository}:${branch}:${item.path}`,
            }, () => client.request("GET /repos/{owner}/{repo}/contents/{path}", { owner, repo, path: item.path, ref: branch }));
            if (Array.isArray(content)) throw new Error("Path is a directory");
            if (content.sha !== item.blobSha) throw new Error("File changed since scan");
            treeEntries.push({ path: item.path, mode: "100644", type: "blob", sha: null });
          } else {
            const blob = await this.gateway.execute({
              method: "GET",
              endpoint: "GET /repos/{owner}/{repo}/git/blobs/{file_sha}",
              repository,
              dedupeKey: `blob:${item.blobSha}`,
            }, () => client.request("GET /repos/{owner}/{repo}/git/blobs/{file_sha}", { owner, repo, file_sha: item.blobSha }));
            const content = Buffer.from(blob.content, blob.encoding === "base64" ? "base64" : "utf8").toString("utf8");
            const result = cleanInfectedContent(item.path, content);
            if (!result.changed) throw new Error("No malware signature found — file may have changed");
            const newBlob = await this.gateway.execute({
              method: "POST",
              endpoint: "POST /repos/{owner}/{repo}/git/blobs",
              repository,
              retryable: true,
            }, () => client.request("POST /repos/{owner}/{repo}/git/blobs", { owner, repo, content: result.cleaned, encoding: "utf-8" }));
            treeEntries.push({ path: item.path, mode: "100644", type: "blob", sha: newBlob.sha });
          }
          pending.push(item.id);
        } catch (error) {
          failed.push({ id: item.id, message: error instanceof Error ? error.message : "Remediation failed" });
        }
      }

      if (treeEntries.length === 0) continue;

      try {
        const ref = await this.gateway.execute({
          method: "GET",
          endpoint: "GET /repos/{owner}/{repo}/git/ref/{ref}",
          repository,
          dedupeKey: `ref:${repository}:${branch}`,
        }, () => client.request("GET /repos/{owner}/{repo}/git/ref/{ref}", { owner, repo, ref: `heads/${branch}` }));
        const commit = await this.gateway.execute({
          method: "GET",
          endpoint: "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
          repository,
          dedupeKey: `commit:${repository}:${ref.object.sha}`,
        }, () => client.request("GET /repos/{owner}/{repo}/git/commits/{commit_sha}", { owner, repo, commit_sha: ref.object.sha }));
        const tree = await this.gateway.execute({
          method: "POST",
          endpoint: "POST /repos/{owner}/{repo}/git/trees",
          repository,
          retryable: true,
        }, () => client.request("POST /repos/{owner}/{repo}/git/trees", { owner, repo, base_tree: commit.tree.sha, tree: treeEntries }));
        const newCommit = await this.gateway.execute({
          method: "POST",
          endpoint: "POST /repos/{owner}/{repo}/git/commits",
          repository,
          retryable: true,
        }, () => client.request("POST /repos/{owner}/{repo}/git/commits", {
          owner,
          repo,
          message: `chore: remove malware (${treeEntries.length} file${treeEntries.length === 1 ? "" : "s"}) via Bat Remover`,
          tree: tree.sha,
          parents: [commit.sha],
        }));
        await this.gateway.execute({
          method: "PATCH",
          endpoint: "PATCH /repos/{owner}/{repo}/git/refs/{ref}",
          repository,
          retryable: true,
        }, () => client.request("PATCH /repos/{owner}/{repo}/git/refs/{ref}", { owner, repo, ref: `heads/${branch}`, sha: newCommit.sha }));
        succeeded.push(...pending);
        await this.gateway.invalidate(`ref:${repository}:${branch}`);
        await this.gateway.invalidate(`commit-ref:${repository}:${branch}`);
        await this.gateway.invalidate(`tree:${repository}:${commit.tree.sha}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Commit failed";
        for (const id of pending) failed.push({ id, message });
      }
    }

    return { succeeded, failed };
  }

  private finding(target: ScanTargetInput, path: string, sha: string, action: ScanFinding["action"], snippets: number): ScanFinding {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    return {
      id: `${target.owner}/${target.repo}:${target.branch}:${path}:${action}`,
      repository: `${target.owner}/${target.repo}`,
      branch: target.branch,
      path,
      action,
      snippets,
      blobSha: sha,
      htmlUrl: `https://github.com/${target.owner}/${target.repo}/blob/${encodeURIComponent(target.branch)}/${encodedPath}`,
    };
  }
}

export async function mapWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item !== undefined) await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, run));
}
