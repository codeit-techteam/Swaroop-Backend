-- Phase 8: Payment & Finance

-- Enum extensions
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'BEFORE_DISPATCH';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'PARTIAL_PAYMENT';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'MILESTONE_PAYMENT';

ALTER TYPE "PaymentRail" ADD VALUE IF NOT EXISTS 'BANK_TRANSFER';
ALTER TYPE "PaymentRail" ADD VALUE IF NOT EXISTS 'CARD';
ALTER TYPE "PaymentRail" ADD VALUE IF NOT EXISTS 'PAYMENT_GATEWAY';

ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'INITIATED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'VERIFIED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';

DO $$ BEGIN
  CREATE TYPE "PaymentScheduleStatus" AS ENUM ('PENDING', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentScheduleType" AS ENUM ('ADVANCE', 'BEFORE_DISPATCH', 'ON_LOADING', 'ON_DELIVERY', 'CREDIT', 'PARTIAL', 'MILESTONE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ProformaInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "FinanceInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'PARTIALLY_PAID', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "FinanceTransactionType" AS ENUM ('PAYMENT', 'REFUND', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "FinanceTransactionStatus" AS ENUM ('CREATED', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Proforma invoices
CREATE TABLE IF NOT EXISTS "proforma_invoices" (
    "id" UUID NOT NULL,
    "pi_number" TEXT NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "seller_org_id" UUID NOT NULL,
    "status" "ProformaInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issue_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "subtotal" DECIMAL(18,2) NOT NULL,
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "remaining_amount" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "commercial_snapshot" JSONB,
    "billing_snapshot" JSONB,
    "shipping_snapshot" JSONB,
    "metadata" JSONB,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "proforma_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "proforma_invoices_pi_number_key" ON "proforma_invoices"("pi_number");
CREATE UNIQUE INDEX IF NOT EXISTS "proforma_invoices_purchase_order_id_key" ON "proforma_invoices"("purchase_order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "proforma_invoices_idempotency_key_key" ON "proforma_invoices"("idempotency_key");
CREATE INDEX IF NOT EXISTS "proforma_invoices_customer_org_id_status_idx" ON "proforma_invoices"("customer_org_id", "status");
CREATE INDEX IF NOT EXISTS "proforma_invoices_seller_org_id_status_idx" ON "proforma_invoices"("seller_org_id", "status");
CREATE INDEX IF NOT EXISTS "proforma_invoices_status_created_at_idx" ON "proforma_invoices"("status", "created_at");

ALTER TABLE "proforma_invoices" DROP CONSTRAINT IF EXISTS "proforma_invoices_purchase_order_id_fkey";
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proforma_invoices" DROP CONSTRAINT IF EXISTS "proforma_invoices_customer_org_id_fkey";
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_customer_org_id_fkey"
  FOREIGN KEY ("customer_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "proforma_invoices" DROP CONSTRAINT IF EXISTS "proforma_invoices_seller_org_id_fkey";
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_seller_org_id_fkey"
  FOREIGN KEY ("seller_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "proforma_invoice_lines" (
    "id" UUID NOT NULL,
    "proforma_invoice_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT NOT NULL,
    "grade_id" UUID,
    "product_id" UUID,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "unit_price" DECIMAL(18,4) NOT NULL,
    "line_subtotal" DECIMAL(18,2) NOT NULL,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "proforma_invoice_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "proforma_invoice_lines_proforma_invoice_id_idx" ON "proforma_invoice_lines"("proforma_invoice_id");
ALTER TABLE "proforma_invoice_lines" DROP CONSTRAINT IF EXISTS "proforma_invoice_lines_proforma_invoice_id_fkey";
ALTER TABLE "proforma_invoice_lines" ADD CONSTRAINT "proforma_invoice_lines_proforma_invoice_id_fkey"
  FOREIGN KEY ("proforma_invoice_id") REFERENCES "proforma_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Payment schedules
CREATE TABLE IF NOT EXISTS "payment_schedules" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "proforma_invoice_id" UUID,
    "sequence" INTEGER NOT NULL,
    "type" "PaymentScheduleType" NOT NULL,
    "percentage" DECIMAL(7,4),
    "amount" DECIMAL(18,2) NOT NULL,
    "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "remaining_amount" DECIMAL(18,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "due_at" TIMESTAMP(3),
    "status" "PaymentScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "milestone" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_schedules_purchase_order_id_sequence_key"
  ON "payment_schedules"("purchase_order_id", "sequence");
CREATE INDEX IF NOT EXISTS "payment_schedules_purchase_order_id_status_idx"
  ON "payment_schedules"("purchase_order_id", "status");
CREATE INDEX IF NOT EXISTS "payment_schedules_status_due_at_idx"
  ON "payment_schedules"("status", "due_at");

ALTER TABLE "payment_schedules" DROP CONSTRAINT IF EXISTS "payment_schedules_purchase_order_id_fkey";
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_schedules" DROP CONSTRAINT IF EXISTS "payment_schedules_proforma_invoice_id_fkey";
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_proforma_invoice_id_fkey"
  FOREIGN KEY ("proforma_invoice_id") REFERENCES "proforma_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Finance invoices
CREATE TABLE IF NOT EXISTS "finance_invoices" (
    "id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "proforma_invoice_id" UUID,
    "customer_org_id" UUID NOT NULL,
    "seller_org_id" UUID NOT NULL,
    "status" "FinanceInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issue_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "subtotal" DECIMAL(18,2) NOT NULL,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "snapshot" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "finance_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "finance_invoices_invoice_number_key" ON "finance_invoices"("invoice_number");
CREATE INDEX IF NOT EXISTS "finance_invoices_purchase_order_id_idx" ON "finance_invoices"("purchase_order_id");
CREATE INDEX IF NOT EXISTS "finance_invoices_customer_org_id_status_idx" ON "finance_invoices"("customer_org_id", "status");
CREATE INDEX IF NOT EXISTS "finance_invoices_seller_org_id_status_idx" ON "finance_invoices"("seller_org_id", "status");
CREATE INDEX IF NOT EXISTS "finance_invoices_status_idx" ON "finance_invoices"("status");

ALTER TABLE "finance_invoices" DROP CONSTRAINT IF EXISTS "finance_invoices_purchase_order_id_fkey";
ALTER TABLE "finance_invoices" ADD CONSTRAINT "finance_invoices_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "finance_invoices" DROP CONSTRAINT IF EXISTS "finance_invoices_proforma_invoice_id_fkey";
ALTER TABLE "finance_invoices" ADD CONSTRAINT "finance_invoices_proforma_invoice_id_fkey"
  FOREIGN KEY ("proforma_invoice_id") REFERENCES "proforma_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "finance_invoices" DROP CONSTRAINT IF EXISTS "finance_invoices_customer_org_id_fkey";
ALTER TABLE "finance_invoices" ADD CONSTRAINT "finance_invoices_customer_org_id_fkey"
  FOREIGN KEY ("customer_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_invoices" DROP CONSTRAINT IF EXISTS "finance_invoices_seller_org_id_fkey";
ALTER TABLE "finance_invoices" ADD CONSTRAINT "finance_invoices_seller_org_id_fkey"
  FOREIGN KEY ("seller_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Extend payments
ALTER TABLE "payments" ALTER COLUMN "order_id" DROP NOT NULL;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "purchase_order_id" UUID;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "proforma_invoice_id" UUID;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "payment_schedule_id" UUID;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "seller_org_id" UUID;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "failure_reason" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "payments_idempotency_key_key" ON "payments"("idempotency_key");
CREATE INDEX IF NOT EXISTS "payments_purchase_order_id_idx" ON "payments"("purchase_order_id");
CREATE INDEX IF NOT EXISTS "payments_proforma_invoice_id_idx" ON "payments"("proforma_invoice_id");
CREATE INDEX IF NOT EXISTS "payments_payment_schedule_id_idx" ON "payments"("payment_schedule_id");
CREATE INDEX IF NOT EXISTS "payments_seller_org_id_idx" ON "payments"("seller_org_id");
CREATE INDEX IF NOT EXISTS "payments_utr_idx" ON "payments"("utr");
CREATE INDEX IF NOT EXISTS "payments_created_at_idx" ON "payments"("created_at");

ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_purchase_order_id_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_proforma_invoice_id_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_proforma_invoice_id_fkey"
  FOREIGN KEY ("proforma_invoice_id") REFERENCES "proforma_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_payment_schedule_id_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_schedule_id_fkey"
  FOREIGN KEY ("payment_schedule_id") REFERENCES "payment_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_seller_org_id_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_seller_org_id_fkey"
  FOREIGN KEY ("seller_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Extend payment_transactions
ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "transaction_reference" TEXT;
ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "purchase_order_id" UUID;
ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "proforma_invoice_id" UUID;
ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "provider_transaction_id" TEXT;
ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "transaction_type" "FinanceTransactionType" DEFAULT 'PAYMENT';
ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- Migrate old PaymentStatus-based txn status to FinanceTransactionStatus where possible
-- Add new status column if needed: we redefine status as FinanceTransactionStatus
-- Existing rows use PaymentStatus enum — convert carefully
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_transactions' AND column_name = 'status'
  ) THEN
    -- Drop default, cast via text mapping
    ALTER TABLE "payment_transactions" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "payment_transactions"
      ALTER COLUMN "status" TYPE "FinanceTransactionStatus"
      USING (
        CASE "status"::text
          WHEN 'PENDING' THEN 'CREATED'::"FinanceTransactionStatus"
          WHEN 'AUTHORIZED' THEN 'PROCESSING'::"FinanceTransactionStatus"
          WHEN 'SUBMITTED' THEN 'PROCESSING'::"FinanceTransactionStatus"
          WHEN 'UNDER_VERIFICATION' THEN 'PROCESSING'::"FinanceTransactionStatus"
          WHEN 'PARTIALLY_PAID' THEN 'PROCESSING'::"FinanceTransactionStatus"
          WHEN 'PAID' THEN 'SUCCESS'::"FinanceTransactionStatus"
          WHEN 'FAILED' THEN 'FAILED'::"FinanceTransactionStatus"
          WHEN 'REFUNDED' THEN 'REFUNDED'::"FinanceTransactionStatus"
          WHEN 'CANCELLED' THEN 'FAILED'::"FinanceTransactionStatus"
          WHEN 'OVERDUE' THEN 'PROCESSING'::"FinanceTransactionStatus"
          WHEN 'REJECTED' THEN 'FAILED'::"FinanceTransactionStatus"
          ELSE 'CREATED'::"FinanceTransactionStatus"
        END
      );
    ALTER TABLE "payment_transactions" ALTER COLUMN "status" SET DEFAULT 'CREATED'::"FinanceTransactionStatus";
  END IF;
END $$;

UPDATE "payment_transactions"
SET "transaction_reference" = 'TXN-' || substr(replace("id"::text, '-', ''), 1, 16)
WHERE "transaction_reference" IS NULL;

ALTER TABLE "payment_transactions" ALTER COLUMN "transaction_reference" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_transaction_reference_key"
  ON "payment_transactions"("transaction_reference");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_utr_key"
  ON "payment_transactions"("utr");
CREATE INDEX IF NOT EXISTS "payment_transactions_purchase_order_id_idx"
  ON "payment_transactions"("purchase_order_id");

-- Refunds
CREATE TABLE IF NOT EXISTS "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "reason" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "processed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "refunds_payment_id_status_idx" ON "refunds"("payment_id", "status");
ALTER TABLE "refunds" DROP CONSTRAINT IF EXISTS "refunds_payment_id_fkey";
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Finance events
CREATE TABLE IF NOT EXISTS "finance_events" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID,
    "payment_id" UUID,
    "event_type" TEXT NOT NULL,
    "actor_role" TEXT,
    "actor_user_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "finance_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "finance_events_purchase_order_id_created_at_idx"
  ON "finance_events"("purchase_order_id", "created_at");
CREATE INDEX IF NOT EXISTS "finance_events_payment_id_created_at_idx"
  ON "finance_events"("payment_id", "created_at");
CREATE INDEX IF NOT EXISTS "finance_events_event_type_idx" ON "finance_events"("event_type");

-- Settlement PO link
ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "purchase_order_id" UUID;
CREATE INDEX IF NOT EXISTS "settlements_purchase_order_id_idx" ON "settlements"("purchase_order_id");
ALTER TABLE "settlements" DROP CONSTRAINT IF EXISTS "settlements_purchase_order_id_fkey";
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
