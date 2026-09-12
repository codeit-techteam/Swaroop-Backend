# Database Design

## Conventions

- Primary keys: UUID (`@db.Uuid`)
- Timestamps: `createdAt` / `updatedAt` (mapped to snake_case)
- Soft delete: `deletedAt` on major business entities
- Money: `Decimal @db.Decimal(18, 2|4)` — never Float
- Quantity: `Decimal @db.Decimal(18, 3)` (MT)
- Currency: `CurrencyCode` enum (default `INR`)
- Business numbers: unique `referenceNumber` (e.g. `PR-…`, `ORD-…`) alongside UUID `id`
- Tables mapped with `@@map("snake_case")`

## Providers

Connection is only via `DATABASE_URL` (DigitalOcean or Azure PostgreSQL). No provider-specific app logic.

## Key unique constraints

| Entity | Unique |
| --- | --- |
| User | email, phone |
| Organization | code |
| Role / Permission | code |
| GradeCategory / Grade | code |
| Product | (organizationId, code) |
| Inventory | (productId, warehouseId) |
| Offer / PR / PO / Order / Payment / Shipment / Settlement | referenceNumber |
| Vehicle | numberPlate |

## Important indexes

- User.status, Organization.gstin/pan/status
- Grade.status + visibility flags
- Product.gradeId/seller/status
- Offer seller/product/status/validity
- PurchaseRequest customer/status/createdAt
- Order customer/seller/status/createdAt
- Payment order/status
- Shipment order/status
- Notification userId/readAt
- AuditLog actor/entity/createdAt

## Migration workflow

```bash
npm run prisma:migrate        # dev
npm run prisma:migrate:deploy # prod/CI
npm run prisma:generate
npm run prisma:seed
```

Phase 2 migration replaces the Phase 1 `schema_meta` bootstrap with the full domain schema.
