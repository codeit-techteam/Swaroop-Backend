# Import trading API (BUY requests and SELL offers)

Blind B2B import marketplace. Customers publish **BUY requests (RFQs)**, sellers
publish **SELL offers**, the backend scores deterministic matches, and the two
sides negotiate through an append-only event log until both confirm a deal.

All routes live under `/api/v1/import` (user) and `/api/v1/admin/import` (Admin).
Swagger groups them under the `Import - *` and `Admin - Import *` tags at `/docs`.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `IMPORT_FEATURE_ENABLED` | `true` | `false`/`0`/`no`/`off` disables every Import route except `GET /import/config` (returns `enabled: false`). Other routes answer `503 IMPORT_FEATURE_DISABLED`. The expiry worker also stops. |
| `IMPORT_EXPIRY_SWEEP_INTERVAL_MS` | `60000` | Interval (min 5000) of the background sweep that expires listings and negotiations and sends near-expiry notices. Disabled when `NODE_ENV=test`. |

Runtime settings are stored in `import_settings` (row `default`) and edited by
Admin: `matchWeights`, `minMatchScore` (default 60), `allowCustomGrade`,
`nearExpiryHours` (24), `negotiationTtlHours` (72).

### Master data seeding

Migration `20260930120000_import_trading` creates the schema only. Reference data
(currencies, Incoterms, countries, ports, brands, packaging, document
requirements, import payment terms, default settings) is seeded from
`prisma/seed-data/import-master-data.json`:

```bash
npm run import:seed-master      # safe on production: idempotent upserts
```

The seed never re-activates a record an Admin has disabled and never deletes
anything. `npm run prisma:seed` also runs it for local databases.

## Identity and security rules

- Buyer/seller identity, organisation, owner, status, reference number and
  price snapshots are always derived server-side from the JWT. Unknown body
  fields such as `ownerOrgId`, `status` or `sellerProfileId` are rejected with
  `400` by the global whitelist validation.
- BUY writes need the `CUSTOMER` role and a customer profile; SELL writes need
  the `SELLER` role and an **APPROVED** seller profile. Seller managers need
  the `import.view` / `import.manage` permission grants.
- **Blind marketplace:** market and counterparty views never include
  organisation, profile, user, email or phone. Counterparties appear as stable
  pseudonyms (`BUYER-XXXXXXXX` / `SELLER-XXXXXXXX`, a SHA-256 of side and org).
  Deal parties are revealed to each other only after **both** confirm.
- A listing is visible to a counterparty only while it is open and within its
  validity window, or while that counterparty has a negotiation on it.
  Everything else answers `404` (no existence leak).
- Negotiation events are immutable: a database trigger rejects `UPDATE` on
  `import_negotiation_events`.

## Reference numbers

Generated from Postgres sequences inside the creating transaction:
`IBR-YYYYMM-000001` (BUY), `ISO-…` (SELL), `INE-…` (negotiation), `IDL-…` (deal).

## Listing status machine

```
DRAFT ─publish─▶ PUBLISHED ─▶ MATCHING ─▶ OFFER_RECEIVED ─▶ NEGOTIATION ─▶ MATCHED ─▶ DEAL_CONFIRMED ─▶ PARTIALLY_FULFILLED ─▶ FULFILLED
   │                 │  ▲                                                     │
   └─cancel          ▼  │ resume (SELL)                                       └─ deal cancelled by Admin → NEGOTIATION
                   PAUSED
Any open or paused status → EXPIRED (validUntil passed) or CANCELLED (owner/Admin)
```

- Forward moves (matching, first offer, counter, accept, confirm) happen
  automatically; the listing never moves backwards except MATCHED → NEGOTIATION
  when Admin cancels an unconfirmed deal.
- Owner responses include `allowedTransitions`.
- Fields that define *what* is traded are frozen after publish (`FIELD_LOCKED`
  in `details`): category, grade, custom grade, brand, origin, currency,
  Incoterm, POL, POD, quantity unit, price unit. Price, quantity, shipment
  window, payment term and validity stay editable; counterparties with open
  negotiations are notified of price, shipment and payment-term changes.
- Edits require the current `version` (optimistic locking; stale versions
  answer `409 IMPORT_DRAFT_CONFLICT`).
- Expiry is enforced lazily on read and by the background sweep. Ending a
  listing closes its open negotiations and marks suggested matches `STALE`.

## Commercial rules

- Decimals are sent and returned as strings: quantity up to 3 dp, price up to 4 dp.
- `currency` must be an Admin-enabled import currency (USD first; EUR, CNY, INR
  controlled by Admin). The currency code is snapshotted on the listing.
- `gstApplicable` / `gstRate` are only accepted for INR.
- Payment terms are filtered by currency (`GET /import/master-data/payment-terms?currencyCode=USD`).
- Shipment window: `esd ≤ lsd` (`INVALID_SHIPMENT_WINDOW`). `estimatedEta` =
  shipment window + `transitDays` and is labelled an estimate; it is not
  logistics tracking.
- POL and POD must differ and be active ports.
- Master values (names/codes) are snapshotted at publish, so later Admin edits
  or disables never change a published listing.

## User endpoints

### Config and master data

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/import/config` | `{ enabled, serverTime }`; never feature-guarded. Clients hide Import navigation when disabled. |
| GET | `/import/summary` | Counts for the caller's buyer and/or seller side. |
| GET | `/import/master-data` | Bundle: currencies, default currency, Incoterms, packaging, document requirements, countries, payment terms, `allowCustomGrade`, enums. |
| GET | `/import/master-data/products` · `/grades?categoryId=&search=&page=` · `/brands` · `/ports?countryId=&search=` · `/countries` · `/payment-terms?currencyCode=` | Active records only. |

### BUY requests — `/import/buy` (writes: CUSTOMER)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/import/buy` | Create draft (all fields optional; `source: WEB\|MOBILE`). |
| GET | `/import/buy?scope=mine\|market` | `mine` = own requests; `market` = open BUY requests for sellers (blind). Filters: `status[]`, `categoryId`, `gradeId`, `brandId`, `originCountryId`, `incotermId`, `polId`, `podId`, `currencyCode`, `priceMin/Max` (requires `currencyCode`), `quantityMin/Max` (MT), `shipmentFrom/To`, `createdFrom/To`, `search`, `page`, `limit`, `sortBy`, `sortOrder`. |
| GET | `/import/buy/:id` | Owner: full view + stats. Counterparty: blind view + `myNegotiation`. |
| PATCH | `/import/buy/:id` | Autosave / edit; requires `version`. |
| DELETE | `/import/buy/:id` | Drafts only (soft delete). |
| POST | `/import/buy/:id/publish` | Header `Idempotency-Key` (8–128 chars) recommended. |
| POST | `/import/buy/:id/cancel` | Body `{ reason }`. |
| POST | `/import/buy/:id/expire` | Owner ends validity now. |
| GET | `/import/buy/:id/matches` | Scored SELL offers with evidence (blind). |
| POST | `/import/buy/:id/matches/:matchId/dismiss` | |

### SELL offers — `/import/sell` (writes: SELLER, approved)

Same endpoints as BUY (the market scope lists open SELL offers to buyers), plus
`POST /import/sell/:id/pause` and `POST /import/sell/:id/resume`.

### Listing documents — `/import/listings/:listingId/documents`

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/` | Owner requests a signed R2 upload URL (`category`, `fileName`, `mimeType`, `fileSizeBytes`). |
| POST | `/:documentId/confirm` | Owner confirms upload. |
| GET | `/` | Owner, or a counterparty with an OPEN/AGREED negotiation. Uploader identity is removed. |
| GET | `/:documentId/download` | Signed download URL, same access rule. |
| DELETE | `/:documentId` | Owner only (soft delete). |

### Negotiations — `/import/negotiations`

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/` | Open: `{ listingId, counterListingId?, price, quantity, moq?, paymentTermId?, esd?, lsd?, inspectionType?, otherTerms?, note? }`. Buyers respond to SELL offers, sellers to BUY requests. Currency, Incoterm and units are fixed from the listing. One open negotiation per pair. `Idempotency-Key` supported. |
| GET | `/` | Own negotiations; filters `status`, `listingId`, `page`, `limit`. |
| GET | `/:id` | Event timeline, `fixedTerms`, `allowedActions`. |
| POST | `/:id/counter` | Strict turn-taking; max 30 rounds; `Idempotency-Key` supported. |
| POST | `/:id/accept` | Accepts the last counterparty terms → negotiation `AGREED`, deal created in `PENDING_CONFIRMATION` with the acceptor already confirmed. |
| POST | `/:id/reject` · `/:id/withdraw` | Optional `{ note }`. |

Negotiations expire after `negotiationTtlHours`, capped at the listing's
`validUntil` (`OFFER_EXPIRED`).

### Deals — `/import/deals`

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` · `/:id` | Own deals; identities hidden until both confirm. |
| POST | `/:id/confirm` | Second confirmation → `CONFIRMED`, listings → `DEAL_CONFIRMED`. `Idempotency-Key` supported. |

## Admin endpoints — `/admin/import`

Read: `ADMIN`, `SUPER_ADMIN`, `OPERATIONS_MANAGER`, `PROCUREMENT_MANAGER`.
Write: `ADMIN`, `SUPER_ADMIN`. Every write is audited.

| Method | Path | Notes |
| --- | --- | --- |
| GET/POST | `/master-data/:entity` | `entity` ∈ `currencies`, `incoterms`, `brands`, `ports`, `packaging`, `document-requirements`, `countries`. Codes validated (ISO 4217, UN/LOCODE, ISO-3166 alpha-2). |
| PATCH | `/master-data/:entity/:id` | |
| POST | `/master-data/:entity/:id/activate` · `/deactivate` | Soft enable/disable; published listings keep their snapshot. |
| GET/PATCH | `/settings` | Match weights (known criteria only, non-negative), min score, TTLs, custom-grade toggle. |
| GET | `/dashboard` | Counts by side/status, confirmed volume (MT), confirmed value per currency (never summed across currencies), top products, recent listings. |
| GET | `/listings` · `/listings/:id` | Full identity; detail includes negotiations with events, matches, deals, documents and audit trail. |
| POST | `/listings/:id/status` | `PAUSED` · `PUBLISHED` · `CANCELLED` · `EXPIRED` with `reason`. |
| POST | `/listings/:id/rematch` | Recompute matches now. |
| GET | `/negotiations` · `/negotiations/:id` · `/matches` | |
| GET | `/deals` · `/deals/:id` | |
| POST | `/deals/:id/status` | `CANCELLED` (MATCHED listings return to NEGOTIATION) · `PARTIALLY_FULFILLED` · `FULFILLED`. |

## Matching

Deterministic rule scoring, recomputed on publish, relevant edits and Admin
rematch. It is not AI. Candidates: opposite side, same product category, open,
not expired, different organisation (up to 500 per run).

| Criterion | Default weight | Matched when |
| --- | --- | --- |
| PRODUCT | 15 | Same category |
| GRADE | 15 | Same grade (or same custom grade text) |
| BRAND | 5 | Same brand |
| ORIGIN | 5 | Same origin country |
| QUANTITY | 10 | Seller quantity ≥ buyer minimum acceptable quantity |
| MOQ | 5 | No MOQ, or MOQ ≤ buyer maximum acceptable quantity |
| PRICE | 10 | Offer price ≤ target, **only** when currency, Incoterm and price-basis location are identical; otherwise "not comparable" |
| CURRENCY | 5 | Same currency |
| INCOTERM | 5 | Same Incoterm |
| POL / POD | 5 / 5 | Same port |
| PAYMENT_TERMS | 5 | Same payment term |
| SHIPMENT_WINDOW | 5 | Windows overlap |
| QUALITY | 5 | Inspection requirement offered and all required documents offered |

`matchScore` = matched weight ÷ total weight × 100 (2 dp). Matches at or above
`minMatchScore` are stored as `SUGGESTED` with `matchedCriteria`,
`unmatchedCriteria`, per-criterion evidence, the weights used and
`algorithmVersion` (`import-match-v1`). Matches that fall below the threshold,
or whose listings close, become `STALE`.

## Errors

Import errors return `{ code, message, details? }`. For validation errors
`details` is an array of `{ field, code, message }` (`code` may also be
`REQUIRED` or `FIELD_LOCKED`). Stack traces are never returned.

| HTTP | Codes |
| --- | --- |
| 400 | Global validation (unknown or malformed fields) |
| 403 | `IMPORT_UNAUTHORIZED`, `IMPORT_PROFILE_REQUIRED`, `IMPORT_ACCOUNT_NOT_APPROVED` |
| 404 | `IMPORT_NOT_FOUND`, `NEGOTIATION_NOT_FOUND`, `DEAL_NOT_FOUND` |
| 409 | `IMPORT_ALREADY_PUBLISHED`, `IMPORT_ALREADY_EXPIRED`, `IMPORT_INVALID_STATUS_TRANSITION`, `IMPORT_DRAFT_CONFLICT`, `DUPLICATE_REQUEST`, `NEGOTIATION_NOT_ALLOWED`, `OFFER_EXPIRED`, `IMPORT_MASTER_CONFLICT` |
| 422 | `IMPORT_VALIDATION_FAILED`, `INVALID_SHIPMENT_WINDOW`, `INVALID_QUANTITY`, `INVALID_PRICE`, `INVALID_CURRENCY`, `INVALID_INCOTERM`, `INVALID_PAYMENT_TERM`, `INVALID_PORT`, `INVALID_MASTER_REFERENCE` |
| 503 | `IMPORT_FEATURE_DISABLED` |

## Idempotency

Publish, open negotiation, counter, accept and confirm deal accept an
`Idempotency-Key` header. The first result is stored in the same transaction as
the action; a retry with the same key by the same user returns the stored
result. Keys are scoped per user and action.

## Notifications and audit

- Notifications are delivered **in-app only** today (the platform has no email,
  SMS, WhatsApp or push dispatcher yet). Events: match found, response and
  counteroffer received, counteroffer accepted/rejected, negotiation withdrawn,
  deal confirmation required, deal confirmed, price/shipment/payment-term
  changed, listing near expiry, listing expired. Users who muted an event key
  for `IN_APP` are skipped.
- Audit actions (`admin_audit_logs`, read-only to users): `IMPORT_BUY_*` and
  `IMPORT_SELL_*` (created, updated, published, paused, resumed, cancelled,
  expired, deleted), `IMPORT_LISTING_STATUS_CHANGED_BY_ADMIN`, document
  uploaded/deleted, negotiation started, counteroffer created/accepted/rejected,
  negotiation withdrawn/expired, deal party confirmed, `IMPORT_DEAL_CONFIRMED`,
  deal status changed by Admin, matches recomputed, master data
  created/updated/status changed, settings updated.

## Future intake (AI / WhatsApp)

`ImportExtractor` is an abstract provider bound to `UnavailableImportExtractor`
(reports `available: false`; no endpoint uses it yet). A future implementation may prefill a draft
from free text or a document. Listings already store `source` and `rawInput`.
Extracted drafts must still pass the same validation and publish flow; nothing
is auto-published.

## Tests

- Unit: `src/modules/import/domain/import-domain.spec.ts` (status machine,
  validation, decimals, ETA, matching) and `src/modules/sellers/managers/*.spec.ts`.
- E2E: `test/import-trading.e2e-spec.ts` (needs a migrated and seeded database):

```bash
DATABASE_URL=postgresql://… npx vitest run --config ./vitest.config.e2e.ts test/import-trading.e2e-spec.ts
```
