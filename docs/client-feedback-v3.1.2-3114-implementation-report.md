# PolyStoreX Client Feedback Implementation Report  
## Android build v3.1.2 (3114) — Customer, Seller, Admin & Backend

**Date:** 9 Nov 2026  
**Scope:** SWAROOP (Expo), Swaroop-Customer-WEBAPP, Swaroop-seller-Webapp, Swaroop-ADMIN, Swaroop-Backend  
**Status summary:** P0 commercial/transaction fixes implemented in code; several P1/P2 items implemented; production DB cleanup and Maps/Play Console remain client-blocked.

---

## A. Summary

| Area | What was broken | Root cause | What changed | Now working |
|------|-----------------|------------|--------------|-------------|
| ABS ₹10/MT Best Value | Suspicious test price live + default Best Value badge | No marketplace price floor; badge defaulted regardless of review flag | Marketplace excludes offers below freight/min floor; activate/resume blocked for review prices; Best Value only when eligible | Invalid ₹10/MT offers no longer appear as live Best Value |
| Order progress | UI showed ~81% / Delayed while bar stayed at Placed | Client hardcoded `IN_TRANSIT: 81` and rewrote API progress | Progress prefers backend `%`; stage maps aligned to STAGE_PERCENT (10/25/45/60/75/100) | Progress % matches backend stage when API present |
| Add to cart | Perceived lack of confirmation | Already partly fixed; success depended on server | Confirmed server-first add + toast + badge update (Expo/Web) | Success only after server cart write |
| Checkout accidental submit | Verify button immediately under Proceed | Same viewport / no confirm step | Two-step confirm dialog (Review → confirm) on web + mobile | Explicit confirmation before PR submit |
| Seller GST/PAN Verified blank | Boolean `gstVerified` without identifier | Profile summary + UI ignored empty GSTIN/PAN | Verified requires flag **and** non-empty ID; UI shows Not added | Empty IDs cannot show Verified |
| KG/MT | Seller detail labeled `/kg` for MT prices | Label bug | Seller product detail shows `/MT` | Units consistent on that surface |
| Blind marketplace TAITA | Maker leaked under title / in name | Incomplete sanitize / nested grade manufacturer | Strip known makers from names; force PRIVATE manufacturer in customer mappers | Buyer cards use PRIVATE; names sanitized |
| PVC search / chips | “0 grades” + unrelated chips | CategoryId applied during search; chips switched to all categories | Search ignores prior category; chips sync to result set; count falls back to loaded hits | Search count/chips stay coherent |
| Filters | Sort counted as filter; no location; origin aliases | `countActiveMarketFilters` included sort | Sort excluded; location facet added; IN→India normalize | Filters N reflects filters only |
| Seller analytics / My Offers | Mock 128 / ₹3.8Cr; 63 live vs empty list | Mock analytics; org summary vs location list | Analytics from live APIs/empty state; location-scoped offer KPIs | No fabricated analytics; counts match list scope |
| Warehouse Continue | Silent block | Missing field messaging | Inline validation + empty warehouse CTA | User sees why Continue is blocked |
| Quality / TDS tick | Tick with no document | Default “GST Compliant” badge | Tick/badges only when docs exist; copy “not available yet” | No false quality documentation signal |

---

## B. Per-issue tracker

### 1. TDS – Technical Data Sheets
- **Issue:** Unavailable TDS + Quality Documentation tick with no file.
- **Root cause:** Default quality badges; files not yet supplied by client.
- **Changes:** Quality card/docs gated on real documents; TDS unavailable copy updated; Admin TDS upload/sync workflow already present (`admin/tds`, importer, R2 sync).
- **Tests:** Existing `grade-tds.spec.ts` (not re-run this session for full suite).
- **Status:** Partially Completed — workflow ready; **~550 PDFs still required from client**.

### 2. Customer search – PVC results and category chips
- **Issue:** “0 grades for PVC” + ACETONE/ALKYL/BOPP chips.
- **Root cause:** `categoryId` filter during free-text search; `allMarketCategoryChips` while searching.
- **Changes:** `market-screen.tsx` search filters + chip sync + count fallback.
- **Tests:** Market filter unit tests updated (sort/count/origin).
- **Status:** Completed (code); needs device verification against live Grade Master.

### 3. Commercial pricing – ABS EXTRUSION 3000D ₹10/MT
- **Issue:** ₹10/MT Best Value.
- **Root cause:** Active offer below freight; no hard marketplace gate; Best Value default.
- **Changes:** `assessMaterialPriceReview` + min/max env; `marketplaceEligiblePriceWhere`; activate/resume hard gate; Best Value eligibility; admin price correction path retained.
- **Tests:** `commerce-pricing.spec.ts` — **passed** (incl. ₹10 review + eligibility).
- **Status:** Completed for marketplace visibility. **Production offer deactivation** needs DB access (local Postgres refused connection). Dry-run script ready: `scripts/dry-run-catalogue-cleanup.mjs`.

### 4. Duplicate listings and catalogue counts
- **Issue:** Repeated cards; 3748 vs 3750.
- **Root cause:** Possible true duplicates + different visibility filters (needs DB report).
- **Changes:** Dry-run script exists; frontend dedupe helpers already present.
- **Tests:** N/A (data).
- **Status:** Partially Completed — **blocked on production DB** (`ECONNREFUSED` localhost:5433). Do not hardcode 3748/124.

### 5. Customer filters – location, origin, manufacturer, scroll, count
- **Issue:** Missing location; origin overlap; PRIVATE-only manufacturers; sort counted as filter.
- **Root cause:** Facets incomplete; count included sort; PRIVATE is correct for blind marketplace.
- **Changes:** Location facet; origin normalize; filter count excludes sort; sheet sections added.
- **Tests:** `market-filters.test.ts` updated.
- **Status:** Completed (code). Manufacturer PRIVATE-only is expected under blind marketplace.

### 6. Order progress – remove static data
- **Issue:** Delayed 81% vs Placed bar.
- **Root cause:** Client `ORDER_STATUS_PROGRESS.IN_TRANSIT = 81`; seller mock `PT-ORD-8799`.
- **Changes:** Prefer API progress; align maps to backend stages; web fallback 10 not 25.
- **Status:** Completed (code). Order `PT-PO-8799` not found in repos (only seller mock `PT-ORD-8799`).

### 7. Checkout accidental purchase requests
- **Issue:** Verify under Proceed tap location.
- **Changes:** Confirm dialog / Review & place request two-step; existing idempotency retained.
- **Status:** Completed (code).

### 8. Leftover test data
- **Issue:** E2E Bulk Pricing Test, ticket scxsxcsc, Nylon 20,000/KG.
- **Findings:** No E2E Bulk Pricing fixture in code; `SCXSXCSC` filtered in mobile junk ticket IDs; Nylon draft needs DB.
- **Status:** Partially Completed — **DB cleanup blocked** (no live Postgres).

### 9. Seller WebApp – GST/PAN, analytics, offers, KG/MT, warehouse
- **Changes:** Profile/verification consistency; analytics un-mocked; offer summary location-scoped; `/MT` label; warehouse validation messaging.
- **Status:** Completed (code).

### 10. Blind marketplace – hide TAITA
- **Changes:** Stronger `sanitizeBlindDisplayName`; customer mappers force PRIVATE.
- **Tests:** `blind-marketplace.mapper.spec.ts` — **passed**.
- **Status:** Completed (code); verify live network payloads on device.

### 11. Add to cart confirmation
- **Status:** Completed — server success → toast → cart replace (already present; confirmed).

### 12–14. Google Maps / Package ID / Play Console
- **Package:** `com.swaroop.app` (unchanged — needs client approval to change).
- **API in EAS:** `https://swaroop-backend-xzwkz.ondigitalocean.app/api/v1` for preview **and** production profiles — confirm whether this is approved production.
- **Maps:** `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` **missing from `eas.json` env**; must be EAS secret + Google Cloud billing for `it@polystorex.com`.
- **Status:** Blocked on client Google Cloud / Play Console / package ID confirmation.

---

## C. Database cleanup

Executed against local Docker Postgres `localhost:5433/swaroop` (customer catalogue **3,748** matches client target).  
Details: [`catalogue-count-reconciliation-2026-11-09.md`](./catalogue-count-reconciliation-2026-11-09.md), artifacts in `tmp/catalogue-dry-run/`.

| Item | Status |
|------|--------|
| Duplicate analysis report | **Generated** — 6 heuristic groups; no merges |
| Customer catalogue | **3,748** (matches expected) |
| Seller active grades | **3,752** (client said 3,750; +2) |
| Live listings | **62** after cleanup (client said 124 — discrepancy reported, not hardcoded) |
| Below-freight offers | Soft-**PAUSED** `OFFER-2026-000001` (₹95, 135 PR refs) + `OFFER-2026-586744` (₹200) |
| ABS ₹10 / 3000D | **Not present** in this DB |
| Test cart / junk ticket / Nylon 20k/KG | **Not present** in this DB |
| Hard deletes | **None** — PR/order history preserved |
| DigitalOcean managed DB URL | Not separately wired; re-run scripts if prod differs from local |

---

## D. Remaining client dependencies

1. **~550 TDS PDFs** from Source.One for bulk import.
2. **Google Cloud** (`it@polystorex.com`): billing, Maps SDK keys, Android SHA-1/256 + package restriction, EAS secret `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`.
3. **Confirm production API URL** (currently DigitalOcean `swaroop-backend-xzwkz` in all EAS production envs).
4. **Android package ID** confirmation (`com.swaroop.app` vs `com.polystorex.app`).
5. **Play Console** account, Play App Signing, store listing assets, Data Safety.
6. **Commercial price** for ABS EXTRUSION 3000D if a live offer must be corrected (not invented) — not found in this DB.
7. **Confirm whether DigitalOcean managed Postgres differs** from local `5433` for the live-listings “124” target; re-run dry-run against that URL if so.

---

## E. Build and release

| Field | Value |
|-------|--------|
| App version | 3.1.2 |
| Build number | 3114 |
| Package ID | `com.swaroop.app` |
| API environment (EAS production) | `https://swaroop-backend-xzwkz.ondigitalocean.app/api/v1` |
| Build command | `eas build --profile production-apk` (or `production` for AAB) |
| Build result this session | **Not generated** |
| Real-device test | **Not performed** this session |

---

## F. Remaining risks

- Production offer data not inspected (local DB unavailable).
- Catalogue count 3748/124 cannot be certified without DB.
- Maps not verified on release APK.
- Blind marketplace regression depends on all customer endpoints using `toBlindProduct` (Grade Master catalogue still exposes manufacturers by design for grade library).
- Seller analytics empty until real orders/settlements exist for the authenticated seller.

---

## Key files changed (non-exhaustive)

**Backend:** `commerce-pricing.ts`, `marketplace.service.ts`, `offers.service.ts`, `offers.controller.ts`, `seller-profile.summary.ts`, `blind-marketplace.mapper.ts`, `.env.example`  

**SWAROOP:** `market-filters.ts`, `market-screen.tsx`, `market-filter-sheet.tsx`, `catalog.ts`, `orderStatus.ts`, `orderWorkflow.ts`, `orders.ts`, checkout confirm modal, seller analytics/warehouse  

**Customer WEBAPP:** `catalog-mapper.ts`, quality card/product builder, checkout-flow confirm, `finance.ts`, TDS copy  

**Seller WEBAPP:** profile/verification, analytics store/service, offers summary scoping, product detail MT label, warehouse Continue validation  

---

## Tests executed this session

| Suite | Result |
|-------|--------|
| Backend `commerce-pricing.spec.ts` | Passed |
| Backend `seller-profile.summary.spec.ts` | Passed |
| Backend `blind-marketplace.mapper.spec.ts` | Passed |
| Combined above (35 tests) | **35 passed** |
| SWAROOP `market-filters.test.ts` | Not executed (local `tsx` binary unavailable in env) |

Do not treat unexecuted suites as passed.
