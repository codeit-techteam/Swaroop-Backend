# TDS (Technical Data Sheet) documents

## Customer visibility

- Metadata: `GET /api/v1/public/marketplace/grades/:id/tds` (guest) and
  `GET /api/v1/customer/marketplace/grades/:id/tds` (authenticated).
- Download: authenticated
  `GET /api/v1/customer/products/:productId/documents/:documentId/url`
  (short-lived signed URL). Guests must sign in first.
- Responses never invent TDS files or attach another grade’s document.
  Empty / unapproved vault → `available: false` + clear message.

## Upload / versioning (existing architecture)

- Sellers upload and replace product documents (including `TDS` /
  `PRODUCT_TDS`) via `POST/PATCH /api/v1/seller/products/:productId/documents`.
- Version history uses the shared `Document` / document-version model.
- Admin review follows the existing platform document review workflow —
  no parallel TDS vault was added.

## Admin

Catalog TDS fill-in is not a separate admin upload surface. Use seller
product document management (or Ops document review) so grade ↔ product ↔
manufacturer ↔ version stay consistent with the central document service.
