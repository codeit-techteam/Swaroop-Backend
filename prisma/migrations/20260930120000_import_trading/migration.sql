-- Import Trading module (BUY RFQs / SELL offers). Additive only: new enums,
-- new tables, three nullable/defaulted columns on payment_terms, and new enum values.

-- CreateEnum
CREATE TYPE "ImportSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "ImportListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'MATCHING', 'OFFER_RECEIVED', 'NEGOTIATION', 'MATCHED', 'DEAL_CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'PAUSED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportQuantityUnit" AS ENUM ('MT', 'KG', 'CONTAINER', 'OTHER');

-- CreateEnum
CREATE TYPE "ImportPriceType" AS ENUM ('FIXED', 'NEGOTIABLE', 'INDICATIVE', 'FORMULA_BASED', 'INDEX_LINKED');

-- CreateEnum
CREATE TYPE "ImportGstTreatment" AS ENUM ('GST_EXTRA', 'GST_INCLUDED', 'GST_APPLICABLE', 'GST_EXEMPT_NIL', 'OTHER');

-- CreateEnum
CREATE TYPE "ImportShipmentPermission" AS ENUM ('ALLOWED', 'NOT_ALLOWED', 'NEGOTIABLE');

-- CreateEnum
CREATE TYPE "ImportShipmentType" AS ENUM ('FCL', 'LCL', 'BULK', 'CONTAINER');

-- CreateEnum
CREATE TYPE "ImportContainerSize" AS ENUM ('FT_20', 'FT_40', 'OTHER');

-- CreateEnum
CREATE TYPE "ImportInspectionType" AS ENUM ('NO_INSPECTION', 'SELLER_INSPECTION', 'SGS', 'BUREAU_VERITAS', 'OTHER_THIRD_PARTY', 'BUYER_INSPECTION');

-- CreateEnum
CREATE TYPE "ImportReadyStockType" AS ENUM ('READY_STOCK', 'PRODUCTION', 'FUTURE_SHIPMENT');

-- CreateEnum
CREATE TYPE "ImportListingSource" AS ENUM ('WEB', 'MOBILE', 'ADMIN', 'API', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "PortType" AS ENUM ('SEA', 'AIR', 'OTHER');

-- CreateEnum
CREATE TYPE "IncotermPriceBasis" AS ENUM ('ORIGIN', 'DESTINATION', 'ANY');

-- CreateEnum
CREATE TYPE "PaymentTermMethod" AS ENUM ('TT', 'LC', 'DP', 'OPEN_ACCOUNT', 'ADVANCE', 'CREDIT', 'OTHER');

-- CreateEnum
CREATE TYPE "ImportNegotiationStatus" AS ENUM ('OPEN', 'AGREED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportNegotiationEventType" AS ENUM ('OPENED', 'COUNTER', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ImportTradeParty" AS ENUM ('BUYER', 'SELLER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ImportMatchStatus" AS ENUM ('SUGGESTED', 'DISMISSED', 'NEGOTIATING', 'CONVERTED', 'STALE');

-- CreateEnum
CREATE TYPE "ImportDealStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentCategory" ADD VALUE 'CERTIFICATE_OF_ORIGIN';
ALTER TYPE "DocumentCategory" ADD VALUE 'COMMERCIAL_INVOICE';
ALTER TYPE "DocumentCategory" ADD VALUE 'BILL_OF_LADING';
ALTER TYPE "DocumentCategory" ADD VALUE 'INSPECTION_CERTIFICATE';
ALTER TYPE "DocumentCategory" ADD VALUE 'INSURANCE_CERTIFICATE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntityOwnerType" ADD VALUE 'IMPORT_LISTING';
ALTER TYPE "EntityOwnerType" ADD VALUE 'IMPORT_NEGOTIATION';
ALTER TYPE "EntityOwnerType" ADD VALUE 'IMPORT_DEAL';
ALTER TYPE "EntityOwnerType" ADD VALUE 'IMPORT_MASTER';

-- AlterTable
ALTER TABLE "payment_terms" ADD COLUMN     "currency_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "import_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "method" "PaymentTermMethod";

-- CreateTable
CREATE TABLE "currencies" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "decimal_places" INTEGER NOT NULL DEFAULT 2,
    "import_enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incoterms" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_basis" "IncotermPriceBasis" NOT NULL DEFAULT 'ANY',
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "incoterms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country_id" UUID,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ports" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country_id" UUID,
    "country_code" TEXT NOT NULL,
    "type" "PortType" NOT NULL DEFAULT 'SEA',
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "packaging_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requirements" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "document_category" "DocumentCategory" NOT NULL,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "document_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "match_weights" JSONB NOT NULL,
    "min_match_score" INTEGER NOT NULL DEFAULT 60,
    "allow_custom_grade" BOOLEAN NOT NULL DEFAULT true,
    "near_expiry_hours" INTEGER NOT NULL DEFAULT 24,
    "negotiation_ttl_hours" INTEGER NOT NULL DEFAULT 72,
    "notification_channels" TEXT[] DEFAULT ARRAY['IN_APP']::TEXT[],
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_listings" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "side" "ImportSide" NOT NULL,
    "status" "ImportListingStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "ImportListingSource" NOT NULL DEFAULT 'WEB',
    "version" INTEGER NOT NULL DEFAULT 1,
    "owner_org_id" UUID NOT NULL,
    "customer_profile_id" UUID,
    "seller_profile_id" UUID,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "category_id" UUID,
    "grade_id" UUID,
    "custom_grade_name" TEXT,
    "brand_id" UUID,
    "origin_country_id" UUID,
    "quantity" DECIMAL(18,3),
    "quantity_unit" "ImportQuantityUnit" NOT NULL DEFAULT 'MT',
    "packaging_id" UUID,
    "application" TEXT,
    "hs_code" TEXT,
    "cas_number" TEXT,
    "price" DECIMAL(18,4),
    "currency_id" UUID,
    "currency_code" TEXT,
    "price_unit" "ImportQuantityUnit" NOT NULL DEFAULT 'MT',
    "price_type" "ImportPriceType",
    "incoterm_id" UUID,
    "price_basis_port_id" UUID,
    "price_basis_location" TEXT,
    "payment_term_id" UUID,
    "gst_treatment" "ImportGstTreatment",
    "pol_id" UUID,
    "pod_id" UUID,
    "esd" DATE,
    "lsd" DATE,
    "transit_min_days" INTEGER,
    "transit_max_days" INTEGER,
    "partial_shipment" "ImportShipmentPermission",
    "transshipment" "ImportShipmentPermission",
    "shipment_type" "ImportShipmentType",
    "container_size" "ImportContainerSize",
    "container_count" INTEGER,
    "specification" TEXT,
    "inspection_type" "ImportInspectionType",
    "acceptable_quantity_min" DECIMAL(18,3),
    "acceptable_quantity_max" DECIMAL(18,3),
    "required_delivery_date" DATE,
    "special_requirements" TEXT,
    "moq" DECIMAL(18,3),
    "maximum_quantity" DECIMAL(18,3),
    "ready_stock_type" "ImportReadyStockType",
    "remarks" TEXT,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "near_expiry_notified_at" TIMESTAMP(3),
    "snapshot" JSONB,
    "raw_input" TEXT,
    "extraction" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "import_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_listing_document_requirements" (
    "listing_id" UUID NOT NULL,
    "document_requirement_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_listing_document_requirements_pkey" PRIMARY KEY ("listing_id","document_requirement_id")
);

-- CreateTable
CREATE TABLE "import_matches" (
    "id" UUID NOT NULL,
    "buy_listing_id" UUID NOT NULL,
    "sell_listing_id" UUID NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "matched_criteria" TEXT[],
    "unmatched_criteria" TEXT[],
    "evidence" JSONB NOT NULL,
    "weights" JSONB NOT NULL,
    "algorithm_version" TEXT NOT NULL,
    "status" "ImportMatchStatus" NOT NULL DEFAULT 'SUGGESTED',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_negotiations" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "status" "ImportNegotiationStatus" NOT NULL DEFAULT 'OPEN',
    "buy_listing_id" UUID,
    "sell_listing_id" UUID,
    "match_id" UUID,
    "buyer_org_id" UUID NOT NULL,
    "seller_org_id" UUID NOT NULL,
    "initiated_by" "ImportTradeParty" NOT NULL,
    "last_actor_party" "ImportTradeParty",
    "round_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "agreed_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_negotiations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_negotiation_events" (
    "id" UUID NOT NULL,
    "negotiation_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "ImportNegotiationEventType" NOT NULL,
    "actor_party" "ImportTradeParty" NOT NULL,
    "actor_user_id" UUID,
    "price" DECIMAL(18,4),
    "currency_code" TEXT,
    "price_unit" "ImportQuantityUnit",
    "quantity" DECIMAL(18,3),
    "quantity_unit" "ImportQuantityUnit",
    "moq" DECIMAL(18,3),
    "incoterm_id" UUID,
    "incoterm_code" TEXT,
    "payment_term_id" UUID,
    "payment_term_name" TEXT,
    "esd" DATE,
    "lsd" DATE,
    "inspection_type" "ImportInspectionType",
    "other_terms" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_negotiation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_deals" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "negotiation_id" UUID NOT NULL,
    "buy_listing_id" UUID,
    "sell_listing_id" UUID,
    "buyer_org_id" UUID NOT NULL,
    "seller_org_id" UUID NOT NULL,
    "status" "ImportDealStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "price" DECIMAL(18,4) NOT NULL,
    "currency_code" TEXT NOT NULL,
    "price_unit" "ImportQuantityUnit" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "quantity_unit" "ImportQuantityUnit" NOT NULL,
    "incoterm_code" TEXT,
    "price_basis_location" TEXT,
    "payment_term_name" TEXT,
    "esd" DATE,
    "lsd" DATE,
    "terms" JSONB NOT NULL,
    "buyer_confirmed_at" TIMESTAMP(3),
    "seller_confirmed_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_idempotency_records" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "currencies_code_key" ON "currencies"("code");

-- CreateIndex
CREATE INDEX "currencies_status_import_enabled_idx" ON "currencies"("status", "import_enabled");

-- CreateIndex
CREATE UNIQUE INDEX "incoterms_code_key" ON "incoterms"("code");

-- CreateIndex
CREATE INDEX "incoterms_status_idx" ON "incoterms"("status");

-- CreateIndex
CREATE UNIQUE INDEX "brands_code_key" ON "brands"("code");

-- CreateIndex
CREATE INDEX "brands_status_idx" ON "brands"("status");

-- CreateIndex
CREATE INDEX "brands_name_idx" ON "brands"("name");

-- CreateIndex
CREATE INDEX "brands_country_id_idx" ON "brands"("country_id");

-- CreateIndex
CREATE UNIQUE INDEX "ports_code_key" ON "ports"("code");

-- CreateIndex
CREATE INDEX "ports_status_type_idx" ON "ports"("status", "type");

-- CreateIndex
CREATE INDEX "ports_country_code_idx" ON "ports"("country_code");

-- CreateIndex
CREATE INDEX "ports_name_idx" ON "ports"("name");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_types_code_key" ON "packaging_types"("code");

-- CreateIndex
CREATE INDEX "packaging_types_status_idx" ON "packaging_types"("status");

-- CreateIndex
CREATE UNIQUE INDEX "document_requirements_code_key" ON "document_requirements"("code");

-- CreateIndex
CREATE INDEX "document_requirements_status_idx" ON "document_requirements"("status");

-- CreateIndex
CREATE UNIQUE INDEX "import_listings_reference_number_key" ON "import_listings"("reference_number");

-- CreateIndex
CREATE INDEX "import_listings_side_status_valid_until_idx" ON "import_listings"("side", "status", "valid_until");

-- CreateIndex
CREATE INDEX "import_listings_side_status_category_id_created_at_idx" ON "import_listings"("side", "status", "category_id", "created_at");

-- CreateIndex
CREATE INDEX "import_listings_owner_org_id_side_status_idx" ON "import_listings"("owner_org_id", "side", "status");

-- CreateIndex
CREATE INDEX "import_listings_customer_profile_id_idx" ON "import_listings"("customer_profile_id");

-- CreateIndex
CREATE INDEX "import_listings_seller_profile_id_idx" ON "import_listings"("seller_profile_id");

-- CreateIndex
CREATE INDEX "import_listings_grade_id_idx" ON "import_listings"("grade_id");

-- CreateIndex
CREATE INDEX "import_listings_brand_id_idx" ON "import_listings"("brand_id");

-- CreateIndex
CREATE INDEX "import_listings_origin_country_id_idx" ON "import_listings"("origin_country_id");

-- CreateIndex
CREATE INDEX "import_listings_currency_id_idx" ON "import_listings"("currency_id");

-- CreateIndex
CREATE INDEX "import_listings_incoterm_id_idx" ON "import_listings"("incoterm_id");

-- CreateIndex
CREATE INDEX "import_listings_pol_id_idx" ON "import_listings"("pol_id");

-- CreateIndex
CREATE INDEX "import_listings_pod_id_idx" ON "import_listings"("pod_id");

-- CreateIndex
CREATE INDEX "import_listings_esd_lsd_idx" ON "import_listings"("esd", "lsd");

-- CreateIndex
CREATE INDEX "import_listings_created_at_idx" ON "import_listings"("created_at");

-- CreateIndex
CREATE INDEX "import_listing_document_requirements_document_requirement_i_idx" ON "import_listing_document_requirements"("document_requirement_id");

-- CreateIndex
CREATE INDEX "import_matches_buy_listing_id_score_idx" ON "import_matches"("buy_listing_id", "score");

-- CreateIndex
CREATE INDEX "import_matches_sell_listing_id_score_idx" ON "import_matches"("sell_listing_id", "score");

-- CreateIndex
CREATE INDEX "import_matches_status_computed_at_idx" ON "import_matches"("status", "computed_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_matches_buy_listing_id_sell_listing_id_key" ON "import_matches"("buy_listing_id", "sell_listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_negotiations_reference_number_key" ON "import_negotiations"("reference_number");

-- CreateIndex
CREATE INDEX "import_negotiations_buyer_org_id_status_idx" ON "import_negotiations"("buyer_org_id", "status");

-- CreateIndex
CREATE INDEX "import_negotiations_seller_org_id_status_idx" ON "import_negotiations"("seller_org_id", "status");

-- CreateIndex
CREATE INDEX "import_negotiations_buy_listing_id_status_idx" ON "import_negotiations"("buy_listing_id", "status");

-- CreateIndex
CREATE INDEX "import_negotiations_sell_listing_id_status_idx" ON "import_negotiations"("sell_listing_id", "status");

-- CreateIndex
CREATE INDEX "import_negotiations_status_expires_at_idx" ON "import_negotiations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "import_negotiation_events_negotiation_id_created_at_idx" ON "import_negotiation_events"("negotiation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_negotiation_events_negotiation_id_sequence_key" ON "import_negotiation_events"("negotiation_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "import_deals_reference_number_key" ON "import_deals"("reference_number");

-- CreateIndex
CREATE UNIQUE INDEX "import_deals_negotiation_id_key" ON "import_deals"("negotiation_id");

-- CreateIndex
CREATE INDEX "import_deals_buyer_org_id_status_idx" ON "import_deals"("buyer_org_id", "status");

-- CreateIndex
CREATE INDEX "import_deals_seller_org_id_status_idx" ON "import_deals"("seller_org_id", "status");

-- CreateIndex
CREATE INDEX "import_deals_status_created_at_idx" ON "import_deals"("status", "created_at");

-- CreateIndex
CREATE INDEX "import_idempotency_records_created_at_idx" ON "import_idempotency_records"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_idempotency_records_actor_user_id_scope_key_key" ON "import_idempotency_records"("actor_user_id", "scope", "key");

-- CreateIndex
CREATE INDEX "payment_terms_import_enabled_status_idx" ON "payment_terms"("import_enabled", "status");

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ports" ADD CONSTRAINT "ports_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_owner_org_id_fkey" FOREIGN KEY ("owner_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_seller_profile_id_fkey" FOREIGN KEY ("seller_profile_id") REFERENCES "seller_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "grade_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_origin_country_id_fkey" FOREIGN KEY ("origin_country_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_packaging_id_fkey" FOREIGN KEY ("packaging_id") REFERENCES "packaging_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_incoterm_id_fkey" FOREIGN KEY ("incoterm_id") REFERENCES "incoterms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_price_basis_port_id_fkey" FOREIGN KEY ("price_basis_port_id") REFERENCES "ports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_pol_id_fkey" FOREIGN KEY ("pol_id") REFERENCES "ports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_pod_id_fkey" FOREIGN KEY ("pod_id") REFERENCES "ports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listing_document_requirements" ADD CONSTRAINT "import_listing_document_requirements_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "import_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_listing_document_requirements" ADD CONSTRAINT "import_listing_document_requirements_document_requirement__fkey" FOREIGN KEY ("document_requirement_id") REFERENCES "document_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_matches" ADD CONSTRAINT "import_matches_buy_listing_id_fkey" FOREIGN KEY ("buy_listing_id") REFERENCES "import_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_matches" ADD CONSTRAINT "import_matches_sell_listing_id_fkey" FOREIGN KEY ("sell_listing_id") REFERENCES "import_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_negotiations" ADD CONSTRAINT "import_negotiations_buy_listing_id_fkey" FOREIGN KEY ("buy_listing_id") REFERENCES "import_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_negotiations" ADD CONSTRAINT "import_negotiations_sell_listing_id_fkey" FOREIGN KEY ("sell_listing_id") REFERENCES "import_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_negotiations" ADD CONSTRAINT "import_negotiations_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "import_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_negotiations" ADD CONSTRAINT "import_negotiations_buyer_org_id_fkey" FOREIGN KEY ("buyer_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_negotiations" ADD CONSTRAINT "import_negotiations_seller_org_id_fkey" FOREIGN KEY ("seller_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_negotiation_events" ADD CONSTRAINT "import_negotiation_events_negotiation_id_fkey" FOREIGN KEY ("negotiation_id") REFERENCES "import_negotiations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_deals" ADD CONSTRAINT "import_deals_negotiation_id_fkey" FOREIGN KEY ("negotiation_id") REFERENCES "import_negotiations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_deals" ADD CONSTRAINT "import_deals_buy_listing_id_fkey" FOREIGN KEY ("buy_listing_id") REFERENCES "import_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_deals" ADD CONSTRAINT "import_deals_sell_listing_id_fkey" FOREIGN KEY ("sell_listing_id") REFERENCES "import_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_deals" ADD CONSTRAINT "import_deals_buyer_org_id_fkey" FOREIGN KEY ("buyer_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_deals" ADD CONSTRAINT "import_deals_seller_org_id_fkey" FOREIGN KEY ("seller_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One OPEN negotiation per listing and counterparty organisation.
CREATE UNIQUE INDEX "import_negotiations_open_sell_buyer_key"
  ON "import_negotiations"("sell_listing_id", "buyer_org_id")
  WHERE "status" = 'OPEN' AND "sell_listing_id" IS NOT NULL;
CREATE UNIQUE INDEX "import_negotiations_open_buy_seller_key"
  ON "import_negotiations"("buy_listing_id", "seller_org_id")
  WHERE "status" = 'OPEN' AND "buy_listing_id" IS NOT NULL;

ALTER TABLE "import_negotiations" ADD CONSTRAINT "import_negotiations_listing_present"
  CHECK ("buy_listing_id" IS NOT NULL OR "sell_listing_id" IS NOT NULL);
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_shipment_window"
  CHECK ("esd" IS NULL OR "lsd" IS NULL OR "esd" <= "lsd");
ALTER TABLE "import_listings" ADD CONSTRAINT "import_listings_transit_window"
  CHECK ("transit_min_days" IS NULL OR "transit_max_days" IS NULL OR "transit_min_days" <= "transit_max_days");

-- Negotiation history is append-only.
CREATE OR REPLACE FUNCTION import_negotiation_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'import_negotiation_events rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "import_negotiation_events_no_update"
  BEFORE UPDATE ON "import_negotiation_events"
  FOR EACH ROW EXECUTE FUNCTION import_negotiation_events_immutable();

-- Collision-safe reference numbers (IBR-/ISO-/INE-/IDL-YYYYMM-NNNNNN).
CREATE SEQUENCE IF NOT EXISTS "import_buy_ref_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "import_sell_ref_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "import_negotiation_ref_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "import_deal_ref_seq" START 1;
