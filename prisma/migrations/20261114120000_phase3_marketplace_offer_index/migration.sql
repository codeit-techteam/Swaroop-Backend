-- Phase 3: speed live marketplace offer filters (status + visibility + soft-delete + price floor).
CREATE INDEX IF NOT EXISTS "offers_status_visibility_deleted_at_base_price_idx"
  ON "offers" ("status", "visibility", "deleted_at", "base_price");
