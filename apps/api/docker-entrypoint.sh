#!/bin/sh
set -eu

cd /app/apps/api

echo "Running Prisma migrations..."
migration_attempt=1
migration_max_attempts="${DATABASE_MIGRATION_MAX_ATTEMPTS:-15}"
migration_retry_seconds="${DATABASE_MIGRATION_RETRY_SECONDS:-4}"

until npx prisma migrate deploy; do
  if [ "$migration_attempt" -ge "$migration_max_attempts" ]; then
    echo "Prisma migrations failed after ${migration_attempt} attempts; exiting."
    exit 1
  fi

  echo "Database is not ready; retrying Prisma migrations in ${migration_retry_seconds}s (${migration_attempt}/${migration_max_attempts})..."
  migration_attempt=$((migration_attempt + 1))
  sleep "$migration_retry_seconds"
done

echo "Starting API on ${API_HOST:-0.0.0.0}:${API_PORT:-3001}..."
exec node dist/main.js
