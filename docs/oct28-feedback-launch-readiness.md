# PolyStoreX — Oct 28 client feedback: implementation and launch readiness

Status date: 2026-10-31. No secret values appear in this document.

## A. What was implemented

| Part | Change | Where |
| --- | --- | --- |
| 2 New Grade Request | Backend module (customer + admin APIs, attachments, notifications, idempotency, duplicate and catalogue-match guards), migration `20261031120000_new_grade_requests`. Customer web, customer mobile (form, list, detail, respond/cancel, notifications deep link), admin "Grade Requests" workbench (assign, status, request info, notes, map to grade, create grade). Sellers have no route or API. | Backend `src/modules/grade-requests`; Customer web `components/grade-requests`; mobile `src/screens/grade-requests`; Admin `app/(admin)/grade-requests` |
| 3 Search | One backend search: normalisation, tokens, aliases (TiO2 / TIO / titanium dioxide, PP, HDPE, ...), partial codes (4811, F4811), manufacturer, ranking tiers, pagination, `meta.query` echo. Grades without live offers stay discoverable with `hasLiveOffers=false`. Visibility filter is re-applied when the page is hydrated, so no unpublished grades and no supplier identity. Clients already debounce, keep previous data, show loading/empty/retry and paginate. | Backend `grade-search.ts`, `marketplace.service.ts` |
| 4 Category display | Backend labels are authoritative; admin `displayName` edit is validated (no underscores or UUIDs). Audit script prints the current mapping for the client to confirm. The final mapping is NOT guessed. | `scripts/report-category-labels.ts` (`npm run catalog:labels-audit`) |
| 5 Label | "Pending PRs" → "Pending Purchase" (display only). It only existed on seller dashboards. | seller mobile and web |
| 6 Addresses | Real saved-address CRUD already existed on both clients. Removed the hardcoded Jamnagar / Mumbai / Hazira / Mundra checkout addresses and fake "2–3 Business Days" ETA on mobile; post-checkout screens now use the address the customer actually selected (empty state if none). Removed the unreachable web PR form that listed mock hubs. Backend: city and state must be real place names (letters), pincode regex already enforced. Maps unavailable → manual entry fallback already present on both clients. | mobile `checkout-store`, `constants/checkout`, `constants/cart`; web `components/purchase-requests`; backend `address-book.dto.ts` |
| 7 OTP | Hash-only OTP storage, no plaintext logging, fail-closed fixed-OTP bypass in production, hourly send cap, cooldown, retry limits, env validation. | Backend `auth` module |
| 8 Support and links | Single source: `GET /public/legal-links` fed by `PUBLIC_*` env. Customer web no longer ships invented phone numbers, hours, a BKC office address or `support@petrotrade.com`; the Help dialog now sends a real enquiry (`POST /public/enquiries`) instead of a fake "Message sent" toast; the Help Center shows only backend-configured contacts. `.env.example` documents the polystorex.com cut-over. | web `lib/legal-links.ts`, `components/onboarding/HelpCard.tsx`, `components/support/ContactInfoCard.tsx` |
| 9 Verification of "fixed" items | See section C. | |
| 10 Env/security | See section D. | |
| 11 Admin | Grade Requests module integrated in nav, permissions and status badges. | Admin |

## B. Tests and builds run

| Repo | Result |
| --- | --- |
| Backend | `vitest`: 78 files, 592 tests pass. `nest build` OK. |
| Customer web | `tsc`, `next build` OK. |
| Seller web | `tsc`, `next build` OK. |
| Admin | `next build` OK. |
| Mobile | `tsc` clean. 123 `node:test` tests pass, including grade-request validation (9) and tier validation (7). Lint on touched files is at baseline (pre-existing prettier/import-order errors remain in untouched code). |
| Website | Not changed by this work. |

Not run: any test against real MSG91, real Google Maps, real storage (R2), or a real database. No browser or device E2E was run.

## C. Part 9 — claimed fixes, verified

| Claim | Finding |
| --- | --- |
| Active Offers link | Seller web dashboard KPI had no link. Fixed (also Purchase Requests, Orders, Dispatch, Settlements cards). |
| Currency dropdown / CNY | `CNY` exists in the DB enum. The backend type error was fixed. Clients do not hard-code currency lists. |
| Input validation | Mobile offer editor: tier minimum quantity must be above 0, max at least min, price above 0, discount 0–99.99; decimal sanitising on price/MOQ/tier fields. Backend tier DTO now rejects non-positive `minQty` and `price`. |
| KYC status | Customer web "Verified Enterprise" badge was unconditional. It now shows only when GST is verified. Seller onboarding no longer marks the bank as `isVerified: true`. |
| Drafts / publish alignment / filters | Mobile offer editor no longer pre-fills sample price (145), MOQ (25), remarks, or three fake bulk tiers, one with minimum 0, which the backend rejects. |
| MOQ | Backend omits `moq` when it is 0; the mobile field is now decimal-safe. |
| Seller login back arrow | Present and wired on mobile `SellerLoginScreen`; seller web verify-OTP page has a working back link. |
| Search log error | Not reproducible: there is no search-logging code path in the backend. |

## D. Part 10 — security audit

- No `.env`, key, or keystore file is tracked in any of the six repos. `.env*` is git-ignored everywhere.
- **Backend `.env.bak` was committed in the initial commit** and contained `DATABASE_URL`, `JWT_SECRET` and Cloudflare R2 credential entries (values not inspected or printed). It is now removed from the tree (staged deletion), but **it remains in git history on the GitHub remote.** Rotate those four credentials and purge history (`git filter-repo --path .env.bak --invert-paths`, then force-push and have everyone re-clone) before launch.
- No AIza-pattern Google keys, AWS keys, private keys or Slack tokens are in any tracked file.
- Treat the Google Maps key shared during the meeting as exposed: create a new key, restrict it (see below), delete the old one.
  - Server key (`GOOGLE_MAPS_SERVER_API_KEY`): IP-restricted; Places API (New) and Geocoding API only.
  - Web key (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`): HTTP-referrer-restricted; Maps JavaScript API only.
  - Add a budget alert and daily quota cap.
- CORS: production still allows any `*.vercel.app` / `*.ondigitalocean.*` origin. Added `CORS_ALLOW_PLATFORM_HOSTS` (default true to avoid breaking the live deploy) and a startup warning. For launch, list exact origins in `CORS_ORIGINS` and set it to `false`.
- Client `.env` files contain no backend secrets.

## E. Remaining risks and honest gaps

1. **Real SMS delivery is unverified.** The code path and DLT template wiring are tested only against mocks. Do not call OTP production-ready until a real SMS arrives on a real handset with the DLT-approved template.
2. **Google Maps is not confirmed active.** The $3,000 billing issue is external. With no key, the clients fall back to manual address entry.
3. **Mobile map-pin picker is not built.** `react-native-maps` is not installed; adding it needs a native dependency, a dev build and a restricted key. Mobile has autocomplete, GPS and manual entry. Web has a map picker.
4. **Category mapping is unconfirmed.** `npm run catalog:labels-audit` needs a database connection, which was not available here. Run it against production data and send the output to the client.
5. **polystorex.com pages are unverified.** I could not confirm `/terms`, `/privacy` or `/contact` exist, so defaults still point to the deployed site. `support@polystorex.com` is not set anywhere until the mailbox is confirmed.
6. **Brand audit (no rebrand, per the brief).** "PetroTrade" still appears in dozens of backend user-facing strings (credit, KYC and checkout notifications, payment labels), the website-link remap list, a PDF filename in the web app, and export file names in Admin. Customer web still has legacy mock modules (documents, orders-catalog, some ETA heuristics) with sample company data.
7. **Search:** the admin grade search and import matching still use the older search function.
8. **Mobile seller "Create offer" screen** still shows a hardcoded warehouse card and "Last Updated: 2 mins ago", and the hidden stock quantity defaults to 500.
9. **No automated UI or E2E tests** exist for the new web forms; customer web and Admin have no unit test runner.

## F. External blockers (need the client or third parties)

| Blocker | Owner |
| --- | --- |
| MSG91 account, DLT template ID, sender ID and a live SMS test | Client + MSG91 |
| Google Maps billing and a new restricted key | Client |
| Final customer-facing category names | Client |
| polystorex.com DNS/pages live; support@polystorex.com mailbox | Client / DNS |
| Credential rotation and git-history purge for the leaked `.env.bak` | Repo owner |
| Admin credentials for the production smoke test of Grade Requests | Client |
