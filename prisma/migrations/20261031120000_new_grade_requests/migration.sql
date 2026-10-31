-- New Grade Requests: customers request a grade/material that is not in the catalogue.
-- Also adds CNY to CurrencyCode (Oct-28 meeting: USD/EUR/INR/CNY must be accepted everywhere).

ALTER TYPE "EntityOwnerType" ADD VALUE IF NOT EXISTS 'NEW_GRADE_REQUEST';
ALTER TYPE "CurrencyCode" ADD VALUE IF NOT EXISTS 'CNY';

DO $$ BEGIN
  CREATE TYPE "NewGradeRequestStatus" AS ENUM (
    'SUBMITTED',
    'UNDER_REVIEW',
    'INFO_REQUIRED',
    'GRADE_IDENTIFIED',
    'QUOTATION_AVAILABLE',
    'CONVERTED_TO_PR',
    'REJECTED',
    'CLOSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "new_grade_requests" (
  "id" UUID NOT NULL,
  "reference_number" TEXT NOT NULL,
  "customer_profile_id" UUID NOT NULL,
  "requested_by_id" UUID,
  "status" "NewGradeRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
  "grade_name" TEXT NOT NULL,
  "material_category" TEXT NOT NULL,
  "category_id" UUID,
  "manufacturer" TEXT,
  "grade_group" TEXT,
  "application" TEXT,
  "technical_specs" TEXT,
  "remarks" TEXT,
  "quantity" DECIMAL(18,3) NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'MT',
  "delivery_location" TEXT NOT NULL,
  "delivery_pincode" TEXT,
  "delivery_address_id" UUID,
  "required_by_date" DATE,
  "preferred_packaging" TEXT,
  "contact_name" TEXT NOT NULL,
  "contact_phone" TEXT NOT NULL,
  "contact_email" TEXT,
  "dedupe_key" TEXT NOT NULL,
  "idempotency_key" TEXT,
  "assigned_admin_id" UUID,
  "resolved_grade_id" UUID,
  "resolution_type" TEXT,
  "admin_message" TEXT,
  "customer_response" TEXT,
  "closure_reason" TEXT,
  "metadata" JSONB,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "new_grade_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "new_grade_requests_reference_number_key"
  ON "new_grade_requests"("reference_number");
CREATE UNIQUE INDEX IF NOT EXISTS "new_grade_requests_idempotency_key_key"
  ON "new_grade_requests"("idempotency_key");
CREATE INDEX IF NOT EXISTS "new_grade_requests_customer_profile_id_status_idx"
  ON "new_grade_requests"("customer_profile_id", "status");
CREATE INDEX IF NOT EXISTS "new_grade_requests_customer_profile_id_dedupe_key_idx"
  ON "new_grade_requests"("customer_profile_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "new_grade_requests_status_created_at_idx"
  ON "new_grade_requests"("status", "created_at");
CREATE INDEX IF NOT EXISTS "new_grade_requests_assigned_admin_id_idx"
  ON "new_grade_requests"("assigned_admin_id");
CREATE INDEX IF NOT EXISTS "new_grade_requests_resolved_grade_id_idx"
  ON "new_grade_requests"("resolved_grade_id");

ALTER TABLE "new_grade_requests"
  ADD CONSTRAINT "new_grade_requests_customer_profile_id_fkey"
  FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "new_grade_requests"
  ADD CONSTRAINT "new_grade_requests_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "grade_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "new_grade_requests"
  ADD CONSTRAINT "new_grade_requests_assigned_admin_id_fkey"
  FOREIGN KEY ("assigned_admin_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "new_grade_requests"
  ADD CONSTRAINT "new_grade_requests_resolved_grade_id_fkey"
  FOREIGN KEY ("resolved_grade_id") REFERENCES "grades"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "new_grade_request_events" (
  "id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "from_status" "NewGradeRequestStatus",
  "to_status" "NewGradeRequestStatus",
  "actor_role" TEXT NOT NULL,
  "actor_user_id" UUID,
  "message" TEXT,
  "internal" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "new_grade_request_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "new_grade_request_events_request_id_created_at_idx"
  ON "new_grade_request_events"("request_id", "created_at");

ALTER TABLE "new_grade_request_events"
  ADD CONSTRAINT "new_grade_request_events_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "new_grade_requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
