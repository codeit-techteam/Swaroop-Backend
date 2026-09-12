# SWAROOP Backend Architecture

## Purpose

`Swaroop-Backend` is the **single centralized NestJS monolith** consumed by:

- Customer Mobile
- Customer Web
- Seller Mobile
- Seller Web
- Admin Web

There is one PostgreSQL database and one domain model. Frontends never own competing masters for grades, organizations, offers, or orders.

## High-level topology

```text
Customer Apps ──┐
Seller Apps  ───┼──► SWAROOP BACKEND (/api/v1) ──► Services ──► Prisma ──► PostgreSQL
Admin Panel  ───┘                                                      │
                                                                       └── Cloudflare R2 (documents)
```

## Layering

1. **Transport** — NestJS HTTP, global `/api` prefix, URI versioning `v1`
2. **Modules** — domain boundaries under `src/modules/*`
3. **Persistence** — Prisma ORM + PostgreSQL
4. **Storage** — `StorageService` abstraction over Cloudflare R2
5. **Cross-cutting** — config, logging, validation, errors, rate limit, health, Swagger

## Phase boundaries

| Phase | Scope |
| --- | --- |
| Phase 1 | Foundation (config, Prisma wiring, health, Swagger, Docker) |
| Phase 2 | Domain architecture + Prisma schema + seeds + docs (**current**) |
| Phase 3+ | Auth and business REST APIs |

## Design principles

- Modular monolith (no microservices/Kafka/CQRS in Phase 2)
- Central identity for Customer/Seller/Admin
- Organization-scoped data ownership for tenancy/isolation
- Grade Master is platform SoT
- Financial amounts use `Decimal`
- Business reference numbers are unique strings; PKs remain UUIDs
- No business REST controllers in Phase 2
