#!/usr/bin/env bash
# Seeds demo users (Karan Veer) on whatever DATABASE_URL is in the environment.
# Example:
#   export DATABASE_URL='postgresql://doadmin:...@...:25060/defaultdb?sslmode=require'
#   ./scripts/seed-demo-on-remote.sh
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL first (DigitalOcean connection string)."
  exit 1
fi
exec npx tsx scripts/seed-demo-users.ts
