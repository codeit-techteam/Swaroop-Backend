# Credit Application Tracking API

Request Credit applications are stored in PostgreSQL (`credit_applications`) and are the single
source of truth for the Website, Customer Web/App, Seller apps and the Admin portal.
All routes are under `/api/v1`, use the standard `{ success, data, meta? }` envelope, and
error bodies carry a `requestId` that support can correlate with server logs.

## Source attribution

`CreditApplication.source` (`CreditApplicationSource`, nullable) is set **by the backend** when a
draft is created. Clients cannot set it; `source`, `status`, `customerId` and similar keys sent in
`metadata` are stripped.

| Request                                             | Source         |
| --------------------------------------------------- | -------------- |
| `Origin` matches `WEBSITE_ORIGINS`                  | `WEBSITE`      |
| `Origin` matches `CUSTOMER_WEB_ORIGINS`             | `CUSTOMER_WEB` |
| `Origin` matches `SELLER_WEB_ORIGINS`               | `SELLER_WEB`   |
| `Origin` matches `ADMIN_WEB_ORIGINS`                | `ADMIN`        |
| No `Origin`, `x-swaroop-client: SELLER_APP`         | `SELLER_APP`   |
| No `Origin` (native app)                            | `CUSTOMER_APP` |
| Unknown `Origin`                                    | `CUSTOMER_WEB` (+ `unrecognizedOrigin` in the CREATED event metadata) |

Source is reporting metadata only and is never used for authorization. Rows created before this
change keep `source = null` and are shown as "Not recorded" (filter value `NOT_RECORDED`).

## Status workflow

Transitions are enforced centrally (`CREDIT_APPLICATION_TRANSITIONS`) with compare-and-set
updates; a lost race returns `409 Conflict`, an illegal transition returns `400`.

```
DRAFT ─submit→ PENDING ─start-review→ UNDER_REVIEW ─approve/partial-approve→ APPROVED / PARTIALLY_APPROVED
                  │                       ├─send-insurance-review→ INSURANCE_REVIEW ─mark-arrangement-pending→ CREDIT_ARRANGEMENT_PENDING
                  │                       ├─request-documents→ DOCUMENTS_REQUIRED ─resubmit-documents→ DOCUMENTS_UNDER_REVIEW
                  ├─reject→ REJECTED      └─request-resubmission→ DRAFT (displayStatus RESUBMISSION_REQUIRED) ─submit→ PENDING
```

Approval is only possible from `UNDER_REVIEW`, `INSURANCE_REVIEW` or `CREDIT_ARRANGEMENT_PENDING`.
`displayStatus` equals `status`, except a reopened draft (`DRAFT` with `submittedAt`) which is
`RESUBMISSION_REQUIRED`. `PENDING` is labelled "Submitted" in UIs.

## Customer endpoints (`CUSTOMER` role)

| Method & path | Notes |
| --- | --- |
| `POST /customer/credit/applications` | Create/update the single open draft. Per-customer advisory lock prevents duplicate drafts. 60/hour. |
| `POST /customer/credit/apply` | Legacy one-shot apply (customer apps). 20/hour. |
| `POST /customer/credit/applications/:id/documents` | Register a required document (`gst_registration`, `bank_statement`, `itr_financials`, …). |
| `POST /customer/credit/applications/:id/submit` | Submit (idempotent). 20/hour. |
| `GET /customer/credit/applications` | **New.** The caller's applications, newest first. |
| `GET /customer/credit/applications/:id/status` | Status, `displayStatus`, `resubmissionRequested`, `nextStep`. |
| `GET /customer/credit/applications/:id/timeline` | Customer-visible events only; no admin identities. |

Submit response:

```json
{
  "id": "uuid",
  "applicationNumber": "CR-202610-446677",
  "status": "PENDING",
  "source": "WEBSITE",
  "submittedAt": "2026-10-08T09:13:00.000Z",
  "alreadySubmitted": false,
  "message": "Your credit request has been submitted successfully. Our team will review your application and contact you.",
  "nextStep": "…"
}
```

A repeated submit of a `PENDING` application returns the same body with `alreadySubmitted: true`
(no new event or notification). Submitting with missing required documents returns `400`.

## Admin endpoints (`ADMIN`, `SUPER_ADMIN`, `FINANCE_MANAGER`)

| Method & path | Body / query |
| --- | --- |
| `GET /admin/credit/applications` | `page`, `limit`, `search` (application number, company, legal name, GSTIN, email, mobile), `status` (incl. `RESUBMISSION_REQUIRED`), `source` (incl. `NOT_RECORDED`), `kycStatus` (`VERIFIED`, `PENDING`, `FAILED`, `MANUAL_REVIEW`), `from`, `to` (ISO; submitted date, created date for unsubmitted drafts), `sort` (`newest`, `oldest`, `submitted_desc`, `submitted_asc`, `updated_desc`, `amount_desc`, `amount_asc`), `includeDrafts`, `customerId`, `assignedAdminId` |
| `GET /admin/credit/applications/stats` | `from`, `to`. Returns `total`, `submitted`, `pendingReview`, `underReview`, `documentsRequired`, `resubmissionRequired`, `approved`, `rejected`, `draftsInProgress`, `website`, `websiteToday`, `websiteThisMonth` (IST boundaries), `bySource[]`, `byStatus[]` |
| `GET /admin/credit/applications/assignees` | Active admins eligible for assignment |
| `GET /admin/credit/applications/:id` | Detail incl. `availableActions`, masked `kyc { status, pan, gst }`, `remarks`, documents (`belongsToApplication`), timeline, audit |
| `POST /admin/credit/applications/:id/assign` | `{ assigneeUserId? }` — omitted means "assign to me" |
| `POST /admin/credit/applications/:id/remarks` | `{ remark }` (2–2000 chars, internal only) |
| `POST /admin/credit/applications/:id/start-review` | — |
| `POST /admin/credit/applications/:id/request-documents` | `{ message }` |
| `POST /admin/credit/applications/:id/request-resubmission` | `{ message }` (5–2000 chars, shown to the customer) |
| `POST /admin/credit/applications/:id/approve` · `/partial-approve` | `{ approvedLimit, reason, … }` |
| `POST /admin/credit/applications/:id/reject` | `{ reason }` |
| `GET /admin/credit/documents/:id/download` | Credit documents only (others `404`); short-lived signed URL; every access audited (`CREDIT_DOCUMENT_DOWNLOADED`, URL not logged) |

List rows include `source`, `sourceLabel`, `displayStatus`, `resubmissionRequested` and
`kycStatus`. PAN is masked server-side; full PAN/GST values never leave the backend.

## Timeline & audit

Every state change writes a `credit_application_events` row with `fromStatus`/`toStatus` in
metadata and the acting user, plus an audit-log entry. Assignment and remarks are internal
(`customerVisible: false`). Admin views receive `actorName`/`actorUserId`; customer views do not.

## Notifications

In-app notifications are sent to finance admins on submit/resubmit, to the assignee on
assignment, and to the customer on review start, document requests, resubmission requests and
decisions. Email is not sent: the backend has no email provider configured.

## Deployment

1. `npx prisma migrate deploy` (migration `20261008160000_credit_application_source` — additive
   enum, nullable column and two indexes; safe on a live table, no backfill).
2. Optional: set `WEBSITE_ORIGINS` / `CUSTOMER_WEB_ORIGINS` / `SELLER_WEB_ORIGINS` /
   `ADMIN_WEB_ORIGINS` when custom domains go live (and add them to `CORS_ORIGINS`).
