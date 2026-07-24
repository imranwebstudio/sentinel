-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'ANALYST', 'VIEWER', 'BILLING');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ScanMode" AS ENUM ('FULL', 'INCREMENTAL');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('REQUESTED', 'QUEUED', 'DISCOVERING', 'SCANNING', 'AGGREGATING', 'PAUSING', 'PAUSED', 'CANCELLING', 'CANCELLED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('WAITING', 'ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED', 'FALSE_POSITIVE');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RuntimeScanMode" AS ENUM ('FAST', 'DEEP');

-- CreateEnum
CREATE TYPE "RuntimeScanStatus" AS ENUM ('COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HistoryFindingStatus" AS ENUM ('OPEN', 'REMEDIATED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "scopes" TEXT[],
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "TeamRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("team_id","user_id")
);

-- CreateTable
CREATE TABLE "provider_installations" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "account_login" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "provider_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "pushed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "retention_days" INTEGER NOT NULL DEFAULT 365,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_repositories" (
    "project_id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "branch_patterns" TEXT[],
    "scan_policy" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "project_repositories_pkey" PRIMARY KEY ("project_id","repository_id")
);

-- CreateTable
CREATE TABLE "scans" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "mode" "ScanMode" NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'REQUESTED',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "rule_set_checksum" TEXT NOT NULL,
    "discovered" INTEGER NOT NULL DEFAULT 0,
    "waiting" INTEGER NOT NULL DEFAULT 0,
    "active" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "retried" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "progress_basis_points" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_targets" (
    "id" UUID NOT NULL,
    "scan_id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "branch" TEXT NOT NULL,
    "head_sha" TEXT,
    "tree_sha" TEXT,
    "previous_sha" TEXT,
    "status" "ScanStatus" NOT NULL DEFAULT 'REQUESTED',

    CONSTRAINT "scan_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_jobs" (
    "id" UUID NOT NULL,
    "scan_id" UUID NOT NULL,
    "scan_target_id" UUID,
    "queue" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "job_key" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'WAITING',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "worker_id" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "scan_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_files" (
    "id" UUID NOT NULL,
    "scan_target_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "blob_sha" TEXT NOT NULL,
    "size" INTEGER,
    "media_type" TEXT,
    "disposition" TEXT NOT NULL,
    "rule_set_checksum" TEXT NOT NULL,
    "analyzed_at" TIMESTAMPTZ,

    CONSTRAINT "scan_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" UUID NOT NULL,
    "scan_id" UUID NOT NULL,
    "scan_file_id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "category" TEXT NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_events" (
    "id" BIGSERIAL NOT NULL,
    "scan_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "team_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "outcome" TEXT NOT NULL,
    "correlation_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" BIGSERIAL NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_histories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "github_login" TEXT NOT NULL,
    "mode" "RuntimeScanMode" NOT NULL,
    "status" "RuntimeScanStatus" NOT NULL,
    "repository_count" INTEGER NOT NULL,
    "completed_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "findings_count" INTEGER NOT NULL DEFAULT 0,
    "open_findings_count" INTEGER NOT NULL DEFAULT 0,
    "files_scanned" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "started_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_history_repositories" (
    "id" UUID NOT NULL,
    "scan_history_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "findings_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "result" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "scan_history_repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_history_findings" (
    "id" UUID NOT NULL,
    "scan_history_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "snippets" INTEGER NOT NULL DEFAULT 0,
    "blob_sha" TEXT NOT NULL,
    "html_url" TEXT NOT NULL,
    "status" "HistoryFindingStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "scan_history_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_provider_subject_key" ON "auth_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "teams_slug_key" ON "teams"("slug");

-- CreateIndex
CREATE INDEX "team_members_user_id_idx" ON "team_members"("user_id");

-- CreateIndex
CREATE INDEX "provider_installations_team_id_idx" ON "provider_installations"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_installations_provider_external_id_key" ON "provider_installations"("provider", "external_id");

-- CreateIndex
CREATE INDEX "repositories_installation_id_full_name_idx" ON "repositories"("installation_id", "full_name");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_installation_id_external_id_key" ON "repositories"("installation_id", "external_id");

-- CreateIndex
CREATE INDEX "projects_team_id_created_at_idx" ON "projects"("team_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "projects_team_id_slug_key" ON "projects"("team_id", "slug");

-- CreateIndex
CREATE INDEX "project_repositories_repository_id_idx" ON "project_repositories"("repository_id");

-- CreateIndex
CREATE INDEX "scans_team_id_requested_at_idx" ON "scans"("team_id", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "scans_project_id_status_requested_at_idx" ON "scans"("project_id", "status", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "scan_targets_repository_id_branch_idx" ON "scan_targets"("repository_id", "branch");

-- CreateIndex
CREATE UNIQUE INDEX "scan_targets_scan_id_repository_id_branch_key" ON "scan_targets"("scan_id", "repository_id", "branch");

-- CreateIndex
CREATE INDEX "scan_jobs_scan_id_status_idx" ON "scan_jobs"("scan_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scan_jobs_scan_id_job_key_key" ON "scan_jobs"("scan_id", "job_key");

-- CreateIndex
CREATE INDEX "scan_files_blob_sha_rule_set_checksum_idx" ON "scan_files"("blob_sha", "rule_set_checksum");

-- CreateIndex
CREATE UNIQUE INDEX "scan_files_scan_target_id_path_key" ON "scan_files"("scan_target_id", "path");

-- CreateIndex
CREATE INDEX "findings_scan_id_status_severity_idx" ON "findings"("scan_id", "status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "findings_scan_id_fingerprint_key" ON "findings"("scan_id", "fingerprint");

-- CreateIndex
CREATE INDEX "scan_events_scan_id_created_at_idx" ON "scan_events"("scan_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "scan_events_scan_id_sequence_key" ON "scan_events"("scan_id", "sequence");

-- CreateIndex
CREATE INDEX "audit_logs_team_id_created_at_idx" ON "audit_logs"("team_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "outbox_events_published_at_created_at_idx" ON "outbox_events"("published_at", "created_at");

-- CreateIndex
CREATE INDEX "scan_histories_user_id_started_at_idx" ON "scan_histories"("user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "scan_histories_github_login_started_at_idx" ON "scan_histories"("github_login", "started_at" DESC);

-- CreateIndex
CREATE INDEX "scan_history_repositories_scan_history_id_idx" ON "scan_history_repositories"("scan_history_id");

-- CreateIndex
CREATE INDEX "scan_history_repositories_full_name_idx" ON "scan_history_repositories"("full_name");

-- CreateIndex
CREATE INDEX "scan_history_findings_scan_history_id_status_idx" ON "scan_history_findings"("scan_history_id", "status");

-- CreateIndex
CREATE INDEX "scan_history_findings_repository_status_idx" ON "scan_history_findings"("repository", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scan_history_findings_scan_history_id_external_id_key" ON "scan_history_findings"("scan_history_id", "external_id");

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_installations" ADD CONSTRAINT "provider_installations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "provider_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_repositories" ADD CONSTRAINT "project_repositories_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_targets" ADD CONSTRAINT "scan_targets_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_targets" ADD CONSTRAINT "scan_targets_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_scan_target_id_fkey" FOREIGN KEY ("scan_target_id") REFERENCES "scan_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_files" ADD CONSTRAINT "scan_files_scan_target_id_fkey" FOREIGN KEY ("scan_target_id") REFERENCES "scan_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_scan_file_id_fkey" FOREIGN KEY ("scan_file_id") REFERENCES "scan_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_histories" ADD CONSTRAINT "scan_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_history_repositories" ADD CONSTRAINT "scan_history_repositories_scan_history_id_fkey" FOREIGN KEY ("scan_history_id") REFERENCES "scan_histories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_history_findings" ADD CONSTRAINT "scan_history_findings_scan_history_id_fkey" FOREIGN KEY ("scan_history_id") REFERENCES "scan_histories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
