-- Phase 6: Customer Marketplace (Cart + PR enhancements)

CREATE TABLE IF NOT EXISTS "carts" (
    "id" UUID NOT NULL,
    "customer_profile_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "carts_customer_profile_id_key" ON "carts"("customer_profile_id");
CREATE INDEX IF NOT EXISTS "carts_organization_id_idx" ON "carts"("organization_id");
CREATE INDEX IF NOT EXISTS "carts_status_idx" ON "carts"("status");

ALTER TABLE "carts" DROP CONSTRAINT IF EXISTS "carts_customer_profile_id_fkey";
ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "carts" DROP CONSTRAINT IF EXISTS "carts_organization_id_fkey";
ALTER TABLE "carts" ADD CONSTRAINT "carts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "cart_items" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "unit_price" DECIMAL(18,4) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "payment_method" "PaymentMethod",
    "price_snapshot_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_cart_id_offer_id_key" ON "cart_items"("cart_id", "offer_id");
CREATE INDEX IF NOT EXISTS "cart_items_product_id_idx" ON "cart_items"("product_id");
CREATE INDEX IF NOT EXISTS "cart_items_offer_id_idx" ON "cart_items"("offer_id");
CREATE INDEX IF NOT EXISTS "cart_items_grade_id_idx" ON "cart_items"("grade_id");

ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_cart_id_fkey";
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_product_id_fkey";
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_offer_id_fkey";
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_grade_id_fkey";
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_requests" ADD COLUMN IF NOT EXISTS "response_deadline" TIMESTAMP(3);
ALTER TABLE "purchase_requests" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_requests_idempotency_key_key" ON "purchase_requests"("idempotency_key");

ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "offer_id" UUID;
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "unit_price_snapshot" DECIMAL(18,4);
ALTER TABLE "purchase_request_items" ADD COLUMN IF NOT EXISTS "payment_method" "PaymentMethod";
CREATE INDEX IF NOT EXISTS "purchase_request_items_offer_id_idx" ON "purchase_request_items"("offer_id");

ALTER TABLE "purchase_request_items" DROP CONSTRAINT IF EXISTS "purchase_request_items_offer_id_fkey";
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill response_deadline from expires_at where missing
UPDATE "purchase_requests"
SET "response_deadline" = "expires_at"
WHERE "response_deadline" IS NULL AND "expires_at" IS NOT NULL;
