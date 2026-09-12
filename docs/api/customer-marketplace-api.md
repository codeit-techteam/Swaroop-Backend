# Customer Marketplace API (Phase 6)

Base: `/api/v1/customer/*`  
Auth: Bearer JWT + role `CUSTOMER`

## Flow

```text
Marketplace → Grade → Product → Offer → Qty + Payment → Cart → Checkout → PR
→ 15-minute seller response window → Seller blind inbox
```

## Blind marketplace

| Audience | Sees |
|----------|------|
| Customer | `ANONYMOUS SUPPLIER` / `SUP-XXXXXXXX` |
| Seller | `ANONYMOUS BUYER` / `BUYER-XXXXXXXX` (Phase 5) |

Never returns seller/customer company name, email, phone, or exact address on marketplace/PR APIs.

## Key rules

- Grades: Admin Grade Master only (`ACTIVE` + `customerVisible`)
- Price: resolved from Offer / price tiers — never trust client price
- Cart ≠ Order: no inventory deduction on add-to-cart
- PR number: server-generated `PR-YYYY-######`
- Deadline: `responseDeadline = createdAt + 15 minutes` (server clock)
- Same `PurchaseRequest` entity as Seller inbox

## Endpoints

| Group | Paths |
|-------|--------|
| Marketplace | `GET /customer/marketplace`, `/grades`, `/grades/:id`, `/grades/:id/products`, `/grades/:id/offers` |
| Products | `GET /customer/products`, `/:id`, `/:id/offers` |
| Offers | `GET /customer/offers`, `/:id` |
| Cart | `GET/DELETE /customer/cart`, items CRUD, `/summary`, `POST /validate` |
| PRs | CRUD create/list/get/cancel/status + accept/reject counter |
| Dashboard | `GET /customer/dashboard/summary`, `GET /customer/search?q=` |

## Payment options (selection only)

`ADVANCE` | `ON_LOADING` | `ON_DELIVERY` | `CREDIT` (maps to `CREDIT_30`)

No payment processing in Phase 6.

## Business error codes

`OFFER_EXPIRED`, `OFFER_NOT_ACTIVE`, `QUANTITY_BELOW_MOQ`, `QUANTITY_EXCEEDS_AVAILABILITY`, `PRICE_CHANGED`, `PRODUCT_NOT_AVAILABLE`, `CART_EMPTY`, `UNAUTHORIZED_CUSTOMER_RESOURCE`, …
