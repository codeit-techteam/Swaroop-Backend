# Phase 2 — Domain Architecture & Database Foundation

## Objective

Establish the centralized domain architecture and Prisma/PostgreSQL data model for the entire SWAROOP ecosystem **without** implementing business REST APIs.

## Delivered

1. NestJS domain module boundaries under `src/modules/*`
2. Full Prisma schema for identity, catalog, commerce, logistics, finance, documents, notifications, audit
3. Enums for lifecycle states
4. Indexes + unique constraints
5. Seed for roles, permissions, Grade Master
6. Documentation under `docs/`
7. Migration replacing Phase 1 `SchemaMeta` bootstrap

## Explicitly not delivered

- Login / OTP / JWT APIs
- Customer / Seller / Admin business APIs
- Grade/Product/Offer/PR/Order/Payment/Shipment REST APIs
- Cloudflare R2 upload/download APIs
- Payment gateway integration

## Identity architecture

Single `User` + `Organization` + RBAC (`Role`, `Permission`, `UserRole`) with `CustomerProfile`, `SellerProfile`, `AdminProfile`.

## Grade Master

Central `GradeCategory` + `Grade` with `customerVisible` / `sellerVisible`. Seeded polymer grades (HDPE/LDPE/LLDPE/PP/PET/PVC/…). Admin will manage; all apps consume the same rows.

## Commerce flow encoded in FKs

```text
PurchaseRequest → ProcurementCase → SupplierQuotation / Offer
               → PurchaseOrder → Order → Payment
                               → Shipment / VehicleSlot
                               → Settlement
```

## Multi-tenant foundation

Organization FKs on transactional entities enable future isolation:

- Customers see own PRs/orders/payments/shipments/documents
- Sellers see own products/inventory/offers/orders/shipments/settlements
- Admin access via permissions

## Financial strategy

All money fields use Prisma `Decimal` / PostgreSQL `NUMERIC`. Currency is explicit (`CurrencyCode`, default INR).

## Next phase

**Phase 3** starts with `/api/v1/auth` (centralized authentication), then users/roles, then business APIs on this schema.
