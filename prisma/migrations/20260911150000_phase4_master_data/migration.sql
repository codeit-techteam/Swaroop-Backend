-- Phase 4: Master Data extensions

-- CreateEnum
CREATE TYPE "MasterStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AttributeDataType" AS ENUM ('TEXT', 'NUMBER', 'DECIMAL', 'BOOLEAN', 'SELECT');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('COUNTRY', 'STATE', 'CITY');

-- CreateEnum
CREATE TYPE "PaymentTermType" AS ENUM ('ADVANCE', 'PARTIAL_ADVANCE', 'ON_LOADING', 'ON_DELIVERY', 'NET_TERMS', 'LC', 'OTHER');

-- AlterTable grade_categories
ALTER TABLE "grade_categories" ADD COLUMN IF NOT EXISTS "display_name" TEXT;
ALTER TABLE "grade_categories" ADD COLUMN IF NOT EXISTS "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "grade_categories" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

-- AlterTable grades
ALTER TABLE "grades" ADD COLUMN IF NOT EXISTS "display_name" TEXT;
ALTER TABLE "grades" ADD COLUMN IF NOT EXISTS "subcategory_id" UUID;
ALTER TABLE "grades" ADD COLUMN IF NOT EXISTS "created_by_id" UUID;
ALTER TABLE "grades" ADD COLUMN IF NOT EXISTS "updated_by_id" UUID;

-- AlterTable warehouses
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "location_id" UUID;
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "contact_name" TEXT;
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "contact_phone" TEXT;
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "subcategories" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "description" TEXT,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "subcategories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "description" TEXT,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_applications" (
    "id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "description" TEXT,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "decimal_precision" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attributes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "description" TEXT,
    "data_type" "AttributeDataType" NOT NULL,
    "unit_id" UUID,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "parent_id" UUID,
    "country_code" TEXT,
    "state_code" TEXT,
    "pincode" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_terms" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "description" TEXT,
    "payment_type" "PaymentTermType" NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 0,
    "percentage" DECIMAL(5,2),
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "payment_terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "applications_code_key" ON "applications"("code");
CREATE INDEX "applications_status_idx" ON "applications"("status");
CREATE INDEX "applications_name_idx" ON "applications"("name");

CREATE UNIQUE INDEX "grade_applications_grade_id_application_id_key" ON "grade_applications"("grade_id", "application_id");

CREATE UNIQUE INDEX "units_code_key" ON "units"("code");
CREATE INDEX "units_status_idx" ON "units"("status");

CREATE UNIQUE INDEX "product_attributes_code_key" ON "product_attributes"("code");
CREATE INDEX "product_attributes_status_idx" ON "product_attributes"("status");
CREATE INDEX "product_attributes_data_type_idx" ON "product_attributes"("data_type");

CREATE UNIQUE INDEX "locations_code_key" ON "locations"("code");
CREATE INDEX "locations_type_status_idx" ON "locations"("type", "status");
CREATE INDEX "locations_parent_id_idx" ON "locations"("parent_id");
CREATE INDEX "locations_pincode_idx" ON "locations"("pincode");

CREATE UNIQUE INDEX "payment_terms_code_key" ON "payment_terms"("code");
CREATE INDEX "payment_terms_status_idx" ON "payment_terms"("status");
CREATE INDEX "payment_terms_payment_type_idx" ON "payment_terms"("payment_type");

CREATE UNIQUE INDEX "subcategories_category_id_code_key" ON "subcategories"("category_id", "code");
CREATE INDEX "subcategories_status_idx" ON "subcategories"("status");

CREATE INDEX "grade_categories_status_idx" ON "grade_categories"("status");
CREATE INDEX "grades_subcategory_id_idx" ON "grades"("subcategory_id");

CREATE INDEX "warehouses_location_id_idx" ON "warehouses"("location_id");
CREATE INDEX "warehouses_status_idx" ON "warehouses"("status");

-- AddForeignKey
ALTER TABLE "subcategories" ADD CONSTRAINT "subcategories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "grade_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "grade_applications" ADD CONSTRAINT "grade_applications_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grade_applications" ADD CONSTRAINT "grade_applications_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "grades" ADD CONSTRAINT "grades_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "subcategories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill display_name from name where null
UPDATE "grades" SET "display_name" = "name" WHERE "display_name" IS NULL;
UPDATE "grade_categories" SET "display_name" = "name" WHERE "display_name" IS NULL;
UPDATE "warehouses" SET "status" = CASE WHEN "is_active" THEN 'ACTIVE'::"MasterStatus" ELSE 'INACTIVE'::"MasterStatus" END;
UPDATE "grade_categories" SET "status" = CASE WHEN "is_active" THEN 'ACTIVE'::"MasterStatus" ELSE 'INACTIVE'::"MasterStatus" END;
