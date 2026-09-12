# Seller API (Phase 5)

Centralized Seller APIs for SWAROOP Seller Mobile + Seller Web + Admin review.

Base path: `/api/v1/seller/*`  
Auth: Bearer JWT + role `SELLER` (Admin may read some resources).

## Lifecycle

```text
Onboarding → Company → Documents → Admin verification → Products (Grade Master)
→ Inventory → Offers → Pricing → Blind PR inbox → Accept/Reject/Counter
```

Orders, payments, shipments, settlements are **out of scope** for Phase 5.

## Blind marketplace

Seller PR endpoints **never** return buyer name, phone, email, company legal name, or exact address IDs.

Seller sees:

- PR reference (`PR-YYYY-######`)
- `buyer.displayName = "ANONYMOUS BUYER"`
- `buyer.reference = "BUYER-XXXXXXXX"`
- grade / quantity / commercial terms / destination **region**

Enforced in `toBlindPurchaseRequest()` — not frontend-only.

## Ownership

`sellerId` / `organizationId` are taken from JWT → `SellerProfile`.  
Clients cannot pass another seller’s id to access resources.

## Grade Master

Products and offers reference `gradeId` from Phase 4 Grade Master. Sellers **select** grades; they do not create grade master records.

## Endpoint groups

| Tag | Prefix |
|-----|--------|
| Profile / Status | `/seller/profile`, `/seller/status` |
| Onboarding | `/seller/onboarding` |
| Company | `/seller/company` |
| Documents | `/seller/documents` |
| Products | `/seller/products` |
| Inventory | `/seller/inventory` |
| Offers | `/seller/offers` |
| Pricing | `/seller/pricing` |
| Purchase Requests | `/seller/purchase-requests` |
| Dashboard | `/seller/dashboard/summary`, `/seller/dashboard-summary` |

## Documents + R2

Metadata in PostgreSQL (`documents`, `document_versions`).  
Binaries in Cloudflare R2 via `StorageService` signed URLs (`put` / `get`).  
Replace creates a new version; previous storage keys are retained.

## Inventory safety

Adjustments run in a transaction with `StockMovement` history.  
`availableQty` cannot go negative.

## PR state rules

- Expired (`expiresAt < now`) / `CANCELLED` / `REJECTED` / `WITHDRAWN` → cannot accept
- Accept / Reject / Counter create `PurchaseRequestResponse` + audit events

## Pagination

`?page=1&limit=20&search=&status=&sortBy=createdAt&sortOrder=desc`

Response meta: `{ page, limit, total, totalPages }` inside the standard `{ success, message, data, meta }` wrapper.
