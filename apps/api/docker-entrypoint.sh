#!/bin/sh
set -eu

cd /app/apps/api

echo "Running Prisma migrations..."
npx prisma migrate deploy

echo "Starting API on ${API_HOST:-0.0.0.0}:${API_PORT:-3001}..."
exec node dist/main.js
