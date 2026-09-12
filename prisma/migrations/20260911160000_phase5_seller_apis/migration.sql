-- Phase 5: Seller API domain extensions

-- AlterEnum StockMovementType
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'DAMAGE';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'DISPATCH';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'RECEIPT';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ProductMediaType" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SellerOnboardingStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PurchaseRequestResponseType" AS ENUM ('ACCEPT', 'REJECT', 'COUNTER_OFFER', 'RESPOND');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable seller_onboardings
CREATE TABLE IF NOT EXISTS "seller_onboardings" (
    "id" UUID NOT NULL,
    "seller_profile_id" UUID NOT NULL,
    "status" "SellerOnboardingStatus" NOT NULL DEFAULT 'DRAFT',
    "current_step" TEXT,
    "completed_steps" JSONB,
    "company_data" JSONB,
    "business_data" JSONB,
    "gst_data" JSONB,
    "pan_data" JSONB,
    "bank_data" JSONB,
    "address_data" JSONB,
    "location_data" JSONB,
    "review_notes" TEXT,
    "submitted_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "rejected_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_onboardings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "seller_onboardings_seller_profile_id_key" ON "seller_onboardings"("seller_profile_id");
CREATE INDEX IF NOT EXISTS "seller_onboardings_status_idx" ON "seller_onboardings"("status");

ALTER TABLE "seller_onboardings" DROP CONSTRAINT IF EXISTS "seller_onboardings_seller_profile_id_fkey";
ALTER TABLE "seller_onboardings" ADD CONSTRAINT "seller_onboardings_seller_profile_id_fkey" FOREIGN KEY ("seller_profile_id") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable product_media
CREATE TABLE IF NOT EXISTS "product_media" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "ProductMediaType" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_size_bytes" BIGINT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "product_media_product_id_type_idx" ON "product_media"("product_id", "type");
CREATE INDEX IF NOT EXISTS "product_media_sort_order_idx" ON "product_media"("sort_order");

ALTER TABLE "product_media" DROP CONSTRAINT IF EXISTS "product_media_product_id_fkey";
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable inventory
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "allocated_qty" DECIMAL(18,3) NOT NULL DEFAULT 0;
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "damaged_qty" DECIMAL(18,3) NOT NULL DEFAULT 0;
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "incoming_qty" DECIMAL(18,3) NOT NULL DEFAULT 0;
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "min_stock_qty" DECIMAL(18,3);
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "max_stock_qty" DECIMAL(18,3);

-- AlterTable purchase_requests
ALTER TABLE "purchase_requests" ADD COLUMN IF NOT EXISTS "destination_region" TEXT;
ALTER TABLE "purchase_requests" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3);
ALTER TABLE "purchase_requests" ADD COLUMN IF NOT EXISTS "viewed_by_seller_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "purchase_requests_expires_at_idx" ON "purchase_requests"("expires_at");

-- CreateTable purchase_request_responses
CREATE TABLE IF NOT EXISTS "purchase_request_responses" (
    "id" UUID NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "seller_profile_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "PurchaseRequestResponseType" NOT NULL,
    "message" TEXT,
    "counter_price" DECIMAL(18,4),
    "counter_quantity" DECIMAL(18,3),
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "valid_until" TIMESTAMP(3),
    "metadata" JSONB,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_request_responses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "purchase_request_responses_purchase_request_id_seller_profile_id_idx" ON "purchase_request_responses"("purchase_request_id", "seller_profile_id");
CREATE INDEX IF NOT EXISTS "purchase_request_responses_organization_id_idx" ON "purchase_request_responses"("organization_id");
CREATE INDEX IF NOT EXISTS "purchase_request_responses_type_idx" ON "purchase_request_responses"("type");

ALTER TABLE "purchase_request_responses" DROP CONSTRAINT IF EXISTS "purchase_request_responses_purchase_request_id_fkey";
ALTER TABLE "purchase_request_responses" ADD CONSTRAINT "purchase_request_responses_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_request_responses" DROP CONSTRAINT IF EXISTS "purchase_request_responses_seller_profile_id_fkey";
ALTER TABLE "purchase_request_responses" ADD CONSTRAINT "purchase_request_responses_seller_profile_id_fkey" FOREIGN KEY ("seller_profile_id") REFERENCES "seller_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
