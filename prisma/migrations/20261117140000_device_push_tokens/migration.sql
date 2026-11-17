-- Expo push tokens for the PolyStoreX app (com.polystorex.app).
-- Native FCM registration tokens are not stored.
CREATE TABLE IF NOT EXISTS "device_push_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'expo',
    "app_id" TEXT NOT NULL DEFAULT 'com.polystorex.app',
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_push_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "device_push_tokens_token_key" ON "device_push_tokens"("token");
CREATE INDEX IF NOT EXISTS "device_push_tokens_user_id_revoked_at_idx" ON "device_push_tokens"("user_id", "revoked_at");

DO $$ BEGIN
  ALTER TABLE "device_push_tokens"
    ADD CONSTRAINT "device_push_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
