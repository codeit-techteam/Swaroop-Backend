-- Native FCM registration fields and per-device delivery records.
-- Existing Expo rows stay revoked-or-ignored (provider remains "expo") and are not sent.
ALTER TABLE "device_push_tokens"
  ADD COLUMN IF NOT EXISTS "installation_id" TEXT;

CREATE INDEX IF NOT EXISTS "device_push_tokens_installation_id_revoked_at_idx"
  ON "device_push_tokens"("installation_id", "revoked_at");

CREATE TABLE IF NOT EXISTS "push_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "token_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_deliveries_notification_id_token_id_key"
  ON "push_deliveries"("notification_id", "token_id");
CREATE INDEX IF NOT EXISTS "push_deliveries_token_id_idx"
  ON "push_deliveries"("token_id");

DO $$ BEGIN
  ALTER TABLE "push_deliveries"
    ADD CONSTRAINT "push_deliveries_notification_id_fkey"
    FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "push_deliveries"
    ADD CONSTRAINT "push_deliveries_token_id_fkey"
    FOREIGN KEY ("token_id") REFERENCES "device_push_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
