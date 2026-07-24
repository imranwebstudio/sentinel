# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/scanning-core/package.json packages/scanning-core/package.json
RUN npm ci

FROM deps AS runner
COPY prisma ./prisma
COPY apps/api ./apps/api
COPY packages ./packages
COPY tsconfig.base.json ./tsconfig.base.json

WORKDIR /app/apps/api
# Prisma generate reads DATABASE_URL from prisma.config.ts; a placeholder is enough at build time.
ARG DATABASE_URL=postgresql://malware_remover:malware_remover@postgres:5432/malware_remover?schema=public
ENV DATABASE_URL=$DATABASE_URL
RUN npx prisma generate

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001

EXPOSE 3001

COPY apps/api/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
