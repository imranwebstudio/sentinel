# GitHub Malware Remover: Restructuring and Modernization Plan

Status: proposed target architecture, based on a full review of the repository on 2026-07-21.

## 1. Executive summary

The current product is a small Node.js utility with two entry points: a CLI that scans one GitHub repository and a server-rendered single-page web tool that signs in through GitHub OAuth, lists accessible repositories, scans selected repositories, and commits cleanup changes. It is useful as a proof of concept, but it is not yet a durable multi-user scanning platform.

The recommended replacement is a TypeScript monorepo with a React/Vite frontend, a NestJS API, PostgreSQL through Prisma, Redis/BullMQ queues, dedicated scan workers, and object storage for large exports. The API creates and controls scans; workers perform network-bound GitHub discovery/fetch work and CPU-bound detection work; PostgreSQL is the source of truth; Redis is transient coordination state; Server-Sent Events (SSE) publish durable progress snapshots and live events.

The fastest safe path is an incremental migration, not a big-bang rewrite. First preserve the existing malware detector with characterization tests, then introduce persistence and the queue pipeline behind the existing behavior, then replace the UI, and only afterward add teams, subscriptions, reports, and distributed scaling.

Key decisions:

- Use a GitHub App for production repository access; retain OAuth only for user identity/account linking.
- Use Prisma for type-safe access and migrations, with SQL migrations for partial/advanced indexes.
- Use BullMQ processes for network concurrency. Node worker threads are optional and only useful for CPU-heavy parsers, archives, or advanced rule engines.
- Default to 20 concurrent fetch jobs per worker deployment only after load testing; make concurrency, per-installation budgets, and global limits configurable.
- Use commit/tree/blob SHA values as the basis of incremental scans and deduplication.
- Never allow cleanup solely from mutable in-memory findings. Re-fetch and verify the blob SHA immediately before changing a repository, then create a pull request by default.

## 2. Current application analysis

### Runtime and layout

The repository contains about 2,762 lines of authored application/test/documentation code:

- `src/cleanup.js`: GitHub access, bounded promise concurrency, repository tree discovery, filtering, malware matching, file update/delete, branch and pull-request helpers.
- `src/index.js`: environment-driven single-repository CLI, with direct commit, pull-request, and dry-run modes.
- `src/server.js`: Express server, GitHub OAuth, file-backed sessions, REST/NDJSON endpoints, in-memory scan result cache, static frontend delivery.
- `public/index.html`, `public/app.js`, `public/styles.css`: framework-free dark UI and client state.
- `api/index.js` and `vercel.json`: Vercel adapter/rewrite.
- `test/remove-malware.test.js`: seven Node test-runner tests focused on regex cleanup and file eligibility.
- `scripts/check.js`: syntax checks for the three source files.

There is no TypeScript, build pipeline, database, Redis, durable job processor, observability stack, API schema, lint/format/type check, browser test, or deployment topology beyond the Vercel adapter.

### Existing feature inventory and workflow

1. CLI normalizes repository input, optionally creates a branch, retrieves a recursive Git tree, scans eligible files concurrently, then cleans findings sequentially. It can commit directly, create a PR, or dry-run.
2. Web login uses a GitHub OAuth App with `repo read:org` scopes. The token is stored in the server session and also in a 14-day AES-256-GCM encrypted cookie.
3. The web app lists every repository visible to the authenticated user and supports search, selection, and scan.
4. `/api/scan/stream` streams newline-delimited JSON over a POST response. Repository concurrency defaults to 3 and per-repository file concurrency defaults to 20.
5. Findings are a known obfuscated JavaScript signature and every `.bat` file within eligible paths. Selected findings are committed directly to their current branch.
6. A separate action accepts a GitHub blob URL, removes the matching JavaScript, and commits directly.
7. Results are held in a `Map` keyed by session ID. File sessions persist locally, but scan state does not.
8. The frontend renders repository lists, terminal-like logs, findings, cleanup confirmation, and basic responsive layouts.

### Actual scanner behavior

The scanner first retrieves a recursive tree, then filters it through `isRepositoryMetadataFile`. It scans known configuration filenames, `.github/workflows/**`, and `.bat` files, while excluding source files and directories such as `node_modules`, `dist`, and `.next`. The README statement that it “scans every blob” is therefore inaccurate. This optimization reduces calls but can miss the signature in ordinary source files.

The recursive Git Trees response can be truncated; the current code records a warning but does not fall back to subtree traversal, so a successful-looking scan may be incomplete. Blob downloads are bounded but have no timeout, cancellation, retry/backoff, rate-limit adaptation, or cross-scan cache. Arrays are mutated by concurrent tasks, which is safe under the current single-threaded event loop but yields nondeterministic ordering.

The frontend defines `runBackgroundScan()` but never calls it. Consequently, the visible background terminal does not actually initiate the claimed automatic all-repository scan.

### Current quality baseline

At review time:

- `npm test`: 7/7 tests passed.
- `npm run check`: passed syntax checks.
- The worktree was clean before this document was added.
- Tests do not exercise GitHub API behavior, authentication, HTTP routes, streaming, concurrency, stale SHAs, failures, or the frontend.

## 3. Architectural, correctness, security, and performance problems

### Critical

- Scan findings and cleanup authorization are coupled to mutable, process-local session state. A restart or another instance loses the findings and breaks cleanup.
- Cleanup commits directly to repositories by default in the web flow. There is no approval policy, protected-branch awareness, audit trail, idempotency key, or transactional cleanup record.
- OAuth access tokens are placed in a long-lived client cookie as well as the session. Encryption reduces disclosure risk but still expands the token attack surface and complicates rotation/revocation.
- Request payloads trust client-provided repository owner/name/branch. Authorization is deferred to GitHub rather than checked against an installation/project membership model.
- No CSRF protection is present on state-changing cookie-authenticated endpoints. `SameSite=Lax` helps, but is not a complete application-layer control.
- Any eligible `.bat` file is treated as malicious and deleted, which creates a serious false-positive/destructive-action risk.
- Regex removal can overmatch malformed/adversarial input and is tested against only a few examples. The residual-tail regex removes from a broad `global[...]` pattern to end-of-file.

### Reliability and scalability

- In-memory `scanCache` prevents multi-instance API deployment and durable history.
- File sessions are unsuitable for horizontally scaled/serverless production and cleanup/expiry is operationally fragile.
- Long-running scan work lives inside an HTTP request. Disconnects, function timeouts, deployments, or crashes can abandon work without recovery.
- No job state machine, leases, heartbeat/stall handling, deduplication, durable retries, dead-letter handling, pause/cancel semantics, or graceful shutdown.
- Concurrency is bounded only inside one process. Multiple requests multiply effective concurrency without a global, tenant, installation, or endpoint budget.
- Invalid numeric environment values can produce broken concurrency. Limits have no validated min/max.
- No request timeout or `AbortSignal`; cancellation is checked only between repository starts, not within active GitHub calls.
- Every scan repeats tree/blob calls. No commit-SHA skip, blob-SHA result cache, ETag/conditional request, webhook-driven delta, or request coalescing exists.
- Truncated trees are accepted without complete traversal.
- Result updates are per event and include entire repository results in the stream; there is no event replay or reconnect cursor.
- Cleanup is sequential and partially succeeds without a durable reconciliation record.

### Product and frontend

- One screen mixes repository discovery, scanning, logs, results, direct URL cleanup, and account actions.
- There are no routable pages, durable filters, pagination/virtualization, scan history, comparison, reports, projects, teams, usage, subscriptions, notification preferences, or administration.
- Client state is global mutable JavaScript with large HTML string templates; there is no type safety, component boundary, server-state cache, form schema, or design system.
- Accessibility gaps include limited labels, no skip link, incomplete focus/error management, reliance on color/status text, confirmation via blocking browser dialog, and uncontrolled live-region log volume.
- The list and terminal keep large DOM collections (terminal capped at 1,200 nodes); large accounts will render poorly.
- There is no reduced-motion policy, theme system, skeleton/loading states, or meaningful empty/error recovery UI.

### Operations and engineering

- Errors are returned raw; there is no normalized error contract or correlation ID.
- No structured logging, redaction, metrics, traces, queue dashboard, alerting, health/readiness checks, or SLOs.
- No rate limiting, security headers, CORS policy, secret manager integration, config schema, or environment separation.
- No unit coverage for most code, integration/contract/e2e/load/security tests, CI quality gates, or migration checks.
- README and behavior disagree about scan scope and default file concurrency.

## 4. Target system architecture

```text
Browser (React)
  | HTTPS REST + SSE
  v
NestJS API -------------- PostgreSQL (source of truth)
  |  |                          |
  |  +-- Redis cache            +-- users, teams, projects, scans,
  |      + BullMQ queues            jobs, findings, audit, usage
  |
  +--> scan.discovery queue --> I/O worker processes --> GitHub API
  +--> scan.fetch queue ------> I/O worker processes --> GitHub API
  +--> scan.analyze queue ----> CPU pool if needed
  +--> scan.persist queue ----> batched PostgreSQL writes
  +--> remediation queue ----> branch/commit/PR operations
  +--> report/notify queues --> object storage/email/webhooks
```

Deploy the API and worker processes separately from the same versioned codebase. Redis carries queues, locks, short-lived progress counters, rate-limit state, and cache entries, but PostgreSQL remains authoritative. Queue events are projected to SSE through a Redis pub/sub or stream adapter; clients always fetch a database snapshot first, so missed transient events do not corrupt displayed state.

Start as a modular monolith plus worker processes. NestJS microservices add operational cost and should be introduced only when a bounded domain needs independent deployment or scaling. The queue boundary already supplies suitable decoupling.

## 5. Frontend architecture

Use React, TypeScript, Vite, Tailwind CSS, Framer Motion, React Router, TanStack Query, and React Hook Form with Zod. Use shadcn/ui/Radix primitives for accessible dialogs, menus, tabs, tooltips, selects, and toasts. Keep application/client-only state in Zustand only where URL state or TanStack Query is not appropriate.

Principles:

- Feature-oriented modules; primitives cannot import features.
- OpenAPI-generated request/response types and API client.
- Server state in TanStack Query; filters/sort/page in URL search parameters; only ephemeral UI state locally.
- Route-level code splitting; lazy-load charts, editors, comparison, and report preview.
- Virtualize repository/finding/activity lists and stream aggregated counters rather than one rendered line per file.
- Tailwind tokens via CSS variables for color, spacing, radii, elevation, and light/dark/high-contrast themes.
- Motion only for page transitions, expanding details, progress changes, and feedback. Honor `prefers-reduced-motion` and never animate high-frequency file events.
- WCAG 2.2 AA target: keyboard navigation, visible focus, semantic headings/tables, labels/descriptions, non-color status cues, focus restoration, and tested screen-reader announcements.
- Error boundaries per route, retryable query states, skeletons, empty states, and offline/reconnecting indicators.

## 6. Backend architecture

Use NestJS with Fastify, TypeScript strict mode, Prisma, PostgreSQL, Redis, BullMQ, OpenAPI, Pino, OpenTelemetry, and Prometheus-compatible metrics.

Modules and responsibilities:

- `auth`: OAuth/GitHub App callbacks, secure server-side sessions or short-lived access plus rotating refresh tokens, MFA-ready identity model.
- `users`: profiles, preferences, linked identities.
- `teams`: tenancy, membership, invitations, roles.
- `projects`: repository installation binding, default policy, scan configuration.
- `scans`: create/control/list scans, state machine, progress snapshots.
- `scan-orchestrator`: partitioning, queue publishing, cancellation, finalization.
- `scan-workers`: discovery, fetch, analyze, persistence processors.
- `scan-results`: findings, evidence, suppressions, triage.
- `remediation`: plans, approvals, branches/commits/PRs, stale-SHA validation.
- `reports`: summaries, exports, comparisons, object-storage lifecycle.
- `notifications`: in-app/email/webhook delivery and preferences.
- `subscriptions` and `usage`: plans, quotas, metering, enforcement; payment-provider adapter remains isolated.
- `audit`: immutable actor/action/resource/security events.
- `health`: liveness, readiness, dependency and queue lag checks.
- `admin`: feature flags, worker/queue visibility, retention, rule/version management.

Layer each module as controller/resolver -> application service/use case -> repository/provider interface -> Prisma/GitHub/Redis adapter. DTOs validate transport data and never double as persistence records. Guards handle authentication, tenant membership, role and project policy. Interceptors add correlation IDs, timing, audit context, and response envelopes. Exception filters map domain/provider errors to stable problem-details responses.

## 7. PostgreSQL database design

Use UUIDv7 (or time-ordered UUIDs) for internal IDs, `timestamptz` everywhere, `citext` for normalized email where desired, explicit enums/check constraints for bounded states, and `jsonb` only for variable provider payloads/evidence/config—not core relations or counters.

### Identity and tenancy

| Table | Important columns and constraints |
|---|---|
| `users` | `id PK`, `email UNIQUE`, `display_name`, `avatar_url`, `status`, `last_login_at`, timestamps, `deleted_at` |
| `auth_identities` | `id`, `user_id FK`, `provider`, `provider_subject`, encrypted credential reference, scopes, expiry; `UNIQUE(provider, provider_subject)` |
| `teams` | `id`, `name`, `slug UNIQUE`, `owner_user_id`, `plan_id`, timestamps, `deleted_at` |
| `team_members` | `team_id`, `user_id`, `role`, `status`, invited metadata; `PK(team_id,user_id)` |
| `team_invitations` | token hash, email, role, inviter, expiry, accepted/revoked timestamps |
| `roles`, `permissions`, `role_permissions` | optional custom-role layer; begin with fixed owner/admin/operator/analyst/viewer roles |

### GitHub, projects, and rules

| Table | Important columns and constraints |
|---|---|
| `provider_installations` | team, provider, external installation/account IDs, encrypted secret reference, status; unique provider/external ID |
| `repositories` | installation, external repo ID, owner/name/full name, default branch, visibility, archived, permissions JSONB, pushed timestamp; unique provider/external repo ID |
| `projects` | team, name, slug, settings JSONB, retention days, status, soft delete; unique active team/slug |
| `project_repositories` | project/repository, enabled, branch patterns, scan policy; composite PK |
| `scan_rules` | stable key, name, category, severity, matcher type, version, compiled definition/checksum, enabled |
| `project_rule_settings` | project/rule, enabled, severity override, config JSONB; composite unique |
| `suppressions` | project, rule/fingerprint/path scope, reason, creator, expiry; indexed active scope |

### Scans, jobs, and results

| Table | Important columns and constraints |
|---|---|
| `scans` | team/project, creator, mode, status, priority, source, requested config JSONB, rule-set checksum, baseline scan, total/discovered/waiting/active/completed/failed/retried/skipped counters, progress basis points, requested/started/completed/cancelled timestamps, version |
| `scan_targets` | scan/repository/branch, head/tree SHA, previous SHA, status and counters; `UNIQUE(scan_id, repository_id, branch)` |
| `scan_jobs` | scan target, queue, kind, stable job key, status, priority, attempt/max attempts, lease/worker, timing, error code/message; `UNIQUE(scan_id, job_key)` |
| `scan_files` | scan target, path, blob SHA, size, media type, content hash, disposition, analyzed rule-set checksum, timing; `UNIQUE(scan_target_id,path)` and index on blob SHA |
| `findings` | scan, target, file, rule, deterministic fingerprint, severity/category/status, title, summary, line range, evidence JSONB, first/last seen scan, timestamps; `UNIQUE(scan_id,fingerprint)` |
| `finding_occurrences` | finding/file, location/evidence; supports multiple matches without duplicating the logical finding |
| `finding_triage` | finding, status, assignee, reason, actor, timestamp; append-only history |
| `scan_events` | scan, monotonically increasing sequence, event type, payload JSONB, timestamp; `UNIQUE(scan_id,sequence)` for SSE replay |
| `scan_summaries` | scan PK/FK, severity/category counts JSONB, duration/cost/rate-limit metrics, generated timestamp |

### Remediation, reporting, and operations

| Table | Important columns and constraints |
|---|---|
| `remediation_runs` | team/project/scan, mode (`pull_request` default), status, requester/approver, branch/PR metadata, timestamps |
| `remediation_items` | run/finding, expected blob SHA, action, status, resulting commit SHA, error; unique run/finding |
| `reports` | scan, format, status, object key, checksum, size, expiry, creator |
| `notifications` | user/team, type, payload, state, delivery timestamps, dedupe key unique where present |
| `notification_preferences` | user/team/channel/type and enabled/config |
| `plans`, `subscriptions` | provider IDs, status, limits JSONB, billing periods |
| `usage_ledger` | team, metric, quantity, scan, occurred/billing period; unique idempotency key |
| `audit_logs` | team, actor, action, resource type/id, outcome, IP/user agent, correlation ID, before/after JSONB, timestamp; append-only and time-partitionable |
| `outbox_events` | aggregate/type/payload, created/published/attempt fields; transactional event publication |
| `webhook_deliveries` | provider delivery ID unique, event/action, signature status, payload reference/hash, processing status |

### Indexing and query rules

- B-tree indexes: all foreign keys; `(team_id, created_at DESC)` on projects/scans/audit; `(scan_id,status)` on jobs/findings; `(project_id,status,severity,created_at DESC)` on findings; `(repository_id,branch,completed_at DESC)` on targets.
- Partial indexes: active jobs, unresolved findings, active memberships, non-deleted projects, unpublished outbox rows.
- Unique indexes: provider IDs, stable job keys, finding fingerprints, webhook delivery IDs, usage/remediation idempotency keys.
- GIN indexes only on measured JSONB containment paths; do not indiscriminately index full evidence payloads. Use generated/scalar columns for frequently filtered JSON properties.
- Cursor pagination using `(created_at,id)` or severity/status-specific stable keys; never deep `OFFSET` for large histories.
- Batch file/findings writes with `createMany`/COPY/upsert chunks (initial target 250–1,000 rows, benchmarked), update progress counters at intervals rather than per file.
- Optimistic concurrency via `version` on scans/remediation. Use transactions for state transitions and outbox publication.
- Partition high-volume `scan_events`, `audit_logs`, and optionally old `findings` monthly once volume warrants it.
- Retention defaults: detailed clean-file records 30 days, scan summaries/findings 365 days, reports 30 days, audit logs per plan/compliance policy. Run chunked purge/anonymization jobs; never one huge delete.
- Use PgBouncer transaction pooling. Budget total connections across API and all worker replicas, reserving capacity for migrations/operations.

## 8. High-performance scanning pipeline

### State flow

```text
REQUESTED -> QUEUED -> DISCOVERING -> SCANNING -> AGGREGATING -> COMPLETED
                               |             |
                               +-> PAUSING/PAUSED
                               +-> CANCELLING/CANCELLED
Any active stage -> FAILED (after bounded recovery)
```

1. `POST /scans` validates membership, project policy, quota, and repository installation access. An idempotency key prevents duplicate requests.
2. In one transaction, create the scan/targets plus outbox event. A relay adds one discovery job per target.
3. Discovery obtains the branch head/tree SHA. If the same rule-set checksum and tree SHA already completed, reuse the prior result. If a prior commit exists, compare trees and enqueue only added/modified paths; record deleted paths for resolution.
4. Traverse subtrees when GitHub marks a recursive tree truncated. Apply explicit include/exclude rules, maximum file size, supported media types, and symlink/submodule policy.
5. Create fetch/analyze jobs with deterministic IDs such as `scan:{scanId}:blob:{blobSha}:rules:{ruleSetHash}`. Redis job deduplication plus the PostgreSQL unique job key makes enqueue/processing effectively idempotent.
6. A per-installation request scheduler grants tokens to fetch workers. Fetch jobs use timeouts, abort signals, conditional requests where applicable, response rate-limit headers, and single-flight request coalescing.
7. Cache analysis by `(provider, blob_sha, rule_set_checksum)`. Blob SHA is content-addressed, so identical content across paths/repos can reuse safe results while occurrences retain path context.
8. Analyze small text in the I/O worker. Send only measured CPU-heavy work to a bounded Piscina/worker-thread pool; avoid serializing large buffers repeatedly.
9. Persist file dispositions/findings in batches and atomically increment counters. Publish throttled progress (for example at most 4 updates/second/scan) rather than a database/event write per file.
10. A finalizer runs only when no waiting/active jobs remain, verifies counters, writes summary/usage, resolves prior findings absent from the new scan, and marks the scan complete.

### What “20 workers” should mean

Do not hardcode twenty OS threads. Expose separate controls:

```text
SCAN_WORKER_REPLICAS=2
DISCOVERY_CONCURRENCY=4
FETCH_CONCURRENCY=20
ANALYZE_THREAD_COUNT=2
PERSIST_BATCH_SIZE=500
GLOBAL_FETCH_CONCURRENCY=40
INSTALLATION_FETCH_CONCURRENCY=8
REPOSITORY_FETCH_CONCURRENCY=4
MAX_IN_FLIGHT_BYTES=134217728
```

BullMQ `concurrency` provides async jobs per worker process; replicas provide horizontal capacity. Effective concurrency is the minimum allowed by global, installation, repository, memory, database, and adaptive rate-limit budgets. Start at 5, benchmark 10 and 20, then raise only where throughput improves without increased throttling/error/latency.

### Backpressure, retry, and safety

- Track in-flight byte estimates and pause fetching before memory pressure, not merely by job count.
- Separate queues: `scan.discovery`, `scan.fetch`, `scan.analyze`, `scan.persist`, `scan.finalize`, `remediation`, `report`, `notification`; independent concurrency and priority prevent exports from starving active scans.
- Priorities: interactive scans > scheduled scans > backfills; add per-tenant fair scheduling so one team cannot monopolize workers.
- Retry transient network/5xx/429 errors with full-jitter exponential backoff, respecting `Retry-After` and GitHub reset headers. Do not retry 400/401/404 or deterministic rule errors. Cap attempts and send exhausted jobs to a failed-job review flow.
- Circuit-break per GitHub installation/provider endpoint. Reduce concurrency on secondary-limit or rising latency signals; slowly recover after a quiet window.
- Every processor is idempotent. Acquire a job lease, heartbeat, write through unique keys/upserts, and acknowledge only after persistence.
- Pause stops dispatching new jobs; active jobs checkpoint/finish. Cancel sets a durable flag, removes waiting jobs in chunks, aborts active provider calls, and finalizes as cancelled.
- Graceful shutdown marks readiness false, stops intake, waits a bounded period for active jobs, then lets BullMQ recover stalled leases.
- Remediation revalidates installation permission, branch protection, expected SHA and current rule match. Prefer one branch/PR per repository; batch file changes through Git data APIs where practical. Never delete `.bat` solely by extension without a rule/policy and review.

### Progress model

Persist and expose: discovered total, waiting, active, completed, failed, retried, skipped duplicate/cache hit, bytes fetched, current effective worker count, percent, ETA confidence, start/end, and rate-limit/backoff state. Early discovery makes the denominator change, so label progress as “discovering” until stable. Compute scan percentage from weighted stages (for example discovery 5%, fetch/analyze 85%, persistence/finalization 10%) and never show a false 100% before finalization.

SSE is recommended over WebSockets because progress is primarily server-to-client, works naturally with HTTP auth/proxies, and supports `Last-Event-ID`. Control actions remain REST. Store bounded scan events for replay; on reconnect, return events after the cursor or instruct the client to refresh the snapshot.

## 9. Recommended monorepo folder structure

```text
apps/
  web/src/
    app/                 # providers, router, query client, error boundaries
    pages/               # route entry components
    layouts/
    components/ui/       # design-system primitives
    features/            # auth, projects, scans, findings, reports, teams...
    hooks/
    api/                 # generated client and query keys
    state/               # ephemeral client state only
    types/
    lib/                 # utilities, permissions, formatting
    constants/
    animations/
    validation/
  api/src/
    main.ts
    common/              # guards, filters, interceptors, decorators, pipes
    config/
    modules/             # domain modules listed in section 6
    infrastructure/      # Prisma, Redis, GitHub, storage, telemetry adapters
  worker/src/
    main.ts
    processors/
    schedulers/
    rate-limit/
    shutdown/
packages/
  contracts/             # generated OpenAPI types or shared transport contracts
  scanning-core/         # pure detectors, normalization, fingerprints
  config/                # typed env schemas
  eslint-config/
  tsconfig/
prisma/
  schema.prisma
  migrations/
  seed.ts
infra/
  docker/
  compose/
  kubernetes/ or terraform/
docs/
  adr/
  runbooks/
  api/
```

Keep domain entities independent of Nest/Prisma where useful, but avoid ceremonial abstraction. Share contracts and pure scanning logic; do not share database models with the browser.

## 10. Redesigned user flow

1. User signs in, creates or joins a team, and installs the GitHub App on chosen repositories.
2. Onboarding creates a project, selects repositories/branches, chooses a recommended scan policy, and optionally schedules recurring scans.
3. “New scan” shows targets, rule pack, include/exclude patterns, incremental/full choice, priority, and estimated quota impact. A review step makes remediation policy explicit.
4. The active scan view opens immediately after creation. Summary counters, stage, ETA, target breakdown, queue/rate-limit notices, and a compact activity feed update through SSE. Pause/cancel buttons explain their semantics.
5. Completion routes to findings. Users filter by severity, category, repository, rule, path, status, and new/resolved state; bulk actions require scoped selection and confirmation.
6. Finding detail shows evidence, why it matched, history, source link, suppression/assignment controls, and proposed remediation diff.
7. Remediation creates a plan, validates current SHAs, requests approval when policy requires it, and opens PRs by default. Users see per-item outcomes and can retry only failed items.
8. Scan comparison highlights new, persistent, resolved, and severity-changed findings. Reports can be downloaded or shared using expiring links.

## 11. Page-by-page frontend plan

| Route/page | Purpose and principal components |
|---|---|
| `/login` | Product value, GitHub sign-in, privacy/scope explanation, auth errors |
| `/onboarding` | Team creation, GitHub App installation, repository picker, first project/policy |
| `/dashboard` | Risk summary, active scans, recent findings, trend chart, quota, quick scan |
| `/projects` | Searchable project cards/table, health, last scan, schedules |
| `/projects/:id` | Overview, repositories, policies, schedules, members, recent scans |
| `/scans/new` | Validated multi-step configuration and review |
| `/scans` | Cursor-paginated history, saved filters, statuses, initiator, duration |
| `/scans/:id/live` | Stage/progress cards, per-target table, throughput chart, warnings, pause/cancel, accessible activity feed |
| `/scans/:id/findings` | Summary cards, severity/category charts, virtualized filterable results, bulk triage/export/remediate |
| `/findings/:id` | Evidence/source, rule explanation, occurrences, timeline, assignment/suppression, remediation preview |
| `/scans/compare` | Baseline/current selectors; new, persistent, resolved deltas |
| `/remediations/:id` | Approval/status, repository PR links, per-file results and retry |
| `/reports` | Export jobs, format/status/expiry, download and regenerate |
| `/team/members` | Members, invitations, roles and access review |
| `/usage` | Current plan, scan/file/API usage, limits, forecast and billing link |
| `/settings/account` | Profile, sessions, notifications, linked GitHub identity |
| `/settings/team` | Team details, retention, integrations, API/webhooks |
| `/admin` | Queue health, workers, failures, rule versions, audit lookup, feature flags; admin only |

Mobile uses a compact top bar/bottom navigation for core routes, drawers for filters, responsive cards instead of wide tables, and sticky safe-area-aware primary actions. Desktop uses a collapsible sidebar and command/search palette.

## 12. API recommendations

Prefix REST endpoints with `/api/v1`; publish OpenAPI and generate the frontend client. Use problem-details errors, cursor pagination, `Idempotency-Key` for creation/remediation, `ETag` for cacheable reads, correlation IDs, and consistent authorization at team/project resource boundaries.

### Identity, teams, and projects

```text
GET    /auth/github/start
GET    /auth/github/callback
POST   /auth/refresh
POST   /auth/logout
GET    /me
GET    /teams
POST   /teams
GET    /teams/:teamId/members
POST   /teams/:teamId/invitations
PATCH  /teams/:teamId/members/:userId
GET    /github/installations
POST   /github/installations/sync
GET    /repositories?installationId=&cursor=&query=
GET    /projects
POST   /projects
GET    /projects/:projectId
PATCH  /projects/:projectId
PUT    /projects/:projectId/repositories
PUT    /projects/:projectId/policy
```

### Scans and findings

```text
POST   /projects/:projectId/scans
GET    /projects/:projectId/scans?cursor=&status=
GET    /scans/:scanId
GET    /scans/:scanId/progress
GET    /scans/:scanId/events                 # SSE, supports Last-Event-ID
POST   /scans/:scanId/pause
POST   /scans/:scanId/resume
POST   /scans/:scanId/cancel
POST   /scans/:scanId/retry-failed
GET    /scans/:scanId/findings?cursor=&severity=&status=&query=
GET    /findings/:findingId
PATCH  /findings/:findingId/triage
POST   /findings/:findingId/suppressions
GET    /scans/compare?base=&current=
```

### Remediation, reports, operations

```text
POST   /scans/:scanId/remediations
GET    /remediations/:runId
POST   /remediations/:runId/approve
POST   /remediations/:runId/cancel
POST   /remediations/:runId/retry-failed
POST   /scans/:scanId/reports
GET    /reports/:reportId
GET    /reports/:reportId/download           # short-lived signed URL
GET    /usage
GET    /audit-logs
POST   /webhooks/github                      # signed provider webhook
GET    /health/live
GET    /health/ready
GET    /health/dependencies                  # protected
```

Do not expose raw queue operations publicly. Admin actions call application services with audit and policy checks.

## 13. Security recommendations

- Prefer a GitHub App with least-privilege repository metadata/contents permissions and short-lived installation tokens. Request write permission only when remediation is enabled.
- Store provider secrets/tokens server-side in a managed secret/KMS system; envelope-encrypt persisted credentials; never put access tokens in browser-readable or application cookies.
- Use opaque, rotated server-side sessions in Redis/PostgreSQL or short-lived access tokens with rotating, reuse-detected refresh tokens. Secure, HttpOnly, SameSite cookies; regenerate sessions after login/role changes.
- Validate OAuth state and add PKCE where supported; bind callback intent to the session; sanitize return URLs.
- Add CSRF tokens/origin checks for cookie-authenticated mutations, Helmet/CSP/HSTS/referrer/permissions policies, strict body limits, and narrow CORS.
- Validate all DTOs with allowlists and reject unknown fields. Canonicalize repository/path/branch input and protect against URL parser confusion/SSRF; only provider adapters may make outbound calls to allowlisted hosts.
- Enforce RBAC plus resource ownership in guards and again in sensitive use cases. Suggested roles: owner, admin, operator, analyst, viewer, billing.
- Rate-limit by IP for auth/anonymous endpoints and by user/team/installation for API/scans. Quotas are durable and cannot rely solely on Redis.
- Require explicit remediation plans, least privilege, optional dual approval, protected-branch detection, expected-SHA checks, default PR mode, diff preview, and immutable audit entries.
- Treat detector output as untrusted. Bound file size/decompression ratio/time, scan in isolated workers, escape evidence, and never execute repository content.
- Redact tokens, source content, cookies, authorization headers, and sensitive evidence from logs/traces. Define retention and deletion workflows.
- Sign and verify GitHub webhooks, dedupe delivery IDs, rotate webhook secrets, and store only needed payload fields.
- Dependency/SBOM/secret/SAST/container scanning, pinned lockfiles, signed images, non-root containers, read-only filesystem, network egress rules, and routine restore/key-rotation exercises.

## 14. Performance, scalability, and observability

Target initial SLOs after baseline measurement: API reads p95 under 300 ms excluding provider calls, scan enqueue under 500 ms, progress freshness under 2 s, no lost acknowledged jobs, and 99.9% control-plane availability. Scan duration depends on GitHub quotas/content and should be expressed as files/bytes per second plus queue wait.

- Cache repository metadata briefly and immutable blob analysis by SHA/rule version longer. Never cache authorization decisions beyond a short, invalidatable window.
- Use read replicas only after query evidence; first fix indexes, N+1 queries, payload selection, and batching.
- Scale API on request latency/CPU, I/O workers on queue lag and rate budget, CPU workers on CPU/queue lag—not all by one replica count.
- Instrument queue waiting/active duration, jobs/sec, retries/failures/stalls, provider latency/status/rate remaining, bytes/sec, cache hit ratio, database pool wait/query duration, event lag, memory/event-loop lag, scan duration, and remediation outcomes.
- Structured Pino logs carry request/scan/job/team correlation IDs. OpenTelemetry traces connect API -> queue producer -> worker -> GitHub/DB. Sample routine file spans, retain errors/slow traces.
- Dashboards and alerts: queue oldest age, dead jobs, scan stuck state, GitHub 429/403 spikes, DB saturation, Redis memory/evictions, SSE disconnects, remediation failure, SLO burn.
- Docker Compose supplies local PostgreSQL/Redis/object storage. Production uses immutable separate API/worker images, readiness/liveness/startup probes, disruption budgets, rolling/canary deploys, backups/PITR, and tested rollback.
- Load-test synthetic repositories and mocked GitHub latency/rate responses. Run stepped tests at 5/10/20/40 fetch concurrency; select the knee of the throughput curve and verify memory/DB/rate budgets.

## 15. Migration plan

Use a strangler migration with feature flags and parallel validation:

1. Freeze and characterize: document the actual metadata-only scope, add fixtures for known/near-miss malware, truncated trees, binary/large files, and stale SHAs. Version the detector and calculate stable fingerprints.
2. Establish the monorepo/toolchain: strict TypeScript, lint/format, contracts, CI, Docker Compose, config validation, secrets placeholders. Move the current pure detection functions into `packages/scanning-core` without semantic change.
3. Add PostgreSQL and identity/installation/project records. Import no sensitive token from cookies; require users to reconnect/install the GitHub App. Keep the old UI temporarily.
4. Introduce scan persistence and an outbox, then BullMQ discovery/fetch workers. Initially shadow-run against selected repositories and compare old/new counts without remediation.
5. Add SHA/rule-version caching, complete truncated-tree traversal, delta scanning, adaptive limits, batching, cancellation, and SSE replay. Prove no-loss/idempotency with fault injection.
6. Launch the React dashboard for internal users behind a flag. Preserve CLI access through the new API or a shared scanning-core fallback; do not silently remove CLI workflows.
7. Move cleanup to remediation plans and PR-by-default. Disable the old direct cleanup endpoint after an announced compatibility period.
8. Add history, comparison, exports, teams/RBAC, audit, notifications, subscriptions/usage, and admin operations.
9. Canary production traffic, monitor parity/SLOs, migrate retained scan summaries if valuable, then remove Express/file sessions/in-memory cache/Vercel long-request architecture.

Data migration is mostly additive because the current app has no scan database. Existing file sessions and in-memory results should expire, not be migrated. Preserve configuration mapping and provide a one-time tool to create a project from the CLI repository environment variables without printing its token.

## 16. Phased implementation roadmap

### Phase 0 — discovery and safety baseline (1–2 weeks)

- Confirm product meaning of “scan all files” versus metadata-only and define allowed `.bat` policy.
- Benchmark current API calls, duration, throttling, memory, and findings on representative repositories.
- Expand detector tests and threat model; resolve destructive false positives before scale work.
- Write architecture decision records for GitHub App, Prisma, BullMQ, SSE, retention, and tenancy.

Exit: agreed scope, reproducible baseline, detector compatibility corpus, prioritized risks.

### Phase 1 — platform foundation (2–3 weeks)

- Monorepo, TypeScript, NestJS/Fastify, React shell/design tokens, PostgreSQL/Prisma, Redis, local Docker.
- Config validation, auth/team/project skeleton, OpenAPI, CI, logging/tracing/health.

Exit: deployable control plane with migrations, GitHub App connection, and quality gates.

### Phase 2 — durable high-speed scanner MVP (3–5 weeks)

- Scan state machine, outbox, queues/workers, complete discovery, batching, deterministic jobs/findings.
- Rate-aware 5/10/20 configurable concurrency, retries/DLQ, cancellation, graceful shutdown.
- SSE progress, active-scan page, persisted results/history.

Exit: fault- and load-tested scans survive restart and scale horizontally with no duplicate findings/lost jobs.

### Phase 3 — safe remediation and polished product (3–4 weeks)

- Findings workflow, evidence/diff, triage/suppression, PR remediation/approval/audit.
- Responsive dashboard, projects, filters, virtualized tables, accessibility and reduced motion.

Exit: internal production launch with WCAG checks and rollback-ready remediation.

### Phase 4 — optimization and product breadth (3–5 weeks)

- Webhook/delta scans, blob cache, comparisons, reports, schedules, notifications.
- Teams/RBAC completion, usage/subscription limits, admin and queue operations.

Exit: measured improvement versus baseline and retention/billing correctness.

### Phase 5 — scale and hardening (ongoing)

- Horizontal autoscaling, partitioning when justified, chaos/fault tests, SLO alerts, DR drills, penetration test, cost tuning.

## 17. Testing and deployment strategy

Testing pyramid:

- Unit/property/fuzz tests: detector boundaries, normalization, fingerprints, state transitions, authorization policies, rate/adaptive algorithms, progress invariants.
- Integration tests with Testcontainers: Prisma/PostgreSQL constraints and migrations, BullMQ/Redis idempotency/stalls/retries, outbox relay, batch writes.
- GitHub adapter contract tests against recorded/sanitized fixtures or a controllable mock: pagination, truncated trees, 401/403/404/409/422/429/5xx, rate headers, stale SHAs, webhooks.
- API tests: auth/CSRF/RBAC/tenant isolation, validation/problem details, idempotency, pagination, SSE replay/reconnect.
- Frontend component/accessibility tests with Testing Library and axe; verify keyboard/focus/reduced motion and large-list behavior.
- Playwright e2e: onboarding, new/live/pause/resume/cancel scan, filters/triage, approval/remediation, report, role denial.
- Load/soak tests: multiple tenants and large synthetic trees, controlled GitHub latency/rate limits, worker crash/redeploy, Redis/DB interruption, memory ceilings and queue recovery.
- Security tests: dependency/SAST/secret/container scans, webhook signatures, SSRF/path payloads, token redaction, authorization matrix, remediation race/stale-SHA cases.

CI gates every change on formatting, lint, type-check, unit/integration tests, schema validation, migration drift, production build, dependency/license policy, and container scan. Preview environments use isolated databases and mocked/provider test installations.

Deployment order: backward-compatible database migration -> API -> workers -> web -> feature enablement. Workers must understand both current and previous job payload versions during rolling deployment. Use expand/migrate/contract schema changes; take PITR-capable backups; run smoke and synthetic scan checks; canary by team; maintain one-click application rollback while never rolling back a destructive schema migration.

## 18. Acceptance criteria

The modernization is complete when:

- Scans and progress survive API/worker restarts and reconnect correctly.
- Repeated scan requests/jobs are idempotent; duplicate work/results are measurably skipped.
- Full scans handle truncated trees, while incremental scans inspect only changed content when valid.
- Configured 5/10/20 worker tests show controlled scaling without exceeding memory, DB pool, or provider budgets.
- No acknowledged job is silently lost; exhausted jobs are visible and retryable.
- Cleanup/remediation checks the current SHA, is audited, honors permissions/policies, and uses PRs by default.
- All 16 requested product/technical areas are represented in shipped features or explicitly feature-flagged roadmap scope.
- CI, observability, runbooks, backup restore, graceful shutdown, load testing, accessibility, and security controls pass their release gates.

