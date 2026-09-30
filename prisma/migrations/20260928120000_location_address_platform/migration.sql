-- Normalized geo fields for saved addresses (customer + seller organizations)
ALTER TABLE "addresses"
  ADD COLUMN IF NOT EXISTS "locality" TEXT,
  ADD COLUMN IF NOT EXISTS "district" TEXT,
  ADD COLUMN IF NOT EXISTS "place_id" TEXT,
  ADD COLUMN IF NOT EXISTS "formatted_address" TEXT,
  ADD COLUMN IF NOT EXISTS "accuracy_meters" INTEGER,
  ADD COLUMN IF NOT EXISTS "source" TEXT;

CREATE INDEX IF NOT EXISTS "addresses_organization_id_is_default_idx"
  ON "addresses"("organization_id", "is_default");
CREATE INDEX IF NOT EXISTS "addresses_place_id_idx" ON "addresses"("place_id");
CREATE INDEX IF NOT EXISTS "addresses_postal_code_idx" ON "addresses"("postal_code");

-- Seller operating locations (warehouses) get first-class coordinates
ALTER TABLE "warehouses"
  ADD COLUMN IF NOT EXISTS "latitude" DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS "longitude" DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS "place_id" TEXT,
  ADD COLUMN IF NOT EXISTS "formatted_address" TEXT;

CREATE INDEX IF NOT EXISTS "warehouses_organization_id_place_id_idx"
  ON "warehouses"("organization_id", "place_id");

-- Backfill coordinates previously stored in warehouse metadata by GPS saves
UPDATE "warehouses"
SET
  "latitude" = ("metadata"->>'latitude')::DECIMAL(10,7),
  "longitude" = ("metadata"->>'longitude')::DECIMAL(10,7)
WHERE "latitude" IS NULL
  AND "metadata" IS NOT NULL
  AND jsonb_typeof("metadata"->'latitude') = 'number'
  AND jsonb_typeof("metadata"->'longitude') = 'number';

-- Immutable delivery/billing address snapshots on transactions
ALTER TABLE "purchase_requests"
  ADD COLUMN IF NOT EXISTS "shipping_address_snapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "billing_address_snapshot" JSONB;

ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "shipping_address_snapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "billing_address_snapshot" JSONB;
