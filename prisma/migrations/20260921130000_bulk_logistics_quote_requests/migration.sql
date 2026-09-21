-- Bulk logistics quote requests (customer → admin intake)

CREATE TYPE "BulkLogisticsQuoteStatus" AS ENUM (
  'SUBMITTED',
  'UNDER_REVIEW',
  'QUOTED',
  'CLOSED',
  'CANCELLED'
);

CREATE TABLE IF NOT EXISTS "bulk_logistics_quote_requests" (
  "id" UUID NOT NULL,
  "request_number" TEXT NOT NULL,
  "customer_profile_id" UUID NOT NULL,
  "status" "BulkLogisticsQuoteStatus" NOT NULL DEFAULT 'SUBMITTED',
  "contact_name" TEXT NOT NULL,
  "company_name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "material_name" TEXT NOT NULL,
  "quantity_mt" DECIMAL(18,3) NOT NULL,
  "pickup_location" TEXT NOT NULL,
  "delivery_location" TEXT NOT NULL,
  "preferred_date" DATE,
  "message" TEXT,
  "admin_notes" TEXT,
  "assigned_admin_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "bulk_logistics_quote_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bulk_logistics_quote_requests_request_number_key"
  ON "bulk_logistics_quote_requests"("request_number");

CREATE INDEX IF NOT EXISTS "bulk_logistics_quote_requests_customer_profile_id_status_idx"
  ON "bulk_logistics_quote_requests"("customer_profile_id", "status");

CREATE INDEX IF NOT EXISTS "bulk_logistics_quote_requests_status_created_at_idx"
  ON "bulk_logistics_quote_requests"("status", "created_at");

CREATE INDEX IF NOT EXISTS "bulk_logistics_quote_requests_assigned_admin_id_idx"
  ON "bulk_logistics_quote_requests"("assigned_admin_id");

ALTER TABLE "bulk_logistics_quote_requests"
  ADD CONSTRAINT "bulk_logistics_quote_requests_customer_profile_id_fkey"
  FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bulk_logistics_quote_requests"
  ADD CONSTRAINT "bulk_logistics_quote_requests_assigned_admin_id_fkey"
  FOREIGN KEY ("assigned_admin_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
