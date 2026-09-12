# Phase 13 — Analytics, Reports & Audit

## Status

Centralized **Admin** analytics over live PostgreSQL data. No mock metrics. No separate analytics DB.

**Audit** continues to use the existing append-only `AuditLog` model (not a new `AuditEvent` table).

## Architecture

```
Admin Web App
    ↓ JWT + ADMIN / SUPER_ADMIN
GET /api/v1/admin/analytics/*
    ↓
AnalyticsModule (read-only aggregations)
    ↓
PostgreSQL (COUNT / SUM / GROUP BY / date_trunc)
```

Reports at `/api/v1/admin/reports/*` remain available (Phase 10) and were extended with **inventory** and **settlements**.

## Default date range

If `from` / `to` are omitted:

- **from** = start of current **UTC** month (`YYYY-MM-01T00:00:00.000Z`)
- **to** = now (UTC)

`meta.defaultApplied: true` when defaults were used. `from > to` → `400 VALIDATION_ERROR`.

## GMV definition

`GMV` = sum of `PurchaseOrder.totalAmount` where status ∈

`CONFIRMED`, `READY_FOR_DISPATCH`, `DISPATCHED`, `IN_TRANSIT`, `DELIVERED`, `COMPLETED`

Excludes `DRAFT`, pre-confirm review states, `CANCELLED`, `REJECTED`.

Money values are returned as **2-decimal strings** (Prisma Decimal). Rates never return NaN/Infinity.

## Analytics endpoints

| Method | Path |
|--------|------|
| GET | `/api/v1/admin/analytics/overview` |
| GET | `/api/v1/admin/analytics/sales` |
| GET | `/api/v1/admin/analytics/gmv` |
| GET | `/api/v1/admin/analytics/procurement` |
| GET | `/api/v1/admin/analytics/purchase-requests` |
| GET | `/api/v1/admin/analytics/purchase-orders` |
| GET | `/api/v1/admin/analytics/payments` |
| GET | `/api/v1/admin/analytics/payment-clearance` |
| GET | `/api/v1/admin/analytics/sellers` |
| GET | `/api/v1/admin/analytics/customers` |
| GET | `/api/v1/admin/analytics/grades` |
| GET | `/api/v1/admin/analytics/products` |
| GET | `/api/v1/admin/analytics/inventory` |
| GET | `/api/v1/admin/analytics/logistics` |
| GET | `/api/v1/admin/analytics/delivery` |
| GET | `/api/v1/admin/analytics/settlements` |
| GET | `/api/v1/admin/analytics/finance` |
| GET | `/api/v1/admin/analytics/operational-status` |

Common query: `from`, `to`, optional `sellerId`, `customerId`, `gradeId`, `productId`, `status`, `paymentOption`.

## Reports (extended)

Existing Phase 10 routes plus:

- `GET /api/v1/admin/reports/inventory`
- `GET /api/v1/admin/reports/settlements`

JSON only (CSV/Excel/PDF export foundation deferred).

## Audit

- `GET /api/v1/admin/audit-logs` — filters: `actorUserId`, `action`, `entityType`, `entityId`, `from`, `to`, `page`, `limit`
- `GET /api/v1/admin/audit-logs/:id`
- **No** PUT / PATCH / DELETE
- Sensitive keys in `previousData` / `newData` / `metadata` are redacted
- Indexes already present on `AuditLog`

## Known limitations

| Metric | Status |
|--------|--------|
| Credit-related outstanding | `null` — no credit ledger model |
| Inventory period filter | Snapshot only (current qty) |
| Settlement “completed” | Maps to status `RELEASED` |
| Seller “active” in overview | Maps to `SellerStatus.APPROVED` |
| Average delivery duration | Only when `confirmed_at` present |

## Security

Admin-only. Customer/Seller tokens receive **403**. Admin analytics may show customer + seller identities; do not reuse these DTOs on marketplace APIs (blind rules).
