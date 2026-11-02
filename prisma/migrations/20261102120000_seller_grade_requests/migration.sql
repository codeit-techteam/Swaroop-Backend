-- Seller New Grade Requests: sellers can request a grade that is not in the
-- catalogue, mirroring the customer flow. A request belongs to EXACTLY ONE
-- requester (customer XOR seller). Existing rows are all customer requests.

DO $$ BEGIN
  CREATE TYPE "NewGradeRequestRequesterType" AS ENUM ('CUSTOMER', 'SELLER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "new_grade_requests"
  ADD COLUMN IF NOT EXISTS "requester_type" "NewGradeRequestRequesterType" NOT NULL DEFAULT 'CUSTOMER',
  ADD COLUMN IF NOT EXISTS "seller_profile_id" UUID;

ALTER TABLE "new_grade_requests"
  ALTER COLUMN "customer_profile_id" DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE "new_grade_requests"
    ADD CONSTRAINT "new_grade_requests_seller_profile_id_fkey"
    FOREIGN KEY ("seller_profile_id") REFERENCES "seller_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Exactly one requester, and it must agree with requester_type.
DO $$ BEGIN
  ALTER TABLE "new_grade_requests"
    ADD CONSTRAINT "new_grade_requests_requester_check"
    CHECK (
      (
        "requester_type" = 'CUSTOMER'
        AND "customer_profile_id" IS NOT NULL
        AND "seller_profile_id" IS NULL
      )
      OR
      (
        "requester_type" = 'SELLER'
        AND "seller_profile_id" IS NOT NULL
        AND "customer_profile_id" IS NULL
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "new_grade_requests_seller_profile_id_status_idx"
  ON "new_grade_requests"("seller_profile_id", "status");
CREATE INDEX IF NOT EXISTS "new_grade_requests_seller_profile_id_dedupe_key_idx"
  ON "new_grade_requests"("seller_profile_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "new_grade_requests_requester_type_status_created_at_idx"
  ON "new_grade_requests"("requester_type", "status", "created_at");
