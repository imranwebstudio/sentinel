# Bat Remover

Modern replacement for the GitHub malware cleanup proof of concept. The application is being built from the architecture in [MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md).

## Workspace

- `apps/web`: React, TypeScript, Tailwind CSS, Framer Motion, React Router, and TanStack Query.
- `apps/api`: NestJS/Fastify, validated configuration, OpenAPI, and health endpoints.
- `packages/contracts`: shared runtime-validated API contracts.
- `packages/scanning-core`: typed malware detection and scan eligibility rules.
- `prisma`: PostgreSQL schema for tenancy, projects, scans, jobs, findings, audit logs, and outbox events.

## Local development

```bash
cp .env.example .env
docker compose up -d postgres redis
npm install
npm run db:generate
npm run db:migrate -- --name foundation
```

Start the API and frontend together:

```bash
npm run dev
```

Or in separate terminals: `npm run dev:api` and `npm run dev:web`.

Open `http://localhost:5173`. OpenAPI is served at `http://127.0.0.1:3001/api/docs`.

### GitHub OAuth setup

Create or update a GitHub OAuth App with:

- Homepage URL: `http://localhost:5173`
- Authorization callback URL: `http://localhost:3001/api/v1/github/oauth/callback`

Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and a random `SESSION_SECRET` in `.env`. The Projects page then provides the real GitHub connection flow. A `GITHUB_PAT` may be used only as a local development fallback.

## Verification

```bash
npm run typecheck
npm test
npm run build
```
