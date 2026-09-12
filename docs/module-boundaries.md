# Module Boundaries

Modules live under `src/modules/*` and are registered in `AppModule`.

Phase 2 ships **empty Nest modules** (no business controllers). This reserves boundaries for Phase 3+.

## Ownership map

| Module | Owns |
| --- | --- |
| auth | Authentication/session (Phase 3) |
| users | User lifecycle |
| roles-permissions | RBAC |
| organizations | Companies, members, addresses, banks |
| customers | CustomerProfile, preferences, credit |
| sellers | SellerProfile, verification, compliance |
| admin | AdminProfile |
| grades | GradeCategory, Grade Master |
| products | Seller products |
| inventory | Warehouse, inventory, lots, movements |
| offers | Offers, tiers |
| pricing | Price revisions / negotiation prices |
| purchase-requests | PR + items |
| procurement | Cases, assignments, activities, quotations |
| orders | Orders, items, status history, POs linkage |
| payments | Payments, transactions, allocations |
| shipments | Shipments, vehicles, slots, tracking |
| documents | Document metadata/versions |
| notifications | Notifications + preferences |
| settlements | Settlements + finance history |
| audit | AuditLog writes/reads |

## Coupling rules

- Modules talk through services, not by reaching into another module’s tables ad hoc (enforced as APIs appear)
- Cross-cutting persistence goes through `PrismaService`
- File bytes go through `StorageService`, never direct R2 SDK in feature modules
- Authorization will use roles/permissions + organization membership (guards in later phases)

## Planned API prefixes (not implemented in Phase 2)

```text
/api/v1/auth
/api/v1/users
/api/v1/grades
/api/v1/products
/api/v1/offers
/api/v1/procurement
/api/v1/purchase-requests
/api/v1/orders
/api/v1/payments
/api/v1/shipments
/api/v1/documents
/api/v1/notifications
/api/v1/settlements
```
