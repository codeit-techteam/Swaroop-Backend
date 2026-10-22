-- Additive: customer price alert subscriptions (evaluation worker not yet wired).
CREATE TABLE IF NOT EXISTS "price_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_profile_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "product_id" UUID,
    "target_price" DECIMAL(18,4) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "direction" TEXT NOT NULL DEFAULT 'BELOW',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_triggered_at" TIMESTAMP(3),
    "last_triggered_price" DECIMAL(18,4),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "price_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "price_alerts_customer_profile_id_enabled_idx" ON "price_alerts"("customer_profile_id", "enabled");
CREATE INDEX IF NOT EXISTS "price_alerts_user_id_idx" ON "price_alerts"("user_id");
CREATE INDEX IF NOT EXISTS "price_alerts_grade_id_enabled_idx" ON "price_alerts"("grade_id", "enabled");
CREATE INDEX IF NOT EXISTS "price_alerts_product_id_idx" ON "price_alerts"("product_id");

ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
