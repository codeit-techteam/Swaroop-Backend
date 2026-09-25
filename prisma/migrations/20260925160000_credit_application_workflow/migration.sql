-- AlterEnum: expand credit application workflow statuses
ALTER TYPE "CreditApplicationStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "CreditApplicationStatus" ADD VALUE IF NOT EXISTS 'DOCUMENTS_UNDER_REVIEW';
ALTER TYPE "CreditApplicationStatus" ADD VALUE IF NOT EXISTS 'INSURANCE_REVIEW';
ALTER TYPE "CreditApplicationStatus" ADD VALUE IF NOT EXISTS 'CREDIT_ARRANGEMENT_PENDING';
ALTER TYPE "CreditApplicationStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_APPROVED';
ALTER TYPE "CreditApplicationStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- AlterTable
ALTER TABLE "credit_applications"
  ADD COLUMN IF NOT EXISTS "approved_tenure_days" INTEGER,
  ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "effective_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "customer_message" TEXT,
  ADD COLUMN IF NOT EXISTS "insurance_status" TEXT DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS "arrangement_status" TEXT DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS "insurance_partner" TEXT,
  ADD COLUMN IF NOT EXISTS "insurance_reference" TEXT,
  ADD COLUMN IF NOT EXISTS "insured_amount" DECIMAL(18,2);

-- Backfill submittedAt for applications created before the draft workflow existed.
UPDATE "credit_applications"
SET "submitted_at" = "created_at"
WHERE "submitted_at" IS NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "credit_application_events" (
    "id" UUID NOT NULL,
    "credit_application_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "actor_role" TEXT,
    "customer_visible" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_application_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "credit_application_events_credit_application_id_created_at_idx"
  ON "credit_application_events"("credit_application_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "credit_application_events_event_type_created_at_idx"
  ON "credit_application_events"("event_type", "created_at");

-- AddForeignKey
ALTER TABLE "credit_application_events"
  ADD CONSTRAINT "credit_application_events_credit_application_id_fkey"
  FOREIGN KEY ("credit_application_id") REFERENCES "credit_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_application_events"
  ADD CONSTRAINT "credit_application_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
