#!/bin/sh
# Container entrypoint: apply pending Prisma migrations, then start the API.
# A failed migration exits non-zero so the platform keeps the previous release live.
# Prisma takes a Postgres advisory lock, so concurrent instances migrate safely.
set -e

if [ "${SKIP_DB_MIGRATIONS:-false}" != "true" ]; then
  echo "Applying database migrations..."
  ./node_modules/.bin/prisma migrate deploy
fi

exec node dist/main.js
