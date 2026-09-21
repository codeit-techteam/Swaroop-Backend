-- Phase 12: platform CREDIT payment method, reservation ledger fields, CMS banners

ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CREDIT';
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'CREDIT_RESERVED';
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'CREDIT_SETTLED';
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'CREDIT_REVERSED';
ALTER TYPE "EntityOwnerType" ADD VALUE IF NOT EXISTS 'CMS';

ALTER TABLE "customer_credit_profiles"
  ADD COLUMN IF NOT EXISTS "pending_credit" DECIMAL(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE "credit_transactions"
  ADD COLUMN IF NOT EXISTS "balance_before" DECIMAL(18, 2),
  ADD COLUMN IF NOT EXISTS "balance_after" DECIMAL(18, 2);

DO $$ BEGIN
  CREATE TYPE "CmsBannerStatus" AS ENUM (
    'DRAFT',
    'ACTIVE',
    'PAUSED',
    'EXPIRED',
    'ARCHIVED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CmsBannerPlacement" AS ENUM (
    'HOME_HERO',
    'MARKETPLACE',
    'DASHBOARD',
    'OFFERS',
    'LOGIN',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CmsBannerPlatform" AS ENUM (
    'ALL',
    'CUSTOMER_APP',
    'CUSTOMER_WEB',
    'SELLER_APP',
    'SELLER_WEB',
    'ADMIN_WEB'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "cms_banners" (
  "id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "subtitle" TEXT,
  "placement" "CmsBannerPlacement" NOT NULL DEFAULT 'HOME_HERO',
  "platform" "CmsBannerPlatform" NOT NULL DEFAULT 'ALL',
  "status" "CmsBannerStatus" NOT NULL DEFAULT 'DRAFT',
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "start_at" TIMESTAMP(3),
  "end_at" TIMESTAMP(3),
  "media_key" TEXT,
  "target_route" TEXT,
  "created_by_id" UUID,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "cms_banners_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cms_banners_status_placement_platform_idx"
  ON "cms_banners"("status", "placement", "platform");
CREATE INDEX IF NOT EXISTS "cms_banners_display_order_idx"
  ON "cms_banners"("display_order");
CREATE INDEX IF NOT EXISTS "cms_banners_start_at_end_at_idx"
  ON "cms_banners"("start_at", "end_at");

ALTER TABLE "cms_banners" DROP CONSTRAINT IF EXISTS "cms_banners_created_by_id_fkey";
ALTER TABLE "cms_banners"
  ADD CONSTRAINT "cms_banners_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
