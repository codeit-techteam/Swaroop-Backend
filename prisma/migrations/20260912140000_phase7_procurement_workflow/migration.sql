-- Phase 7: Seller PR response + negotiation + PO + procurement events

CREATE TYPE "NegotiationActorRole" AS ENUM ('CUSTOMER', 'SELLER', 'ADMIN', 'SYSTEM');
CREATE TYPE "CounterOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'EXPIRED');

ALTER TABLE "purchase_requests"
  ADD COLUMN IF NOT EXISTS "seller_responded_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "commercially_accepted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "commercial_snapshot" JSONB;

CREATE INDEX IF NOT EXISTS "purchase_requests_seller_org_id_status_idx"
  ON "purchase_requests"("seller_org_id", "status");
CREATE INDEX IF NOT EXISTS "purchase_requests_response_deadline_idx"
  ON "purchase_requests"("response_deadline");

CREATE TABLE IF NOT EXISTS "counter_offers" (
    "id" UUID NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "created_by_role" "NegotiationActorRole" NOT NULL,
    "created_by_user_id" UUID,
    "seller_profile_id" UUID,
    "round_number" INTEGER NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "payment_method" "PaymentMethod",
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "valid_until" TIMESTAMP(3),
    "note" TEXT,
    "status" "CounterOfferStatus" NOT NULL DEFAULT 'PENDING',
    "previous_counter_offer_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    CONSTRAINT "counter_offers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "counter_offers_purchase_request_id_round_number_idx"
  ON "counter_offers"("purchase_request_id", "round_number");
CREATE INDEX IF NOT EXISTS "counter_offers_purchase_request_id_status_idx"
  ON "counter_offers"("purchase_request_id", "status");
CREATE INDEX IF NOT EXISTS "counter_offers_status_valid_until_idx"
  ON "counter_offers"("status", "valid_until");

ALTER TABLE "counter_offers" DROP CONSTRAINT IF EXISTS "counter_offers_purchase_request_id_fkey";
ALTER TABLE "counter_offers" ADD CONSTRAINT "counter_offers_purchase_request_id_fkey"
  FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "counter_offers" DROP CONSTRAINT IF EXISTS "counter_offers_previous_counter_offer_id_fkey";
ALTER TABLE "counter_offers" ADD CONSTRAINT "counter_offers_previous_counter_offer_id_fkey"
  FOREIGN KEY ("previous_counter_offer_id") REFERENCES "counter_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "purchase_request_events" (
    "id" UUID NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_role" "NegotiationActorRole",
    "actor_user_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_request_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "purchase_request_events_purchase_request_id_created_at_idx"
  ON "purchase_request_events"("purchase_request_id", "created_at");
CREATE INDEX IF NOT EXISTS "purchase_request_events_event_type_idx"
  ON "purchase_request_events"("event_type");

ALTER TABLE "purchase_request_events" DROP CONSTRAINT IF EXISTS "purchase_request_events_purchase_request_id_fkey";
ALTER TABLE "purchase_request_events" ADD CONSTRAINT "purchase_request_events_purchase_request_id_fkey"
  FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One PO per purchase request (nullable unique allows multiple NULLs in PostgreSQL)
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_purchase_request_id_key"
  ON "purchase_orders"("purchase_request_id");
