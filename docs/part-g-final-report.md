# Part G — Final implementation report

**Generated:** 2026-10-22  
**Excel/PDF 48-issue list:** **Not found** in workspace or Downloads (no `*48*`, `*feedback*`, `*issue*` xlsx/pdf for Swaroop client list). Report maps work to prompt Parts A–E / features 17–23 and known prior items, **not** original Excel IDs.

---

## 28. Automated tests (executed)

Framework: Vitest (Swaroop-Backend).

| Suite | Result |
|-------|--------|
| Full backend `npx vitest run` | **66 files, 431 passed** |
| Part G focus (cart, OTP prod, pricing/₹/kg, estimate, price-alerts, guest public controller, TDS, finance errors, settlements, notifications) | **10 files, 39 passed** |

New/updated specs include: `marketplace-estimate.spec.ts`, `price-alerts.service.spec.ts`, `public-marketplace.controller.spec.ts`, `grade-tds.spec.ts`, `finance.errors.spec.ts`, extended `commerce-pricing.spec.ts`, existing `auth.otp-production.spec.ts`, `cart-validation.spec.ts`, `settlement-calculation.service.spec.ts`.

**Not claimed as passed:** frontend E2E, staging API integration, device smoke.

---

## 29. End-to-end acceptance (A–K)

**All scenarios: NOT RUN** in this session. Tracker: `docs/part-g-acceptance.md`.  
Do not treat unit coverage as acceptance pass.

---

## 30. Build / APK

| Item | Value |
|------|--------|
| Method | EAS Build profile `preview` (APK) |
| Package | `com.swaroop.app` |
| Version | `3.0.1-rc2` |
| Build number | `1` |
| EAS build ID | `2020f2ec-d6c2-4c33-af9f-c5f4044476c2` |
| Install page | https://expo.dev/accounts/sumit.codeit1/projects/swaroop/builds/2020f2ec-d6c2-4c33-af9f-c5f4044476c2 |
| Artifact URL | https://expo.dev/artifacts/eas/DSREBWPNj4nErCnIkddQ0c4Wjp2YIcdSTZExHYEAFwY.apk |
| Local RC path | `/Users/sumit/Desktop/SWAROOP/artifacts/rc/Swaroop-3.0.1-rc2.apk` |
| Prior APK preserved | `/Users/sumit/Desktop/SWAROOP/artifacts/previous/Swaroop-v3.0.apk` (copy of Downloads `Swaroop-v3.0.apk`) |
| API base in profile | `https://swaroop-backend-xzwkz.ondigitalocean.app/api/v1` |
| OTP bypass in APK | Production env flags rejected by backend validation; preview profile uses `EXPO_PUBLIC_APP_ENV=production` |
| Install + smoke on device | **NOT EXECUTED** here |

---

## 31. LambdaTest

**Upload not performed.**

| Check | Result |
|-------|--------|
| `LT_USERNAME` / `LT_ACCESS_KEY` in env | Not set |
| LambdaTest CLI | Not installed |
| Project LambdaTest config | None found |

**To complete upload:**  
1. Provide `LT_USERNAME` + `LT_ACCESS_KEY` (do not commit).  
2. Upload APK:  
   `curl -u "$LT_USERNAME:$LT_ACCESS_KEY" -X POST "https://manual-api.lambdatest.com/app/upload/realDevice" -F "appFile=@/Users/sumit/Desktop/SWAROOP/artifacts/rc/Swaroop-3.0.1-rc2.apk" -F "name=Swaroop-3.0.1-rc2"`  
3. Return the API `app_url` / app ID to the client.

**Artifact for manual upload:** `/Users/sumit/Desktop/SWAROOP/artifacts/rc/Swaroop-3.0.1-rc2.apk`

---

## 32. Git / deploy

### Commits pushed

| Repo | Branch | Commit |
|------|--------|--------|
| Swaroop-Backend | `main` | `625a42426aa20a6c14bb40116518680b1b4256a0` |
| SWAROOP (Frontend app) | `main` | `e487a41393a4779ed978f241f725c3656a1a24fd` |
| Swaroop-Customer-WEBAPP | `skr-c0der` | `2f64b0dcb8293de142edb9b1493bc8113244bda0` |
| Swaroop-seller-Webapp | `main` | `46fea9cf5755cde23632bfd8c3364baf47da3eaf` |
| Swaroop-ADMIN | `main` | `0303d7944efa77ec30cf90006695330831db6c2c` |
| Swaroop-Website | — | No Part E/G changes |

### Deploy

| Target | Result |
|--------|--------|
| DigitalOcean backend | **Not triggered from this session** (no DO deploy credentials/action run). Push to `main` may auto-deploy if App Platform is wired to GitHub — **not verified**. |
| Vercel web apps | **Not triggered / not verified**. Customer web is on branch `skr-c0der` (confirm Vercel production branch). |
| DB migration `20261022130000_price_alerts` | **Not applied** from this session — apply on staging/prod via approved migrate path before relying on price alerts. |

---

## Features / fixes covered (prompt Parts; Excel IDs unavailable)

| Area | Root cause (summary) | Fix |
|------|----------------------|-----|
| Guest marketplace | Protected-only catalog | Public `/public/marketplace/*` + client guest browse + auth for mutations |
| ₹/kg calculator | Missing decimal MT÷1000 estimate | `pricePerKgFromMt` + `pricing/estimate` + UI |
| TDS | No grade TDS surface | `grades/:id/tds` + download via signed product doc URL |
| Price alerts | Missing | CRUD + migration; evaluation worker deferred (`docs/price-alerts.md`) |
| RFQ | Parallel RFQ risk | Reuse purchase request + login return |
| Order tracking | Demo timelines | Real timeline/events; demo mode off |
| Invoice downloads | Fabricated PDFs | Signed URL when vaulted; else unavailable |
| OTP prod bypass | Dev flags | Env validation + `auth.otp-production.spec.ts` |
| Import USD / sync / shipment | Prior Part C | Listing currency/validUntil, shipment machine, admin deal status |
| Legal links / KYC | Prior Part D | Public legal-links; KYC SoT sync |

---

## Remaining blockers

1. **48-issue Excel/PDF** missing — cannot map original IDs/priorities.  
2. **E2E acceptance A–K** not executed on staging.  
3. **LambdaTest** credentials/CLI missing.  
4. **Price-alert evaluation worker** not built.  
5. **Invoice PDFs** only download when `metadata.documentId` exists in vault.  
6. **Migration** `price_alerts` not applied from this session.  
7. **Deploy verification** (DO/Vercel) not confirmed.  
8. **APK device install/smoke** not executed here.  
9. **EAS build** used working tree at queue time; mobile commit `e487a41` landed after upload — rebuild if any post-upload mobile edits must be in the RC (verify against build fingerprint if needed).

## Client / product clarification needed

- Provide the official 48-issue tracker file.  
- Confirm Vercel production branch for Customer WEBAPP (`skr-c0der` vs `main`).  
- Confirm whether DigitalOcean auto-deploys on `main` push and whether migrate runs in pipeline.  
- Supply LambdaTest credentials for retest upload.  
- Confirm when price-alert background evaluation should be scheduled.
