# Catalogue / Live Listing Count Reconciliation  
**Date:** 9 Nov 2026  
**Database:** local Docker Postgres `localhost:5433/swaroop` (schema present; counts match client catalogue target)  
**Reports:** `tmp/catalogue-dry-run/`

## Counting policy (agreed)

| Label | SQL rule |
|-------|----------|
| **Customer catalogue grades** | `grades.deleted_at IS NULL AND status = 'ACTIVE' AND customer_visible = true` |
| **Seller catalogue grades** | `grades.deleted_at IS NULL AND status = 'ACTIVE'` (includes non-customer-visible) |
| **Live listings** | `offers.deleted_at IS NULL AND status = 'ACTIVE' AND (visibility IS NULL OR visibility = 'MARKETPLACE') AND validity window` |
| **Live listings (price-sane)** | Live listings **and** `base_price >= COMMERCE_FREIGHT_PER_MT` (default 1250) |

Do **not** hardcode 3,748 / 124 in UI. Derive from these rules.

## Actual counts (after soft-pause cleanup)

| Metric | Client expected | Actual (this DB) | Match? |
|--------|-----------------|------------------|--------|
| Customer catalogue grades | 3,748 | **3,748** | Yes |
| Seller active grades | 3,750 | **3,752** | No — delta **+2** |
| Live listings | 124 | **62** (was 64 before pause) | No — delta **-62** |
| Live listings price-sane | — | **62** | — |

### Why seller is 3,752 not 3,750

Active grades with `customer_visible = false` (4 rows):

| Code | Display name |
|------|----------------|
| `PP_UNFILLED` | PP Unfilled |
| `ABS_REGRIND_IMPORTED` | Imported ABS Regrind |
| `ISOCYANATES` | Isocyanates |
| `AMINE` | Amine |

Customer count = 3752 − 4 = **3748**.  
If a seller UI previously showed 3750, it was either a stale snapshot or an extra filter (not present in current ACTIVE set). **Do not fake 3750.** Prefer showing derived `ACTIVE` count (3752) or document the filter.

### Why live listings are 62 not 124

This database currently has only **62** ACTIVE marketplace offers in the validity window after removing 2 below-freight demo offers. Possible explanations for client “124”:

1. Different environment / older snapshot when more offers were live.
2. Counting buyable **product cards** plus something else (buyable products here ≈ 53).
3. Including PAUSED / DRAFT / expired offers.

**Action:** Treat **62** as the truthful live count for this DB. If production DigitalOcean has a different `DATABASE_URL`, re-run:

```bash
DATABASE_URL='<prod>' node scripts/dry-run-catalogue-cleanup.mjs
```

## Soft cleanup applied (no hard deletes)

| Offer | Ref | Price | PR item refs | Action |
|-------|-----|-------|--------------|--------|
| Demo HDPE Film | `OFFER-2026-000001` | ₹95/MT | 135 | **PAUSED** + `needsPriceReview` metadata |
| HD Film SKR | `OFFER-2026-586744` | ₹200/MT | 1 | **PAUSED** + `needsPriceReview` metadata |

- Purchase request / quote history **preserved**.
- Script: `scripts/pause-suspicious-marketplace-offers.mjs --apply`
- Result JSON: `tmp/catalogue-dry-run/pause-suspicious-offers-result.json`

## ABS EXTRUSION 3000D ₹10/MT

**Not present** in this database (0 rows matching 3000D @ ₹10). Either already removed or never loaded into this instance. Marketplace code still excludes `base_price < freight` from customer listings.

## Test-data search (this DB)

| Item | Result |
|------|--------|
| E2E Bulk Pricing Test (cart) | **Not found** |
| Support ticket `scxsxcsc` | **Not found** (0 support tickets) |
| Nylon draft ₹20,000/KG | **Not found** (Nylon offers are MT-priced commercially) |

## Duplicate grade candidates

Heuristic groups written to `tmp/catalogue-dry-run/duplicate-grade-candidates.json` (**6** tight groups by maker+normalized gradeNo).  
Many near-name pairs are **legitimate** variants (e.g. different applications). **No merge/delete performed.** Requires commercial review before soft-deactivating any grade that has offer/order links.

## Scripts

```bash
# Read-only report
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/swaroop?schema=public \
  node scripts/dry-run-catalogue-cleanup.mjs

# Soft-pause below-freight ACTIVE offers
DATABASE_URL=... node scripts/pause-suspicious-marketplace-offers.mjs          # dry-run
DATABASE_URL=... node scripts/pause-suspicious-marketplace-offers.mjs --apply  # write
```
