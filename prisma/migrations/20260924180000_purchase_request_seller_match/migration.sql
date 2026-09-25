-- Multi-seller blind matching: one master PurchaseRequest → many seller match rows.

CREATE TYPE "PurchaseRequestSellerMatchStatus" AS ENUM (
  'MATCHED',
  'VIEWED',
  'ACCEPTED',
  'REJECTED',
  'COUNTER_OFFERED',
  'EXPIRED',
  'REMOVED'
);

CREATE TABLE "purchase_request_seller_matches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purchase_request_id" UUID NOT NULL,
  "seller_org_id" UUID NOT NULL,
  "offer_id" UUID,
  "match_strategy" TEXT,
  "status" "PurchaseRequestSellerMatchStatus" NOT NULL DEFAULT 'MATCHED',
  "matched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "response_deadline" TIMESTAMP(3),
  "viewed_at" TIMESTAMP(3),
  "responded_at" TIMESTAMP(3),
  "seller_offer_price" DECIMAL(18,4),
  "seller_counter_price" DECIMAL(18,4),
  "seller_requested_price" DECIMAL(18,4),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "purchase_request_seller_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_request_seller_matches_purchase_request_id_seller_org_id_key"
  ON "purchase_request_seller_matches"("purchase_request_id", "seller_org_id");

CREATE INDEX "purchase_request_seller_matches_seller_org_id_status_idx"
  ON "purchase_request_seller_matches"("seller_org_id", "status");

CREATE INDEX "purchase_request_seller_matches_purchase_request_id_status_idx"
  ON "purchase_request_seller_matches"("purchase_request_id", "status");

CREATE INDEX "purchase_request_seller_matches_response_deadline_idx"
  ON "purchase_request_seller_matches"("response_deadline");

CREATE INDEX "purchase_request_seller_matches_status_response_deadline_idx"
  ON "purchase_request_seller_matches"("status", "response_deadline");

CREATE INDEX "offers_status_valid_from_valid_until_idx"
  ON "offers"("status", "valid_from", "valid_until");

ALTER TABLE "purchase_request_seller_matches"
  ADD CONSTRAINT "purchase_request_seller_matches_purchase_request_id_fkey"
  FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_request_seller_matches"
  ADD CONSTRAINT "purchase_request_seller_matches_seller_org_id_fkey"
  FOREIGN KEY ("seller_org_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_request_seller_matches"
  ADD CONSTRAINT "purchase_request_seller_matches_offer_id_fkey"
  FOREIGN KEY ("offer_id") REFERENCES "offers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: existing assigned PRs become MATCHED rows for their seller org.
INSERT INTO "purchase_request_seller_matches" (
  "purchase_request_id",
  "seller_org_id",
  "offer_id",
  "match_strategy",
  "status",
  "matched_at",
  "response_deadline",
  "seller_offer_price",
  "created_at",
  "updated_at"
)
SELECT
  pr."id",
  pr."seller_org_id",
  (
    SELECT pri."offer_id"
    FROM "purchase_request_items" pri
    WHERE pri."purchase_request_id" = pr."id"
    ORDER BY pri."created_at" ASC
    LIMIT 1
  ),
  'BACKFILL',
  CASE
    WHEN pr."status" IN ('CONVERTED_TO_ORDER', 'APPROVED') THEN 'ACCEPTED'::"PurchaseRequestSellerMatchStatus"
    WHEN pr."status" = 'REJECTED' THEN 'REJECTED'::"PurchaseRequestSellerMatchStatus"
    WHEN pr."status" = 'EXPIRED' THEN 'EXPIRED'::"PurchaseRequestSellerMatchStatus"
    WHEN pr."status" IN ('NEGOTIATION', 'OFFER_RECEIVED') THEN 'COUNTER_OFFERED'::"PurchaseRequestSellerMatchStatus"
    ELSE 'MATCHED'::"PurchaseRequestSellerMatchStatus"
  END,
  COALESCE(pr."submitted_at", pr."created_at"),
  pr."response_deadline",
  (
    SELECT pri."unit_price_snapshot"
    FROM "purchase_request_items" pri
    WHERE pri."purchase_request_id" = pr."id"
    ORDER BY pri."created_at" ASC
    LIMIT 1
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "purchase_requests" pr
WHERE pr."seller_org_id" IS NOT NULL
  AND pr."deleted_at" IS NULL
ON CONFLICT ("purchase_request_id", "seller_org_id") DO NOTHING;
