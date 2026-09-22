-- Production CMS banner serving: platform groups + live metrics

ALTER TYPE "CmsBannerPlatform" ADD VALUE IF NOT EXISTS 'CUSTOMER_ALL';
ALTER TYPE "CmsBannerPlatform" ADD VALUE IF NOT EXISTS 'SELLER_ALL';

ALTER TABLE "cms_banners"
  ADD COLUMN IF NOT EXISTS "impression_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "click_count" INTEGER NOT NULL DEFAULT 0;
