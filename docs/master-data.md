# Phase 4 — Master Data APIs

Centralized master data for the SWAROOP marketplace. **Admin creates/updates → PostgreSQL → NestJS REST → Customer App / Customer Web / Seller App / Seller Web** all consume the same records.

## Architecture

```text
Admin Panel
    │ create/update
    ▼
Master Data APIs (/api/v1/master-data/*)
    ▼
PostgreSQL (Prisma)
    ▼
Consumer read APIs
    ├── GET .../grades/customer
    └── GET .../grades/seller
```

There is **one** Grade Master. Visibility flags (`customerVisible`, `sellerVisible`) and `status` control who sees each grade. There are no platform-specific grade tables.

## Entities

| Entity | Table | Notes |
|--------|-------|-------|
| GradeCategory | `grade_categories` | Parent group + status |
| Subcategory | `subcategories` | Belongs to category |
| Grade | `grades` | Canonical grade codes |
| Application | `applications` | Reusable end-use tags |
| GradeApplication | `grade_applications` | M2M junction |
| Unit | `units` | KG, MT, … |
| ProductAttribute | `product_attributes` | Spec definitions (not product values) |
| Location | `locations` | Country → State → City |
| Warehouse | `warehouses` | Optional `locationId` / `organizationId` |
| PaymentTerm | `payment_terms` | Term definitions only |

## Grade visibility rules

| status | customerVisible | sellerVisible | Customer API | Seller API |
|--------|-----------------|---------------|--------------|------------|
| ACTIVE | true | true | yes | yes |
| ACTIVE | false | true | no | yes |
| ACTIVE | true | false | yes | no |
| INACTIVE | * | * | no | no |
| soft-deleted (`deletedAt`) | * | * | no | no |

## RBAC

| Action | Roles |
|--------|-------|
| Create / update / delete / status / visibility | `ADMIN`, `SUPER_ADMIN` |
| `GET /grades/customer` | `CUSTOMER`, `ADMIN`, `SUPER_ADMIN` |
| `GET /grades/seller` | `SELLER`, `ADMIN`, `SUPER_ADMIN` |
| Active lists (categories, units, payment terms, …) | Authenticated customer/seller/admin |

Mutations always require admin. Customers and sellers are read-only.

## API base

`/api/v1/master-data`

### Grades

- `POST /grades` — create
- `GET /grades` — admin list (filters + pagination)
- `GET /grades/customer` — active + customerVisible
- `GET /grades/seller` — active + sellerVisible
- `GET /grades/:id`
- `PATCH /grades/:id`
- `DELETE /grades/:id` — soft delete
- `PATCH /grades/:id/status`
- `PATCH /grades/:id/visibility`
- `POST /grades/:gradeId/applications/:applicationId`
- `DELETE /grades/:gradeId/applications/:applicationId`

### Other masters

CRUD (+ `…/active` where noted) for:

- `/categories` (+ `/active`, `/:categoryId/subcategories`)
- `/subcategories`
- `/applications` (+ `/active`)
- `/units` (+ `/active`)
- `/attributes`
- `/locations` (+ `/countries`, `/states?countryId=`, `/cities?stateId=`)
- `/warehouses`
- `/payment-terms` (+ `/active`)

## Pagination

Query: `?page=1&limit=20&search=&sortBy=sortOrder&sortOrder=asc`

Response shape (project wrapper):

```json
{
  "success": true,
  "message": "Grades retrieved",
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 82, "totalPages": 5 }
}
```

## Seed

Source of truth for grades: Admin panel mock (`Swaroop-ADMIN` Grade Master) consolidated into:

- `prisma/seed-data/admin-grades.json`
- `prisma/seed-data/master-data.normalized.json` (canonical codes + parent groups)

```bash
npm run prisma:seed
```

Idempotent via `upsert` on unique `code`. Seeds **25 categories**, **82 grades**, **104 applications**, units, attributes, payment terms, India → Maharashtra → Mumbai, and platform warehouse `WH-MUM-HUB`.

### Normalization decisions

- Parent groups mapped to `GradeParentGroup` enum (`Polymers` → `POLYMERS`, etc.).
- Admin `categoryId` values like `cat-hdpe` mapped to category codes (`HDPE`).
- Application display names preserved; codes generated as uppercase snake (`Flexible Packaging` → `FLEXIBLE_PACKAGING`).
- Aliases such as `rHDPE` vs `R_HDPE` were **not** auto-merged; Admin canonical codes are kept as-is.

## Sync flow (Admin → platforms)

1. Admin authenticates and `POST /api/v1/master-data/grades`.
2. Record is stored in PostgreSQL with visibility flags.
3. Customer clients call `GET /api/v1/master-data/grades/customer`.
4. Seller clients call `GET /api/v1/master-data/grades/seller`.
5. Changing `customerVisible=false` hides the grade from customers only; sellers still see it if `sellerVisible=true` and `status=ACTIVE`.

## Frontend integration (later)

Do not change frontends in Phase 4. When integrating:

- Customer grade screen → `GET .../grades/customer`
- Seller product form → `GET .../grades/seller`
- Admin grade management → full CRUD on `.../grades`

## Swagger

Open `/docs` and filter tags starting with **Master Data -**.
