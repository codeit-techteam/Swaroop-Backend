# SWAROOP Centralized Backend

Single source of truth REST API for the **SWAROOP / PetroTrade** B2B blind marketplace.

All client platforms consume this backend:

| Client | Role |
| --- | --- |
| SWAROOP Customer Mobile | Customer |
| Swaroop-Customer-WEBAPP | Customer |
| SWAROOP Seller Mobile | Seller |
| Swaroop-seller-Webapp | Seller |
| Swaroop-ADMIN | Admin |

```
Customer Apps ──┐
Seller Apps  ───┼──► SWAROOP BACKEND ──► REST /api/v1 ──► Services ──► Prisma ──► PostgreSQL
Admin Panel  ───┘                                              │
                                                               └── Cloudflare R2
```

> **Phase 13 complete:** Admin Analytics, Reports & Audit (PostgreSQL aggregations; no mock data).  
> See [`docs/api/analytics-reports-audit-api.md`](docs/api/analytics-reports-audit-api.md). Reuses `AuditLog`; extends Phase 10 reports.

> **Phase 10 complete:** Admin Control Center APIs (dashboard, users/sellers/customers, catalog, aliases for procurement/finance/grades, documents, compliance, pricing, reports, audit, search).  
> See [`docs/api/admin-control-center-api.md`](docs/api/admin-control-center-api.md). Existing finance/logistics/procurement admin paths remain canonical.

> **Phase 8 complete:** Payment & Finance APIs (PI → schedules → pay → verify → settlement draft).  
> See [`docs/api/finance-api.md`](docs/api/finance-api.md).

> **Phase 7 complete:** Procurement workflow (negotiate → commercial accept → PO).  
> Shared `ProcurementModule`, seller/customer PR refactor, admin workbench.  
> See [`docs/api/procurement-api.md`](docs/api/procurement-api.md).

> **Phase 6 complete:** Customer Marketplace APIs (grades → products → offers → cart → PR).  
> Blind marketplace + 15-minute seller response window.  
> See [`docs/api/customer-marketplace-api.md`](docs/api/customer-marketplace-api.md).

> **Phase 5 complete:** Seller APIs (onboarding → products → inventory → offers → blind PR).  
> See [`docs/api/seller-api.md`](docs/api/seller-api.md).

> **Phase 4 complete:** Master Data APIs (Grade Master + supporting masters).  
> Admin → PostgreSQL → Customer/Seller consumers share one source of truth.  
> See [`docs/master-data.md`](docs/master-data.md).

> **Phase 3 complete:** Centralized Authentication & Authorization APIs.

---

## Purpose

Provide a production-grade NestJS foundation that future marketplace modules can safely build on:

- Centralized configuration & env validation
- PostgreSQL via Prisma (provider-agnostic `DATABASE_URL`)
- Cloudflare R2 storage abstraction
- Swagger/OpenAPI scaffolding
- Global validation, error handling, logging, CORS, security headers, rate-limit foundation
- Infrastructure health checks
- Docker support for local PostgreSQL

---

## Technology Stack

- Node.js 20+ / NestJS 12 / TypeScript
- PostgreSQL + Prisma ORM 7
- Swagger (OpenAPI)
- Cloudflare R2 (S3-compatible)
- class-validator / class-transformer
- Nest ConfigModule + Zod env validation
- nestjs-pino structured logging
- Helmet + in-memory rate-limit foundation
- ESLint + Prettier
- Vitest (unit + e2e)
- Docker / Docker Compose

---

## Architecture

```
src/
├── main.ts                 # Bootstrap: CORS, security, prefix, versioning, Swagger
├── app.module.ts
├── config/                 # Centralized configuration
├── common/                 # Filters, interceptors, types, utils
├── database/               # PrismaService + DatabaseModule
├── storage/                # StorageService + Cloudflare R2 provider
├── health/                 # Infrastructure health endpoints
├── docs/                   # Swagger setup
├── modules/                # Domain module boundaries (Phase 2; APIs from Phase 3)
└── generated/prisma/       # Prisma Client output (generated, not committed)
```

Domain docs: [`docs/architecture.md`](docs/architecture.md), [`docs/domain-model.md`](docs/domain-model.md), [`docs/database.md`](docs/database.md), [`docs/module-boundaries.md`](docs/module-boundaries.md), [`docs/phase-2.md`](docs/phase-2.md).

---

## Environment Variables

Copy the template:

```bash
cp .env.example .env
```

| Variable | Description |
| --- | --- |
| `APP_NAME` | Service name |
| `NODE_ENV` | `development` \| `test` \| `staging` \| `production` |
| `PORT` | HTTP port (default `3000`) |
| `API_PREFIX` | Global prefix (default `api`) |
| `API_VERSION` | Default URI version (default `1`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Placeholder for future auth (required; strong secret required in production) |
| `JWT_EXPIRES_IN` | Placeholder for future auth |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `CLOUDFLARE_R2_*` | R2 account, keys, bucket, public URL |
| `LOG_LEVEL` | Pino log level |
| `THROTTLE_TTL_MS` / `THROTTLE_LIMIT` | Rate-limit foundation |

Never commit real credentials. Production boot fails clearly if mandatory secrets are missing or weak.

---

## Local Development

### 1. Install

```bash
npm install
```

### 2. Start PostgreSQL (Docker)

```bash
docker compose up -d postgres
```

### 3. Configure `.env`

Set `DATABASE_URL` to:

```text
postgresql://postgres:postgres@localhost:5433/swaroop?schema=public
```

### 4. Prisma

```bash
npm run prisma:generate
npm run prisma:migrate
```

### 5. Run API

```bash
npm run dev
```

- API base: `http://localhost:3000/api/v1`
- Health: `http://localhost:3000/health` and `http://localhost:3000/api/v1/health`
- Swagger: `http://localhost:3000/docs` (non-production)
- OpenAPI JSON: `http://localhost:3000/docs-json`

---

## PostgreSQL Setup

Use **any** managed or local PostgreSQL through `DATABASE_URL` only:

### Local (Docker Compose)

```text
postgresql://postgres:postgres@localhost:5433/swaroop?schema=public
```

### DigitalOcean Managed PostgreSQL

```text
postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public&sslmode=require
```

### Azure Database for PostgreSQL

```text
postgresql://USER@SERVER:PASSWORD@HOST:5432/DATABASE?schema=public&sslmode=require
```

No DigitalOcean- or Azure-specific application code is required.

---

## Prisma Commands

| Script | Command |
| --- | --- |
| Generate client | `npm run prisma:generate` |
| Create/apply migration (dev) | `npm run prisma:migrate` |
| Apply migrations (deploy) | `npm run prisma:migrate:deploy` |
| Studio | `npm run prisma:studio` |
| Validate schema | `npm run prisma:validate` |

Phase 2 includes the full domain schema (identity, grades, commerce, logistics, finance). Seed foundational masters with:

```bash
npm run prisma:seed
```

---

## Cloudflare R2 Configuration

**R2 integration is prepared but disabled by default** (`STORAGE_PROVIDER=none`) because credentials are typically not configured in local/dev. Document metadata APIs work without R2; signed upload/download return `503 STORAGE_NOT_CONFIGURED`.

Object storage is wired through:

- `StorageService.upload(...)`
- `StorageService.delete(...)`
- `StorageService.getSignedUrl(...)`

Feature modules must depend on `StorageService`, never on R2 SDK calls directly.

See [docs/api/documents-storage-api.md](docs/api/documents-storage-api.md) for customer/seller/admin document APIs and the R2 enablement checklist.

Set (when enabling R2):

- `STORAGE_PROVIDER=r2`
- `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME`
- Optional: `R2_PUBLIC_BASE_URL`, `R2_REGION`, `R2_SIGNED_URL_EXPIRY`, `MAX_DOCUMENT_SIZE_MB`
- Legacy aliases: `CLOUDFLARE_R2_*` still supported

---

## Swagger

Swagger UI is enabled outside production at `/docs`.

Bearer authentication is registered as a **placeholder** for future JWT auth. Authentication APIs are not implemented in Phase 1.

---

## Health Check

Infrastructure only:

```http
GET /health
GET /api/v1/health
```

Example:

```json
{
  "success": true,
  "message": "Health check completed",
  "data": {
    "status": "ok",
    "service": "swaroop-backend",
    "database": "connected",
    "storage": "configured",
    "timestamp": "2026-09-11T00:00:00.000Z"
  }
}
```

---

## Testing

```bash
npm run test
npm run test:e2e
```

---

## Build & Lint

```bash
npm run lint
npm run build
npm run start:prod
```

---

## Docker

PostgreSQL only (recommended for day-to-day local work):

```bash
docker compose up -d postgres
```

Optional full stack profile (API + Postgres):

```bash
cp .env.example .env
docker compose --profile full up --build
```

Cloud deployment is out of scope for Phase 1.

---

## Production Notes

- Use a strong `JWT_SECRET` (min 32 characters; no placeholders)
- Require TLS on managed PostgreSQL (`sslmode=require`)
- Configure real `CORS_ORIGINS` for all web clients
- Provide complete Cloudflare R2 credentials
- Prefer `npm run prisma:migrate:deploy` in CI/CD
- Swagger is disabled when `NODE_ENV=production`
- Do not log secrets, OTPs, passwords, or R2 credentials

---

## Phase Boundary

**Implemented in Phase 1**

- NestJS project root in `Swaroop-Backend/`
- Config, logging, validation, errors, CORS, security foundation
- Prisma + PostgreSQL wiring
- R2 storage abstraction
- Health + Swagger scaffolding
- Docker / Compose / tests

**Implemented in Phase 3**

- Centralized Auth module for Customer / Seller / Admin
- OTP send/verify, password login, refresh rotation, logout, me
- Change / forgot / reset password
- JWT access + refresh, AuthSession, OtpVerification, PasswordResetToken
- RBAC guards (`JwtAuthGuard`, `RolesGuard`, `@Roles`)
- Auth Swagger docs + e2e coverage
- Docs: [`docs/PHASE-3-AUTHENTICATION.md`](docs/PHASE-3-AUTHENTICATION.md)

**Implemented in Phase 5**

- Seller module (`/api/v1/seller/*`): profile, onboarding, company, documents (R2), products (Grade Master), inventory, offers, pricing, blind PR inbox, dashboard
- Ownership checks + blind marketplace serialization
- Migration: `20260911160000_phase5_seller_apis`
- Docs: [`docs/api/seller-api.md`](docs/api/seller-api.md)

**Implemented in Phase 6**

- Customer marketplace (`/api/v1/customer/*`): grades, products, offers, cart, checkout validate, purchase requests, dashboard/search
- Blind supplier serialization; same PurchaseRequest entity as Seller inbox
- 15-minute `responseDeadline`; cart price snapshots; MOQ/availability validation
- Migration: `20260912120000_phase6_customer_marketplace`
- Docs: [`docs/api/customer-marketplace-api.md`](docs/api/customer-marketplace-api.md)

**Implemented in Phase 7**

- Shared `ProcurementModule`: negotiate → commercial accept → PO
- Seller/customer PR refactor; admin procurement workbench
- Docs: [`docs/api/procurement-api.md`](docs/api/procurement-api.md)

**Implemented in Phase 8**

- Payments & finance: proforma invoice, payment schedules, customer pay + UTR, admin verify/reject
- Settlement PENDING draft + finance invoice DRAFT foundation after full payment
- Dispatch clearance gate (`isPaymentClearedForDispatch`)
- Migration: `20260912160000_phase8_payment_finance`
- Docs: [`docs/api/finance-api.md`](docs/api/finance-api.md)

**Implemented in Phase 9**

- Logistics: dispatch → vehicle/driver/slot → e-way bill → shipment tracking → delivery/POD
- Payment milestone hooks (`ON_LOADING` / `ON_DELIVERY`) + dispatch payment gate reuse
- Blind customer/seller DTOs; admin `/admin/logistics/*`
- Migration: `20260912180000_phase9_logistics`
- Docs: [`docs/api/logistics-api.md`](docs/api/logistics-api.md)

**Implemented in Phase 10**

- Admin Control Center under `/api/v1/admin/*`: dashboard, users, sellers, customers, products/offers, orders, documents, compliance, pricing revisions, notifications, reports, audit logs, global search
- Thin aliases: `/admin/grades` → GradesService; `/admin/purchase-requests` → AdminProcurementService; `/admin/payments*` → Payment/Finance services
- Existing `/admin/finance/*`, `/admin/logistics/*`, `/admin/procurement/*` unchanged and remain canonical
- No schema migration
- Docs: [`docs/api/admin-control-center-api.md`](docs/api/admin-control-center-api.md)

**Not implemented (later)**

- Tax invoice auto-issue / GST e-invoice
- Settlement release / payout rails
- Cloudflare R2 multipart upload UX polish
- Payment gateway charge integration
- SMS/Email provider integrations (OTP delivery abstraction is ready)
- Government e-way bill portal integration
