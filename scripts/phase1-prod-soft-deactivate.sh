#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL to the DigitalOcean connection string (sslmode=require)." >&2
  exit 2
fi
echo "== dry-run =="
node scripts/soft-deactivate-confirmed-test-products.mjs
echo "== apply =="
node scripts/soft-deactivate-confirmed-test-products.mjs --apply
echo "== live API confirm =="
API="${API_BASE:-https://swaroop-backend-xzwkz.ondigitalocean.app/api/v1}"
curl -sS -m 30 "$API/public/marketplace/products?search=E2E%20Bulk&limit=5" | python3 -c "import sys,json;d=json.load(sys.stdin);print('E2E',d.get('meta'),[i.get('name') for i in d.get('data')or[]])"
curl -sS -m 30 "$API/public/marketplace/products?search=HD%20Blow%20Test&limit=5" | python3 -c "import sys,json;d=json.load(sys.stdin);print('HD Blow Test',d.get('meta'),[i.get('name') for i in d.get('data')or[]])"
