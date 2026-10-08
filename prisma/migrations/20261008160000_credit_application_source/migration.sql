-- Additive and backward compatible: existing rows keep source = NULL
-- ("not recorded") because their origin was never captured server-side.

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "CreditApplicationSource" AS ENUM ('WEBSITE', 'CUSTOMER_WEB', 'CUSTOMER_APP', 'SELLER_WEB', 'SELLER_APP', 'ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "credit_applications" ADD COLUMN IF NOT EXISTS "source" "CreditApplicationSource";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "credit_applications_source_created_at_idx" ON "credit_applications"("source", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "credit_applications_submitted_at_idx" ON "credit_applications"("submitted_at");
