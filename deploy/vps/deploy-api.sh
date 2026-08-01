#!/usr/bin/env bash
set -euo pipefail

STACK_DIR="/var/lib/docker/volumes/portainer_portainer_data/_data/compose/10"
cd "$STACK_DIR"
docker compose -p sentinel --env-file stack.env -f docker-compose.yml pull api
# Include dependencies so Compose starts Postgres/Redis when needed and waits
# for their health checks before starting the API.
docker compose -p sentinel --env-file stack.env -f docker-compose.yml up -d --force-recreate api
docker image prune -f
echo "API redeployed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
