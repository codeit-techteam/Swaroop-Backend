-- Phase 9: Logistics, Dispatch, Vehicle, Shipment, Delivery

-- Enum extensions (committed via migration; defaults use pre-existing values only)
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'READY_TO_DISPATCH';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'DELIVERY_CONFIRMED';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'EXCEPTION';

ALTER TYPE "VehicleSlotStatus" ADD VALUE IF NOT EXISTS 'ASSIGNED';
ALTER TYPE "VehicleSlotStatus" ADD VALUE IF NOT EXISTS 'MISSED';

DO $$ BEGIN
  CREATE TYPE "VehicleOperationalStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'IN_TRANSIT', 'MAINTENANCE', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DispatchStatus" AS ENUM ('DRAFT', 'PLANNED', 'AWAITING_VEHICLE', 'VEHICLE_ASSIGNED', 'AWAITING_EWAY_BILL', 'READY_FOR_DISPATCH', 'LOADING', 'LOADED', 'DISPATCHED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DriverStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EWayBillStatus" AS ENUM ('PENDING', 'GENERATED', 'UPLOADED', 'VALID', 'EXPIRED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DeliveryStatus" AS ENUM ('SCHEDULED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CONFIRMED', 'FAILED', 'PARTIAL', 'CANCELLED', 'EXCEPTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DeliveryExceptionReason" AS ENUM ('VEHICLE_BREAKDOWN', 'ADDRESS_ISSUE', 'CUSTOMER_UNAVAILABLE', 'DAMAGED_MATERIAL', 'DOCUMENT_ISSUE', 'WEATHER_DELAY', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PO quantity tracking
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "ordered_quantity" DECIMAL(18,3);
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "dispatched_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "delivered_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0;

-- Drivers
CREATE TABLE IF NOT EXISTS "drivers" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "license_number" TEXT,
    "license_expiry" TIMESTAMP(3),
    "status" "DriverStatus" NOT NULL DEFAULT 'AVAILABLE',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "drivers_organization_id_idx" ON "drivers"("organization_id");
CREATE INDEX IF NOT EXISTS "drivers_status_idx" ON "drivers"("status");

-- Vehicles extensions
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "driver_id" UUID;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "status" "VehicleOperationalStatus" NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "insurance_expiry" TIMESTAMP(3);
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "fitness_expiry" TIMESTAMP(3);
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "permit_expiry" TIMESTAMP(3);
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "pollution_expiry" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "vehicles_organization_id_idx" ON "vehicles"("organization_id");
CREATE INDEX IF NOT EXISTS "vehicles_status_idx" ON "vehicles"("status");
ALTER TABLE "vehicles" DROP CONSTRAINT IF EXISTS "vehicles_driver_id_fkey";
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Dispatches
CREATE TABLE IF NOT EXISTS "dispatches" (
    "id" UUID NOT NULL,
    "dispatch_number" TEXT NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "seller_org_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'DRAFT',
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "planned_dispatch_date" TIMESTAMP(3),
    "actual_dispatch_date" TIMESTAMP(3),
    "loading_started_at" TIMESTAMP(3),
    "loading_completed_at" TIMESTAMP(3),
    "origin_warehouse_id" UUID,
    "destination_region" TEXT,
    "destination_snapshot" JSONB,
    "vehicle_id" UUID,
    "driver_id" UUID,
    "created_by_id" UUID,
    "idempotency_key" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "dispatches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "dispatches_dispatch_number_key" ON "dispatches"("dispatch_number");
CREATE UNIQUE INDEX IF NOT EXISTS "dispatches_idempotency_key_key" ON "dispatches"("idempotency_key");
CREATE INDEX IF NOT EXISTS "dispatches_purchase_order_id_status_idx" ON "dispatches"("purchase_order_id", "status");
CREATE INDEX IF NOT EXISTS "dispatches_seller_org_id_status_idx" ON "dispatches"("seller_org_id", "status");
CREATE INDEX IF NOT EXISTS "dispatches_customer_org_id_idx" ON "dispatches"("customer_org_id");
CREATE INDEX IF NOT EXISTS "dispatches_status_planned_dispatch_date_idx" ON "dispatches"("status", "planned_dispatch_date");

ALTER TABLE "dispatches" DROP CONSTRAINT IF EXISTS "dispatches_purchase_order_id_fkey";
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispatches" DROP CONSTRAINT IF EXISTS "dispatches_vehicle_id_fkey";
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dispatches" DROP CONSTRAINT IF EXISTS "dispatches_driver_id_fkey";
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Vehicle slots extensions
ALTER TABLE "vehicle_slots" ADD COLUMN IF NOT EXISTS "slot_number" TEXT;
ALTER TABLE "vehicle_slots" ADD COLUMN IF NOT EXISTS "dispatch_id" UUID;
ALTER TABLE "vehicle_slots" ADD COLUMN IF NOT EXISTS "start_time" TEXT;
ALTER TABLE "vehicle_slots" ADD COLUMN IF NOT EXISTS "end_time" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_slots_slot_number_key" ON "vehicle_slots"("slot_number");
CREATE INDEX IF NOT EXISTS "vehicle_slots_dispatch_id_idx" ON "vehicle_slots"("dispatch_id");
CREATE INDEX IF NOT EXISTS "vehicle_slots_vehicle_id_idx" ON "vehicle_slots"("vehicle_id");
ALTER TABLE "vehicle_slots" DROP CONSTRAINT IF EXISTS "vehicle_slots_dispatch_id_fkey";
ALTER TABLE "vehicle_slots" ADD CONSTRAINT "vehicle_slots_dispatch_id_fkey"
  FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- E-way bills
CREATE TABLE IF NOT EXISTS "eway_bills" (
    "id" UUID NOT NULL,
    "dispatch_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "eway_bill_number" TEXT NOT NULL,
    "status" "EWayBillStatus" NOT NULL DEFAULT 'PENDING',
    "generated_at" TIMESTAMP(3),
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "document_key" TEXT,
    "document_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "eway_bills_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "eway_bills_dispatch_id_idx" ON "eway_bills"("dispatch_id");
CREATE INDEX IF NOT EXISTS "eway_bills_purchase_order_id_idx" ON "eway_bills"("purchase_order_id");
CREATE INDEX IF NOT EXISTS "eway_bills_eway_bill_number_idx" ON "eway_bills"("eway_bill_number");
CREATE INDEX IF NOT EXISTS "eway_bills_status_idx" ON "eway_bills"("status");
ALTER TABLE "eway_bills" DROP CONSTRAINT IF EXISTS "eway_bills_dispatch_id_fkey";
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_dispatch_id_fkey"
  FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "eway_bills" DROP CONSTRAINT IF EXISTS "eway_bills_purchase_order_id_fkey";
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Shipments: PO-centric
ALTER TABLE "shipments" ALTER COLUMN "order_id" DROP NOT NULL;
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "purchase_order_id" UUID;
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "dispatch_id" UUID;
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "driver_id" UUID;
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "quantity" DECIMAL(18,3);
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'MT';
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "destination_snapshot" JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS "shipments_dispatch_id_key" ON "shipments"("dispatch_id");
CREATE INDEX IF NOT EXISTS "shipments_purchase_order_id_idx" ON "shipments"("purchase_order_id");
ALTER TABLE "shipments" DROP CONSTRAINT IF EXISTS "shipments_purchase_order_id_fkey";
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shipments" DROP CONSTRAINT IF EXISTS "shipments_dispatch_id_fkey";
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_dispatch_id_fkey"
  FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shipments" DROP CONSTRAINT IF EXISTS "shipments_driver_id_fkey";
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shipment_tracking_events" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "shipment_tracking_events" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "shipment_tracking_events" ADD COLUMN IF NOT EXISTS "created_by_id" UUID;

-- Deliveries
CREATE TABLE IF NOT EXISTS "deliveries" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "seller_org_id" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'SCHEDULED',
    "quantity" DECIMAL(18,3) NOT NULL,
    "delivered_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "scheduled_date" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "received_by" TEXT,
    "receiver_phone" TEXT,
    "delivery_note" TEXT,
    "pod_document_key" TEXT,
    "pod_document_id" UUID,
    "exception_reason" "DeliveryExceptionReason",
    "exception_note" TEXT,
    "exception_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "deliveries_shipment_id_key" ON "deliveries"("shipment_id");
CREATE INDEX IF NOT EXISTS "deliveries_purchase_order_id_status_idx" ON "deliveries"("purchase_order_id", "status");
CREATE INDEX IF NOT EXISTS "deliveries_customer_org_id_status_idx" ON "deliveries"("customer_org_id", "status");
CREATE INDEX IF NOT EXISTS "deliveries_seller_org_id_status_idx" ON "deliveries"("seller_org_id", "status");
CREATE INDEX IF NOT EXISTS "deliveries_status_idx" ON "deliveries"("status");
ALTER TABLE "deliveries" DROP CONSTRAINT IF EXISTS "deliveries_shipment_id_fkey";
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deliveries" DROP CONSTRAINT IF EXISTS "deliveries_purchase_order_id_fkey";
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Logistics events
CREATE TABLE IF NOT EXISTS "logistics_events" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID,
    "dispatch_id" UUID,
    "shipment_id" UUID,
    "delivery_id" UUID,
    "event_type" TEXT NOT NULL,
    "actor_role" TEXT,
    "actor_user_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "logistics_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "logistics_events_purchase_order_id_created_at_idx" ON "logistics_events"("purchase_order_id", "created_at");
CREATE INDEX IF NOT EXISTS "logistics_events_dispatch_id_created_at_idx" ON "logistics_events"("dispatch_id", "created_at");
CREATE INDEX IF NOT EXISTS "logistics_events_shipment_id_created_at_idx" ON "logistics_events"("shipment_id", "created_at");
CREATE INDEX IF NOT EXISTS "logistics_events_event_type_idx" ON "logistics_events"("event_type");

-- Backfill ordered_quantity from commercial snapshot when present
UPDATE "purchase_orders"
SET "ordered_quantity" = COALESCE(
  NULLIF(("metadata"->'commercialSnapshot'->>'quantity')::numeric, 0),
  "ordered_quantity"
)
WHERE "ordered_quantity" IS NULL
  AND "metadata"->'commercialSnapshot'->>'quantity' IS NOT NULL;
