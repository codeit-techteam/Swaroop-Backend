# Confirmed test-product cleanup runbook

**Date:** 14 Nov 2026  
**Targets (exact name match only):**

| Product ID | Code | Name |
|---|---|---|
| `97625de6-82b0-4b3a-97f3-f2410b500011` | `E2E-BULK-14198` | E2E Bulk Pricing Test |
| `6facf910-95c3-4d83-abd9-48ad7f78ebea` | `HDPE_BLOW` | HD Blow Test |

**Do not archive** grade `HD Blow` (`HDPE_BLOW` displayName) — only the product named **HD Blow Test**.

## Pre-flight

1. Confirm still public:

```bash
cd Swaroop-Backend
node scripts/confirm-live-test-products.mjs
# → tmp/catalogue-dry-run/live-test-products-confirm.json
```

2. Take a DigitalOcean managed Postgres backup (or `pg_dump`).

3. Export production `DATABASE_URL` (never commit it):

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:PORT/DB?schema=public&sslmode=require'
```

## Dry-run then apply

```bash
node scripts/soft-deactivate-confirmed-test-products.mjs
# review tmp/catalogue-dry-run/test-products-cleanup-plan.json

node scripts/soft-deactivate-confirmed-test-products.mjs --apply
# → pauses ACTIVE offers, soft-archives products (deleted_at + ARCHIVED)
```

## Verify

```bash
node scripts/confirm-live-test-products.mjs
# stillPublic should be []
```

Also:

```bash
curl -sS "$API/public/marketplace/products?page=1&limit=100" | jq '.data[] | select(.name|test("E2E Bulk|HD Blow Test"))'
```

## Admin API alternative (after backend deploy)

```http
POST /api/v1/admin/products/{id}/archive
Authorization: Bearer <admin>
```

Restore if needed:

```http
POST /api/v1/admin/products/{id}/restore
```

## Local Docker note

Local `localhost:5433` catalogue **does not** contain these two products. Cleanup must run against **production** `DATABASE_URL`.
