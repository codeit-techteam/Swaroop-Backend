-- CreateEnum
CREATE TYPE "ImportShipmentStatus" AS ENUM ('BOOKED', 'SHIPPED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS_CLEARANCE', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportShipmentMode" AS ENUM ('SEA', 'AIR', 'ROAD', 'RAIL', 'MULTIMODAL');

-- AlterEnum
ALTER TYPE "EntityOwnerType" ADD VALUE 'IMPORT_SHIPMENT';

-- CreateTable
CREATE TABLE "import_shipments" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "deal_id" UUID NOT NULL,
    "buyer_org_id" UUID NOT NULL,
    "seller_org_id" UUID NOT NULL,
    "status" "ImportShipmentStatus" NOT NULL DEFAULT 'BOOKED',
    "mode" "ImportShipmentMode" NOT NULL DEFAULT 'SEA',
    "quantity" DECIMAL(18,3) NOT NULL,
    "quantity_unit" "ImportQuantityUnit" NOT NULL,
    "carrier_name" TEXT,
    "tracking_number" TEXT,
    "vessel_name" TEXT,
    "voyage_number" TEXT,
    "container_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "origin_location" TEXT,
    "destination_location" TEXT,
    "etd" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "departed_at" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "exception_reason" TEXT,
    "remarks" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_shipment_events" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "status" "ImportShipmentStatus" NOT NULL,
    "previous_status" "ImportShipmentStatus",
    "location" TEXT,
    "description" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "actor_party" "ImportTradeParty" NOT NULL,
    "actor_user_id" UUID,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_shipments_reference_number_key" ON "import_shipments"("reference_number");

-- CreateIndex
CREATE INDEX "import_shipments_deal_id_idx" ON "import_shipments"("deal_id");

-- CreateIndex
CREATE INDEX "import_shipments_buyer_org_id_status_idx" ON "import_shipments"("buyer_org_id", "status");

-- CreateIndex
CREATE INDEX "import_shipments_seller_org_id_status_idx" ON "import_shipments"("seller_org_id", "status");

-- CreateIndex
CREATE INDEX "import_shipments_status_updated_at_idx" ON "import_shipments"("status", "updated_at");

-- CreateIndex
CREATE INDEX "import_shipments_tracking_number_idx" ON "import_shipments"("tracking_number");

-- CreateIndex
CREATE INDEX "import_shipment_events_shipment_id_occurred_at_idx" ON "import_shipment_events"("shipment_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "import_shipments" ADD CONSTRAINT "import_shipments_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "import_deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_shipments" ADD CONSTRAINT "import_shipments_buyer_org_id_fkey" FOREIGN KEY ("buyer_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_shipments" ADD CONSTRAINT "import_shipments_seller_org_id_fkey" FOREIGN KEY ("seller_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_shipment_events" ADD CONSTRAINT "import_shipment_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "import_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Shipment tracking history is append-only.
CREATE OR REPLACE FUNCTION import_shipment_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'import_shipment_events rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "import_shipment_events_no_update"
  BEFORE UPDATE ON "import_shipment_events"
  FOR EACH ROW EXECUTE FUNCTION import_shipment_events_immutable();

-- Collision-safe shipment references (ISH-YYYYMM-NNNNNN).
CREATE SEQUENCE IF NOT EXISTS "import_shipment_ref_seq" START 1;
