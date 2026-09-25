# Phase 8 — Payment & Finance APIs

Proforma invoices, payment schedules, customer payment initiation/UTR submit, admin verification, settlements draft, and dispatch clearance.

Base path: `/api/v1`

## Bootstrap (commercial accept)

When a PR converts to a PO (`CommercialAcceptanceService`):

1. Credit check if `CREDIT_15` / `CREDIT_30`
2. Create `ProformaInvoice` (`ISSUED`, `PI-YYYY-######`)
3. Create `PaymentSchedule` rows from payment method template
4. Record `PROFORMA_INVOICE_CREATED` / `PROFORMA_INVOICE_ISSUED` finance events

Idempotent if PI already exists for the PO.

## Customer (`CUSTOMER`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/customer/finance/summary` | Outstanding + status counts |
| GET | `/customer/purchase-orders` | Minimal PO list for finance UX |
| GET | `/customer/orders` | Authoritative customer Orders screen (PurchaseOrder projection + progress/payment/logistics) |
| GET | `/customer/orders/summary` | Active / completed / cancelled / pending payment / in-transit counts |
| GET | `/customer/orders/:id` | Order detail (own org only) |
| GET | `/customer/orders/:id/timeline` | Persisted PR/PO/payment/dispatch/shipment events |
| GET | `/customer/orders/:id/progress` | Backend-derived progress percentage + stage |
| GET | `/customer/proforma-invoices` | Own PIs |
| GET | `/customer/proforma-invoices/:id` | Detail + schedules |
| GET | `/customer/proforma-invoices/:id/payment-status` | Schedules + payments |
| GET | `/customer/purchase-orders/:id/proforma-invoice` | PI by PO |
| GET | `/customer/payments` | List |
| POST | `/customer/payments` | Initiate (`INITIATED`) |
| GET | `/customer/payments/:id` | Detail (no admin notes) |
| POST | `/customer/payments/:id/submit` | Submit UTR → `UNDER_VERIFICATION` |
| POST | `/customer/payments/:id/utr` | Same as submit |
| GET | `/customer/payments/:id/status` | Status only |
| GET | `/customer/purchase-orders/:id/dispatch-clearance` | Read-only gate |

### Create payment body

```json
{
  "purchaseOrderId": "uuid",
  "paymentScheduleId": "uuid?",
  "amount": 15000,
  "rail": "BANK_TRANSFER",
  "note": "optional",
  "idempotencyKey": "optional"
}
```

### Submit UTR body

```json
{
  "utrNumber": "UTR123456789",
  "paymentDate": "2026-09-12",
  "note": "optional",
  "amount": 15000
}
```

Customers **cannot** verify payments (403).

## Seller (`SELLER`) — read-only

| Method | Path |
| --- | --- |
| GET | `/seller/finance/summary` |
| GET | `/seller/proforma-invoices` |
| GET | `/seller/proforma-invoices/:id` |
| GET | `/seller/payments` |
| GET | `/seller/settlements` | Query: `page`, `limit`, `search`, `status`, `sortBy`, `sortOrder` |
| GET | `/seller/settlements/summary` | Amount KPIs (total sales, settled, pending, next) |
| GET | `/seller/settlements/:id` | Detail + deduction breakdown + related PO/invoice |
| GET | `/seller/settlements/:id/timeline` | Status history + related finance events |
| GET | `/seller/finance/purchase-orders/:id/dispatch-clearance` |

## Admin (`ADMIN` \| `SUPER_ADMIN` \| `FINANCE_MANAGER`)

| Method | Path |
| --- | --- |
| GET | `/admin/finance/summary` |
| GET | `/admin/finance/proforma-invoices` |
| GET | `/admin/finance/proforma-invoices/:id` |
| GET | `/admin/finance/payments` |
| GET | `/admin/finance/payments/:id` |
| POST | `/admin/finance/payments/:id/verify` |
| POST | `/admin/finance/payments/:id/reject` |
| POST | `/admin/finance/payments/:id/request-review` |
| GET | `/admin/finance/transactions` |
| GET | `/admin/finance/settlements` |
| GET | `/admin/finance/invoices` |
| GET | `/admin/finance/purchase-orders/:id/dispatch-clearance` |

### Verify effects

- Payment `UNDER_VERIFICATION` → `VERIFIED` (conditional update)
- Transaction → `SUCCESS`
- Apply amount to schedule + PI (`PARTIALLY_PAID` / `PAID`)
- Create finance invoice **DRAFT** (idempotent; not issued)
- When all schedules + PI paid → settlement **PENDING** draft (idempotent)

## Schedule templates

| PaymentMethod | Schedules |
| --- | --- |
| ADVANCE | 100% ADVANCE DUE |
| BEFORE_DISPATCH | 100% BEFORE_DISPATCH DUE |
| ON_LOADING | 100% ON_LOADING PENDING |
| ON_DELIVERY | 100% ON_DELIVERY PENDING |
| CREDIT_15 / CREDIT_30 | 100% CREDIT DUE (+15/+30 days) |
| PARTIAL_ADVANCE / PARTIAL_PAYMENT | 30% ADVANCE DUE + 70% BEFORE_DISPATCH PENDING |
| MILESTONE_PAYMENT | 20% ADVANCE + 40% ON_LOADING + 40% ON_DELIVERY |
| NET_TERMS / LC / OTHER | 100% OTHER DUE |

Amounts use `Prisma.Decimal`; last line absorbs rounding remainder.

## Dispatch clearance

`isPaymentClearedForDispatch` is true when ADVANCE and BEFORE_DISPATCH schedules (and any `metadata.dispatchBlocking`) have `remainingAmount = 0`.

`PaymentScheduleService.markPaymentMilestoneDue(poId, type)` is exported for Phase 9.

## Blind marketplace

- Customer sees own billing legal name on PI
- Seller sees own company legal name
- Admin sees both orgs
- Counterparty phone/email not exposed on finance APIs

## Error codes

`CREDIT_NOT_AVAILABLE` (409), `CREDIT_LIMIT_EXCEEDED` (400), `UTR_ALREADY_USED` (409), `PAYMENT_ALREADY_VERIFIED` (409), ownership 403/404 variants.

## Limitations

- Payment proof R2 upload endpoint deferred (`metadata.proofDocumentId` reserved)
- Tax invoice stays DRAFT (no auto-issue)
- Settlement deductions default to 0
- No payment gateway charge flow yet
