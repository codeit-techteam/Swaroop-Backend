# Customer Marketplace API (Phase 6)

Base: `/api/v1/customer/*`  
Auth: Bearer JWT + role `CUSTOMER`

## Flow

```text
Marketplace → Product → Qty + Payment → POST /checkout/quote → Checkout
→ POST /purchase-requests { quoteId } → 15-minute seller response
→ Seller blind inbox → Admin procurement workbench
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
- Cart ≠ Order: no inventory deduction on add-to-cart or quote
- Checkout quote is server-authoritative (GST, freight, discount, platform fee)
- Buy Now → Quote → Checkout → Purchase Request (not a PO/Order)
- Seller matching: explicit offer, else best price on product, else best price on grade
- Credit is PetroTrade-owned — sellers never set credit price or tenure
- PR number: server-generated `PR-YYYY-######`
- Deadline: `responseDeadline = createdAt + 15 minutes` (server clock)
- Same `PurchaseRequest` entity as Seller inbox

## Endpoints

| Group | Paths |
|-------|--------|
| Marketplace | `GET /customer/marketplace`, `/categories`, `/grades`, `/grades/:id`, `/grades/:id/products`, `/grades/:id/offers` |
| Orders (PO projection) | `GET /customer/orders`, `/customer/orders/summary`, `/customer/orders/:id`, `/customer/orders/:id/timeline`, `/customer/orders/:id/progress` |
| Products | `GET /customer/products`, `/:id`, `/:id/offers` |
| Offers | `GET /customer/offers`, `/:id` |
| Cart | `GET/DELETE /customer/cart`, items CRUD, `/summary`, `POST /validate` |
| Checkout | `POST /customer/checkout/quote`, `GET /customer/checkout/quotes/:id`, `GET /customer/checkout/addresses`, `GET /customer/checkout/payment-options` |
| Credit | `GET /customer/credit/eligibility`, `/account`, `/limit`, `/status`, `/summary` |
| PRs | create from `quoteId` or cart; list/get/cancel/status + accept/reject counter |
| Dashboard | `GET /customer/dashboard/summary`, `GET /customer/search?q=` |
| Orders (PO projection) | `GET /customer/orders`, `/summary`, `/:id`, `/:id/timeline`, `/:id/progress` |

## Payment options (selection only)

`ADVANCE` | `ON_LOADING` | `ON_DELIVERY` | `CREDIT_15` | `CREDIT_30`

Credit options are returned only when PetroTrade credit is eligible. Seller payment terms never change the offer unit price.

- Search: `?search=` or `?q=` against PostgreSQL (name, code, grade)
- Pagination: `page`, `limit` (max 100) with `meta.total` / `meta.totalPages`
- Product commercial fields (`listing.price`, `moq`, `quantityAvailable`) come from active Offers — never hardcoded on the client
- Customer product/offer payloads never include seller identity

## Business error codes

`OFFER_EXPIRED`, `OFFER_NOT_ACTIVE`, `QUANTITY_BELOW_MOQ`, `QUANTITY_EXCEEDS_AVAILABILITY`, `PRICE_CHANGED`, `PRODUCT_NOT_AVAILABLE`, `CART_EMPTY`, `UNAUTHORIZED_CUSTOMER_RESOURCE`, `QUOTE_CHANGED`, `QUOTE_EXPIRED`, `CREDIT_NOT_ELIGIBLE`, `CREDIT_LIMIT_EXCEEDED`, `NO_MATCHING_SELLER`, `MOQ_NOT_MET`, `INSUFFICIENT_INVENTORY`, `INVALID_QUANTITY_INCREMENT`, …
