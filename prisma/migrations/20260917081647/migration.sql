/*
  Warnings:

  - Made the column `transaction_type` on table `payment_transactions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updated_at` on table `payment_transactions` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "purchase_requests_seller_org_id_idx";

-- AlterTable
ALTER TABLE "payment_transactions" ALTER COLUMN "transaction_type" SET NOT NULL,
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'INITIATED';

-- CreateIndex
CREATE INDEX "grades_code_idx" ON "grades"("code");

-- RenameIndex
ALTER INDEX "purchase_request_responses_purchase_request_id_seller_profile_i" RENAME TO "purchase_request_responses_purchase_request_id_seller_profi_idx";
