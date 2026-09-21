-- Authoritative checkout quotes + PR quote reference

CREATE TABLE IF NOT EXISTS "checkout_quotes" (
    "id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "customer_profile_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "seller_org_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "payment_method" "PaymentMethod" NOT NULL,
    "shipping_address_id" UUID,
    "billing_address_id" UUID,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "base_amount" DECIMAL(18,2) NOT NULL,
    "discount_amount" DECIMAL(18,2) NOT NULL,
    "freight_amount" DECIMAL(18,2) NOT NULL,
    "tax_amount" DECIMAL(18,2) NOT NULL,
    "tax_bps" INTEGER NOT NULL,
    "platform_fee" DECIMAL(18,2) NOT NULL,
    "insurance_amount" DECIMAL(18,2) NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "pricing_version" TEXT NOT NULL,
    "match_strategy" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "purchase_request_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_quotes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "checkout_quotes_purchase_request_id_key"
  ON "checkout_quotes"("purchase_request_id");

CREATE INDEX IF NOT EXISTS "checkout_quotes_customer_org_id_created_at_idx"
  ON "checkout_quotes"("customer_org_id", "created_at");

CREATE INDEX IF NOT EXISTS "checkout_quotes_offer_id_idx"
  ON "checkout_quotes"("offer_id");

CREATE INDEX IF NOT EXISTS "checkout_quotes_expires_at_idx"
  ON "checkout_quotes"("expires_at");

ALTER TABLE "checkout_quotes"
  ADD CONSTRAINT "checkout_quotes_customer_org_id_fkey"
  FOREIGN KEY ("customer_org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "checkout_quotes"
  ADD CONSTRAINT "checkout_quotes_customer_profile_id_fkey"
  FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "checkout_quotes"
  ADD CONSTRAINT "checkout_quotes_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON UPDATE CASCADE;

ALTER TABLE "checkout_quotes"
  ADD CONSTRAINT "checkout_quotes_offer_id_fkey"
  FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON UPDATE CASCADE;

ALTER TABLE "checkout_quotes"
  ADD CONSTRAINT "checkout_quotes_grade_id_fkey"
  FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON UPDATE CASCADE;

ALTER TABLE "checkout_quotes"
  ADD CONSTRAINT "checkout_quotes_seller_org_id_fkey"
  FOREIGN KEY ("seller_org_id") REFERENCES "organizations"("id") ON UPDATE CASCADE;

ALTER TABLE "checkout_quotes"
  ADD CONSTRAINT "checkout_quotes_purchase_request_id_fkey"
  FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON UPDATE CASCADE;

ALTER TABLE "purchase_requests"
  ADD COLUMN IF NOT EXISTS "quote_id" UUID;

CREATE INDEX IF NOT EXISTS "purchase_requests_quote_id_idx"
  ON "purchase_requests"("quote_id");
