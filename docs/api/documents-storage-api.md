# Documents & Object Storage API

## Status

**R2 integration is prepared but disabled because credentials are not configured.**

Set `STORAGE_PROVIDER=none` (default) for local/dev. Document **metadata** APIs work without R2. Signed upload/download URLs return **503** with `code: STORAGE_NOT_CONFIGURED` until R2 is enabled.

## Architecture

```
Feature modules (customer / seller / admin)
        │
        ▼
DocumentsCoreService  ──► Prisma Document + DocumentVersion
        │
        ▼
StorageService  ──► NoopStorageProvider (none) | CloudflareR2Provider (r2)
```

- Feature modules must inject `StorageService` only — never the R2 SDK.
- Creating a `Document` row does **not** require R2.
- Only `getSignedUrl` / upload / download / delete throw `STORAGE_NOT_CONFIGURED`.

### Storage keys (collision-safe)

Keys use `uuid` + sanitized filename (never the raw original alone):

| Context | Pattern |
|--------|---------|
| Customer KYC | `customers/{profileId}/kyc/{docId}/{uuid-safeName}` |
| Seller | `sellers/{profileId}/{category}/{docId}/{uuid-safeName}` |
| Payment proof | `payments/{paymentId}/proof/{docId}/...` |
| E-way bill | `dispatches/{dispatchId}/eway-bill/{docId}/...` |
| POD | `deliveries/{deliveryId}/pod/{docId}/...` |
| PO docs | `purchase-orders/{poId}/documents/{docId}/...` |

### Status machine

```
UPLOADED → UNDER_REVIEW → VERIFIED | REJECTED
VERIFIED → EXPIRED | REPLACED | ARCHIVED
REJECTED → REPLACED | ARCHIVED
```

API **approve** maps to status `VERIFIED` with response field `approved: true` (APPROVED alias).

Document numbers: `DOC-YYYY-######` (unique, retry on collision).

Allowed MIME: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`. Max size: `MAX_DOCUMENT_SIZE_MB` (default 10).

## APIs

### Customer (`JWT` + role `CUSTOMER`)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/customer/documents` | List own docs |
| POST | `/api/v1/customer/documents` | Create metadata (OK without R2) |
| GET | `/api/v1/customer/documents/:id` | Detail |
| POST | `/api/v1/customer/documents/:id/replace` | New version |
| GET | `/api/v1/customer/documents/:id/download` | Signed GET → 503 if storage off |
| GET | `/api/v1/customer/documents/:id/upload-url` | Signed PUT → 503 if storage off |
| GET | `/api/v1/customer/documents/:id/versions` | Version history |

Owner: `ownerType=CUSTOMER`, `ownerId=customerProfileId`.

### Seller (`JWT` + role `SELLER`)

| Method | Path |
|--------|------|
| GET/POST | `/api/v1/seller/documents`, `/upload`, `/register` |
| GET/POST/DELETE | `/api/v1/seller/documents/:id`, `/:id/replace` |
| GET | `/:id/download`, `/:id/upload-url`, `/:id/preview`, `/:id/versions` |

No fake `r2://unconfigured/...` URLs — download/upload-url throw `STORAGE_NOT_CONFIGURED`.

### Admin (compliance roles)

| Method | Path |
|--------|------|
| GET | `/api/v1/admin/documents` |
| GET | `/api/v1/admin/documents/expiring?days=` |
| GET | `/api/v1/admin/documents/:id` |
| GET | `/api/v1/admin/documents/:id/versions` |
| GET | `/api/v1/admin/documents/:id/download` |
| POST | `/api/v1/admin/documents/:id/approve` |
| POST | `/api/v1/admin/documents/:id/reject` | **Requires non-empty reason** |

Approve sets `approvedById` / `approvedAt`. Reject sets `rejectedById` / `rejectedAt` / `rejectionReason`. Audit + in-app notification on both.

### Integration helpers

- `DocumentsCoreService.linkPaymentProof(paymentId, documentId)` → `payment.metadata.proofDocumentId` (no R2).
- Logistics POD upload: optional `documentId` must be category `POD`.
- E-way bill upsert: optional `documentId` must be category `E_WAY_BILL`.

## `STORAGE_NOT_CONFIGURED` behavior

```json
{
  "success": false,
  "statusCode": 503,
  "code": "STORAGE_NOT_CONFIGURED",
  "message": "File storage is not configured yet. ..."
}
```

Health still returns `200` with `"storage": "not_configured"` when provider is `none` or R2 credentials are incomplete.

## R2 setup checklist (remaining)

1. Create a Cloudflare R2 bucket and API token (S3-compatible).
2. Set in `.env`:
   - `STORAGE_PROVIDER=r2`
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
   - Optional: `R2_PUBLIC_BASE_URL`, `R2_REGION=auto`, `R2_SIGNED_URL_EXPIRY=900`
3. Restart the API. Health should report `"storage": "configured"`.
4. Call create → `uploadUrl` / `download` should return real signed HTTPS URLs.
5. CORS on the bucket must allow PUT from web app origins if browsers upload directly.

Legacy env aliases (`CLOUDFLARE_R2_*`) remain supported.
