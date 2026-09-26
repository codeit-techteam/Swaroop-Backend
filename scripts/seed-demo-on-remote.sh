#!/usr/bin/env bash
# Seeds demo users + full catalog (including HD Film SKR) on whatever DATABASE_URL is set.
# DigitalOcean managed Postgres must allow your current public IP in Trusted Sources.
#
# Preferred when you have DB access:
#   export DATABASE_URL='postgresql://doadmin:...@...:25060/defaultdb?sslmode=require'
#   ./scripts/seed-demo-on-remote.sh
#
# If you cannot reach Postgres directly, sync listings through the live API instead:
#   node scripts/sync-catalog-to-remote-api.mjs
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL first (DigitalOcean connection string)."
  echo "Or run: node scripts/sync-catalog-to-remote-api.mjs"
  exit 1
fi
echo "Deploying migrations..."
npx prisma migrate deploy
echo "Seeding master catalog + HD Film SKR + demo users..."
npx tsx prisma/seed.ts
echo "Done."
