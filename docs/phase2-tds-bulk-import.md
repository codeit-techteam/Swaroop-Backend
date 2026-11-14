# Phase 2 — TDS bulk import preparation (~550 PDFs)

**Status:** Prepared — **BLOCKED** until the client delivers the PDF pack + grade mapping.

## What already exists

| Capability | Location |
|------------|----------|
| Customer visibility (VERIFIED only) | `src/modules/tds/grade-tds.service.ts` |
| Quality Documentation gated on real docs | Customer WebApp `lib/cx-feed.ts`, `grade-tds-section.tsx` |
| Admin upload / replace / approve / map | `admin-tds.controller.ts`, Admin UI `/tds` |
| CLI import | `npm run import:tds` → `scripts/import-tds-library.ts` |
| Storage reconcile | `npm run sync:tds-storage` |

## Client must provide

1. ZIP or folder of ~550 PDF/image TDS files  
2. Mapping sheet: `filename` → `gradeCode` or Source.One key  
3. Confirmation of verification workflow (auto VERIFIED vs Admin approve)

## Safe import order (when files arrive)

```bash
# Dry-run first
npm run import:tds -- --dry-run --limit 20

# Apply against staging / prod with backup
npm run import:tds -- --limit 550

# Reconcile R2 keys
npm run sync:tds-storage
```

## Do not

- Fabricate PDF content or placeholder TDS files  
- Mark Quality Documentation as available without `storageKey` + `VERIFIED`  
- Claim bulk load complete before client delivery  
