-- Offer optimistic concurrency + warehouse list index
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "offers_warehouse_id_idx" ON "offers"("warehouse_id");
CREATE INDEX IF NOT EXISTS "offers_reference_number_idx" ON "offers"("reference_number");
