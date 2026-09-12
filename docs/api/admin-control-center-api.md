# Admin Control Center API (Phase 10)

Base path: `/api/v1/admin/*`  
Auth: `JwtAuthGuard` + `RolesGuard`. Most routes require `ADMIN` / `SUPER_ADMIN`. Finance aliases also allow `FINANCE_MANAGER`; documents/compliance also allow `COMPLIANCE_MANAGER`.

## New vs existing admin paths

| Area | Canonical (existing) | Phase 10 addition |
| --- | --- | --- |
| Procurement workbench | `/admin/procurement/*` | Alias `/admin/purchase-requests/*` (same service) |
| Finance verify/lists | `/admin/finance/*` | Aliases `/admin/payments`, `/admin/payment-schedules`, `/admin/transactions`, `/admin/proforma-invoices`, `/admin/invoices`, `/admin/settlements` |
| Logistics | `/admin/logistics/*` | Unchanged (dashboard counts only) |
| Grades | `/master-data/grades` | Alias `/admin/grades` → `GradesService` |

## Endpoints

### Dashboard
- `GET /admin/dashboard/summary` — real Prisma counts (users, customers, sellers, grades, products, offers, PRs, POs, payments, shipments, pending docs, admin unread notifications)

### Users
- `GET /admin/users`, `GET /admin/users/:id`
- `PATCH /admin/users/:id/status` — `ACTIVE|INACTIVE|SUSPENDED|BLOCKED|PENDING`
- `PATCH /admin/users/:id/role` — protects last `SUPER_ADMIN`; never returns `passwordHash`

### Sellers / Customers
- `GET /admin/sellers`, `GET /admin/sellers/:id`
- `POST /admin/sellers/:id/approve|reject|suspend` — transactional profile/org/onboarding/verification + notification + audit
- `GET /admin/customers`, `GET /admin/customers/:id`
- `POST /admin/customers/:id/suspend|activate`

### Catalog
- `GET|POST|PATCH /admin/products`, `PATCH /admin/products/:id/status`
- `GET /admin/offers`, `POST /admin/offers/:id/approve|reject|suspend`
- `GET|POST|PATCH|DELETE /admin/grades` (alias)

### Trading
- `/admin/purchase-requests/*` — delegates to `AdminProcurementService`
- `GET /admin/purchase-orders`, `/:id`, `/:id/timeline`
- `GET /admin/orders`, `/:id`, `/:id/timeline` (empty OK)

### Payments aliases
- Delegates to `PaymentService` / `PaymentVerificationService` / finance list services

### Documents & compliance
- `GET /admin/documents`, approve/reject/download (R2 signed URL)
- `GET /admin/compliance`, `expiring`, `/:entityType/:entityId`, approve/reject

### Pricing
- `GET /admin/pricing/offers|history|revision-requests`
- `POST /admin/pricing/revision-requests/:id/approve|reject`

### Notifications / Reports / Audit / Search
- `GET /admin/notifications`, `unread-count`, `POST .../read`, `read-all` (scoped to JWT user)
- `GET /admin/reports/overview|sales|procurement|payments|logistics|sellers|customers`
- `GET /admin/audit-logs`, `/:id` (secrets scrubbed)
- `GET /admin/search?q=`

## Notes
- No Prisma schema migration in Phase 10
- Facade pattern: reuse procurement/finance/grades services; Prisma for remaining aggregates
- Seller approve maps to `SellerStatus.APPROVED` (enum has no `ACTIVE`) and org `verificationStatus.APPROVED`
