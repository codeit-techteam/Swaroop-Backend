# Procurement API (Phase 7)

Commercial acceptance workflow: purchase request → negotiate → accept → purchase order.

Base paths:

| Audience | Prefix |
|----------|--------|
| Customer | `/api/v1/customer/purchase-requests` |
| Seller | `/api/v1/seller/purchase-requests` |
| Admin | `/api/v1/admin/procurement` |

Auth: Bearer JWT + role guards (`CUSTOMER` / `SELLER` / `ADMIN|SUPER_ADMIN`).

## Status mapping (existing `PurchaseRequestStatus`)

| Status | Meaning |
|--------|---------|
| `SOURCING` | Awaiting seller response after customer create |
| `NEGOTIATION` | Counter-offer pending |
| `OFFER_RECEIVED` | Soft seller acknowledge (`RESPOND`) — no PO |
| `APPROVED` | Brief commercial accept (prefer `CONVERTED_TO_ORDER` in same TX) |
| `CONVERTED_TO_ORDER` | Commercial terms accepted + PO created |
| `REJECTED` / `EXPIRED` / `CANCELLED` / `WITHDRAWN` | Terminal |

## Blind rules

- Seller never sees customer email, name, org name, or phone.
- Customer never sees seller company name or seller email.
- Admin sees **full** customer + seller org identity (name, code, type) — never passwords.

## Customer endpoints

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/` | Create from cart → `SOURCING` + `PURCHASE_REQUEST_CREATED` event |
| `GET` | `/` | List |
| `GET` | `/:id` | Detail with `remainingSeconds`, `allowedActions`, `poNumber` |
| `GET` | `/:id/status` | Status snapshot |
| `GET` | `/:id/negotiation` | Blind rounds |
| `POST` | `/:id/counter` | Body `{ unitPrice, quantity, paymentMethod?, note?, validUntil? }` |
| `POST` | `/:id/accept-counter` | Accept pending **seller** counter → PO |
| `POST` | `/:id/reject-counter` | Reject pending seller counter → `REJECTED` |
| `POST` | `/:id/cancel` | Cancel if not terminal |

## Seller endpoints

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/` | Blind inbox |
| `GET` | `/:id` | Blind detail (marks viewed) |
| `GET` | `/:id/status` | Status + allowed actions |
| `GET` | `/:id/negotiation` | Blind rounds |
| `POST` | `/:id/accept` | Accept → `CONVERTED_TO_ORDER` + `PO-YYYY-######` |
| `POST` | `/:id/reject` | Reject |
| `POST` | `/:id/counter-offer` | Counter (also `POST /:id/counter`) |
| `POST` | `/:id/expire` | Force expire if deadline passed |
| `POST` | `/:id/respond` | Generic; `RESPOND` → `OFFER_RECEIVED` (no PO) |

Counter DTO accepts `counterPrice`/`unitPrice` and `counterQuantity`/`quantity` aliases, plus optional `paymentMethod`.

## Admin endpoints

| Method | Path |
|--------|------|
| `GET` | `/admin/procurement/summary` |
| `GET` | `/admin/procurement/purchase-requests` |
| `GET` | `/admin/procurement/purchase-requests/:id` |
| `GET` | `/admin/procurement/purchase-requests/:id/timeline` |
| `GET` | `/admin/procurement/purchase-requests/:id/negotiation` |
| `POST` | `/admin/procurement/purchase-requests/:id/notes` `{ note }` |
| `POST` | `/admin/procurement/purchase-requests/:id/mark-review` |
| `POST` | `/admin/procurement/purchase-requests/:id/escalate` |
| `POST` | `/admin/procurement/purchase-requests/:id/cancel` `{ reason }` |

## Error codes (409 / 400)

`PURCHASE_REQUEST_EXPIRED` (409), `PURCHASE_REQUEST_ALREADY_RESPONDED` (409), `PO_ALREADY_CREATED` (409), `INVALID_STATUS_TRANSITION`, `INVALID_COUNTER_OFFER`, `COUNTER_OFFER_EXPIRED`, `COUNTER_OFFER_NOT_FOUND`, `MOQ_NOT_MET`, `INSUFFICIENT_AVAILABILITY`, `PRODUCT_UNAVAILABLE`, `OFFER_EXPIRED`, `UNAUTHORIZED_SELLER`, `UNAUTHORIZED_CUSTOMER`.

## Shared module

`src/modules/procurement/common/*` — `PrStateService`, `PrEventsService`, `NegotiationService`, `PurchaseOrderService`, `CommercialAcceptanceService`.
