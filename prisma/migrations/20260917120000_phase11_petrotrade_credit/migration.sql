-- Phase 11: PetroTrade / platform-level customer credit management

ALTER TYPE "CreditStatus" ADD VALUE IF NOT EXISTS 'DOCUMENTS_REQUIRED';
ALTER TYPE "CreditStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "CreditStatus" ADD VALUE IF NOT EXISTS 'BLOCKED';
ALTER TYPE "CreditStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

ALTER TYPE "EntityOwnerType" ADD VALUE IF NOT EXISTS 'CREDIT';
ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'FINANCIAL_STATEMENT';

DO $$ BEGIN
  CREATE TYPE "CreditApplicationStatus" AS ENUM (
    'PENDING',
    'UNDER_REVIEW',
    'DOCUMENTS_REQUIRED',
    'APPROVED',
    'REJECTED',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CreditAccountStatus" AS ENUM (
    'ACTIVE',
    'SUSPENDED',
    'BLOCKED',
    'EXPIRED',
    'CLOSED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CreditTransactionType" AS ENUM (
    'CREDIT_APPROVED',
    'CREDIT_LIMIT_ADJUSTED',
    'CREDIT_UTILIZED',
    'CREDIT_REPAID',
    'CREDIT_RELEASED',
    'CREDIT_ADJUSTMENT',
    'CREDIT_REFUND',
    'CREDIT_SUSPENDED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CreditTransactionStatus" AS ENUM (
    'POSTED',
    'PENDING',
    'REVERSED',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CreditInsuranceStatus" AS ENUM (
    'NOT_REQUIRED',
    'PENDING',
    'ACTIVE',
    'EXPIRED',
    'CANCELLED',
    'CLAIMED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CreditInsuranceClaimStatus" AS ENUM (
    'NONE',
    'OPEN',
    'SETTLED',
    'REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "customer_credit_profiles"
  ADD COLUMN IF NOT EXISTS "account_number" TEXT,
  ADD COLUMN IF NOT EXISTS "account_status" "CreditAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "utilized_amount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "outstanding_amount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "overdue_amount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "effective_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "review_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "assigned_admin_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "customer_credit_profiles_account_number_key"
  ON "customer_credit_profiles"("account_number");
CREATE INDEX IF NOT EXISTS "customer_credit_profiles_account_status_idx"
  ON "customer_credit_profiles"("account_status");
CREATE INDEX IF NOT EXISTS "customer_credit_profiles_assigned_admin_id_idx"
  ON "customer_credit_profiles"("assigned_admin_id");

ALTER TABLE "customer_credit_profiles" DROP CONSTRAINT IF EXISTS "customer_credit_profiles_assigned_admin_id_fkey";
ALTER TABLE "customer_credit_profiles"
  ADD CONSTRAINT "customer_credit_profiles_assigned_admin_id_fkey"
  FOREIGN KEY ("assigned_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "credit_applications" (
  "id" UUID NOT NULL,
  "application_number" TEXT NOT NULL,
  "customer_profile_id" UUID NOT NULL,
  "credit_profile_id" UUID,
  "status" "CreditApplicationStatus" NOT NULL DEFAULT 'PENDING',
  "requested_limit" DECIMAL(18, 2) NOT NULL,
  "requested_tenure_days" INTEGER,
  "purpose" TEXT,
  "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
  "assigned_admin_id" UUID,
  "decided_at" TIMESTAMP(3),
  "decision_reason" TEXT,
  "approved_limit" DECIMAL(18, 2),
  "notes" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "credit_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "credit_applications_application_number_key"
  ON "credit_applications"("application_number");
CREATE INDEX IF NOT EXISTS "credit_applications_customer_profile_id_status_idx"
  ON "credit_applications"("customer_profile_id", "status");
CREATE INDEX IF NOT EXISTS "credit_applications_status_created_at_idx"
  ON "credit_applications"("status", "created_at");
CREATE INDEX IF NOT EXISTS "credit_applications_assigned_admin_id_idx"
  ON "credit_applications"("assigned_admin_id");

ALTER TABLE "credit_applications" DROP CONSTRAINT IF EXISTS "credit_applications_customer_profile_id_fkey";
ALTER TABLE "credit_applications"
  ADD CONSTRAINT "credit_applications_customer_profile_id_fkey"
  FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "credit_applications" DROP CONSTRAINT IF EXISTS "credit_applications_credit_profile_id_fkey";
ALTER TABLE "credit_applications"
  ADD CONSTRAINT "credit_applications_credit_profile_id_fkey"
  FOREIGN KEY ("credit_profile_id") REFERENCES "customer_credit_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "credit_applications" DROP CONSTRAINT IF EXISTS "credit_applications_assigned_admin_id_fkey";
ALTER TABLE "credit_applications"
  ADD CONSTRAINT "credit_applications_assigned_admin_id_fkey"
  FOREIGN KEY ("assigned_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "credit_transactions" (
  "id" UUID NOT NULL,
  "transaction_number" TEXT NOT NULL,
  "credit_profile_id" UUID NOT NULL,
  "customer_profile_id" UUID NOT NULL,
  "type" "CreditTransactionType" NOT NULL,
  "status" "CreditTransactionStatus" NOT NULL DEFAULT 'POSTED',
  "amount" DECIMAL(18, 2) NOT NULL,
  "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
  "reference_type" TEXT,
  "reference_id" TEXT,
  "purchase_order_id" UUID,
  "payment_id" UUID,
  "created_by_id" UUID,
  "source" TEXT,
  "notes" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "credit_transactions_transaction_number_key"
  ON "credit_transactions"("transaction_number");
CREATE INDEX IF NOT EXISTS "credit_transactions_credit_profile_id_created_at_idx"
  ON "credit_transactions"("credit_profile_id", "created_at");
CREATE INDEX IF NOT EXISTS "credit_transactions_customer_profile_id_created_at_idx"
  ON "credit_transactions"("customer_profile_id", "created_at");
CREATE INDEX IF NOT EXISTS "credit_transactions_type_created_at_idx"
  ON "credit_transactions"("type", "created_at");
CREATE INDEX IF NOT EXISTS "credit_transactions_purchase_order_id_idx"
  ON "credit_transactions"("purchase_order_id");
CREATE INDEX IF NOT EXISTS "credit_transactions_payment_id_idx"
  ON "credit_transactions"("payment_id");

ALTER TABLE "credit_transactions" DROP CONSTRAINT IF EXISTS "credit_transactions_credit_profile_id_fkey";
ALTER TABLE "credit_transactions"
  ADD CONSTRAINT "credit_transactions_credit_profile_id_fkey"
  FOREIGN KEY ("credit_profile_id") REFERENCES "customer_credit_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "credit_transactions" DROP CONSTRAINT IF EXISTS "credit_transactions_customer_profile_id_fkey";
ALTER TABLE "credit_transactions"
  ADD CONSTRAINT "credit_transactions_customer_profile_id_fkey"
  FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "credit_transactions" DROP CONSTRAINT IF EXISTS "credit_transactions_purchase_order_id_fkey";
ALTER TABLE "credit_transactions"
  ADD CONSTRAINT "credit_transactions_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "credit_transactions" DROP CONSTRAINT IF EXISTS "credit_transactions_payment_id_fkey";
ALTER TABLE "credit_transactions"
  ADD CONSTRAINT "credit_transactions_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "credit_transactions" DROP CONSTRAINT IF EXISTS "credit_transactions_created_by_id_fkey";
ALTER TABLE "credit_transactions"
  ADD CONSTRAINT "credit_transactions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "credit_insurance" (
  "id" UUID NOT NULL,
  "credit_profile_id" UUID NOT NULL,
  "customer_profile_id" UUID NOT NULL,
  "provider_name" TEXT,
  "policy_number" TEXT,
  "coverage_amount" DECIMAL(18, 2),
  "status" "CreditInsuranceStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "claim_status" "CreditInsuranceClaimStatus" NOT NULL DEFAULT 'NONE',
  "start_date" TIMESTAMP(3),
  "end_date" TIMESTAMP(3),
  "notes" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "credit_insurance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "credit_insurance_credit_profile_id_key"
  ON "credit_insurance"("credit_profile_id");
CREATE UNIQUE INDEX IF NOT EXISTS "credit_insurance_customer_profile_id_key"
  ON "credit_insurance"("customer_profile_id");
CREATE INDEX IF NOT EXISTS "credit_insurance_status_idx"
  ON "credit_insurance"("status");

ALTER TABLE "credit_insurance" DROP CONSTRAINT IF EXISTS "credit_insurance_credit_profile_id_fkey";
ALTER TABLE "credit_insurance"
  ADD CONSTRAINT "credit_insurance_credit_profile_id_fkey"
  FOREIGN KEY ("credit_profile_id") REFERENCES "customer_credit_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "credit_insurance" DROP CONSTRAINT IF EXISTS "credit_insurance_customer_profile_id_fkey";
ALTER TABLE "credit_insurance"
  ADD CONSTRAINT "credit_insurance_customer_profile_id_fkey"
  FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "customer_credit_profiles"
SET "account_number" = 'CR-' || to_char("created_at", 'YYYY') || '-' || substr(replace("id"::text, '-', ''), 1, 8)
WHERE "account_number" IS NULL;
