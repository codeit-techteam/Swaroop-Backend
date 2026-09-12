/*
  Warnings:

  - You are about to drop the `schema_meta` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'DELETED');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('CUSTOMER', 'SELLER', 'BOTH', 'PLATFORM');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('DRAFT', 'PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('DRAFT', 'PENDING_KYC', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('DRAFT', 'PENDING_VERIFICATION', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('BILLING', 'SHIPPING', 'REGISTERED', 'WAREHOUSE', 'OTHER');

-- CreateEnum
CREATE TYPE "GradeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "GradeParentGroup" AS ENUM ('POLYMERS', 'COMPOUNDS', 'MASTERBATCH', 'ELASTOMERS', 'CHEMICALS', 'SOLVENTS', 'INTERMEDIATES', 'RECYCLED', 'BASE_OILS', 'SPECIALTY');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('AVAILABLE', 'LOW', 'RESERVED', 'OUT_OF_STOCK', 'QUARANTINE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('INBOUND', 'OUTBOUND', 'RESERVE', 'RELEASE', 'ADJUSTMENT', 'TRANSFER', 'RETURN');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'EXPIRED', 'REJECTED', 'CLOSED', 'NEED_CHANGES');

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'SOURCING', 'OFFER_RECEIVED', 'NEGOTIATION', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED_TO_ORDER', 'CANCELLED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ProcurementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'SELLER_SOURCING', 'QUOTATION_RECEIVED', 'NEGOTIATION', 'APPROVAL_PENDING', 'APPROVED', 'CONVERTED_TO_PO', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT_TO_SELLER', 'SELLER_REVIEW', 'CONFIRMED', 'READY_FOR_DISPATCH', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'PROCUREMENT_STARTED', 'SUPPLIER_MATCHING', 'CONFIRMED', 'PROCESSING', 'LOADING_SCHEDULED', 'LOADING_COMPLETED', 'PAYMENT_PENDING', 'PAYMENT_VERIFIED', 'DISPATCH_READY', 'DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'DELAYED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ADVANCE', 'ON_LOADING', 'ON_DELIVERY', 'CREDIT_15', 'CREDIT_30', 'PARTIAL_ADVANCE', 'NET_TERMS', 'LC', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentRail" AS ENUM ('NEFT', 'RTGS', 'IMPS', 'UPI', 'NET_BANKING', 'CORPORATE_BANKING', 'LC', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'SUBMITTED', 'UNDER_VERIFICATION', 'PARTIALLY_PAID', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED', 'OVERDUE', 'REJECTED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PLANNED', 'SLOT_BOOKED', 'LOADING', 'DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELAYED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('TRAILER', 'TANKER', 'CONTAINER', 'TRUCK', 'TEMPO', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleSlotStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'CHECKED_IN', 'LOADING', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('KYC', 'GST', 'PAN', 'BANK', 'MSME', 'ISO', 'COA', 'MSDS', 'TDS', 'PURCHASE_ORDER', 'PROFORMA', 'INVOICE', 'GST_INVOICE', 'E_WAY_BILL', 'PACKING_LIST', 'DELIVERY_CHALLAN', 'TRANSPORT_RECEIPT', 'LOADING_SLIP', 'POD', 'PAYMENT_PROOF', 'SETTLEMENT_STATEMENT', 'CREDIT_APPLICATION', 'COMPLIANCE', 'PRODUCT_IMAGE', 'PRODUCT_TDS', 'OTHER');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('CLOUDFLARE_R2', 'LOCAL', 'OTHER');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'RELEASED', 'FAILED', 'CANCELLED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('NOT_APPLIED', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CurrencyCode" AS ENUM ('INR', 'USD', 'EUR', 'AED');

-- CreateEnum
CREATE TYPE "EntityOwnerType" AS ENUM ('USER', 'ORGANIZATION', 'CUSTOMER', 'SELLER', 'ADMIN', 'GRADE', 'PRODUCT', 'OFFER', 'PURCHASE_REQUEST', 'PROCUREMENT', 'PURCHASE_ORDER', 'ORDER', 'PAYMENT', 'SHIPMENT', 'SETTLEMENT', 'DOCUMENT', 'OTHER');

-- DropTable
DROP TABLE IF EXISTS "schema_meta";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "password_hash" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "type" "OrganizationType" NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'DRAFT',
    "business_type" TEXT,
    "constitution_type" TEXT,
    "industry" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "cin" TEXT,
    "msme_number" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "logo_url" TEXT,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "organization_id" UUID,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" "CustomerStatus" NOT NULL DEFAULT 'DRAFT',
    "credit_status" "CreditStatus" NOT NULL DEFAULT 'NOT_APPLIED',
    "preferred_currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_preferences" (
    "id" UUID NOT NULL,
    "customer_profile_id" UUID NOT NULL,
    "preferred_grades" JSONB,
    "preferred_payment_method" "PaymentMethod",
    "notify_email" BOOLEAN NOT NULL DEFAULT true,
    "notify_sms" BOOLEAN NOT NULL DEFAULT true,
    "notify_push" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_credit_profiles" (
    "id" UUID NOT NULL,
    "customer_profile_id" UUID NOT NULL,
    "status" "CreditStatus" NOT NULL DEFAULT 'PENDING',
    "requested_limit" DECIMAL(18,2),
    "approved_limit" DECIMAL(18,2),
    "available_limit" DECIMAL(18,2),
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "credit_term_days" INTEGER,
    "interest_rate_bps" INTEGER,
    "approved_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_credit_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" "SellerStatus" NOT NULL DEFAULT 'DRAFT',
    "seller_type" TEXT,
    "verification_notes" TEXT,
    "approved_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "seller_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_verifications" (
    "id" UUID NOT NULL,
    "seller_profile_id" UUID NOT NULL,
    "gst_verified" BOOLEAN NOT NULL DEFAULT false,
    "pan_verified" BOOLEAN NOT NULL DEFAULT false,
    "bank_verified" BOOLEAN NOT NULL DEFAULT false,
    "location_verified" BOOLEAN NOT NULL DEFAULT false,
    "overall_status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_at" TIMESTAMP(3),
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_compliance_profiles" (
    "id" UUID NOT NULL,
    "seller_profile_id" UUID NOT NULL,
    "iso_certified" BOOLEAN NOT NULL DEFAULT false,
    "msme_registered" BOOLEAN NOT NULL DEFAULT false,
    "compliance_notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_compliance_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "department" TEXT,
    "employee_id" TEXT,
    "status" "AdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "admin_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "AddressType" NOT NULL DEFAULT 'OTHER',
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "postal_code" TEXT NOT NULL,
    "landmark" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_holder" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "branch" TEXT,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_categories" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_group" "GradeParentGroup" NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grade_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "description" TEXT,
    "applications" JSONB,
    "status" "GradeStatus" NOT NULL DEFAULT 'ACTIVE',
    "customer_visible" BOOLEAN NOT NULL DEFAULT true,
    "seller_visible" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "hsn_code" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "seller_profile_id" UUID,
    "grade_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "manufacturer" TEXT,
    "description" TEXT,
    "technical_specs" JSONB,
    "mfi" TEXT,
    "density" TEXT,
    "packaging" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "country_of_origin" TEXT,
    "supply_origin" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "postal_code" TEXT,
    "address_line" TEXT,
    "is_platform_hub" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "seller_profile_id" UUID,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "available_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "reserved_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "sold_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "status" "InventoryStatus" NOT NULL DEFAULT 'AVAILABLE',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_lots" (
    "id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "lot_number" TEXT NOT NULL,
    "batch_number" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "manufactured_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "reference_type" TEXT,
    "reference_id" UUID,
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "seller_profile_id" UUID,
    "product_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "inventory_id" UUID,
    "warehouse_id" UUID,
    "quantity" DECIMAL(18,3) NOT NULL,
    "moq" DECIMAL(18,3),
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "base_price" DECIMAL(18,4) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "pricing_basis" TEXT,
    "payment_terms" JSONB,
    "delivery_terms" TEXT,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" TEXT DEFAULT 'MARKETPLACE',
    "created_by_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_price_tiers" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "min_qty" DECIMAL(18,3) NOT NULL,
    "max_qty" DECIMAL(18,3),
    "price" DECIMAL(18,4) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "payment_method" "PaymentMethod",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_revisions" (
    "id" UUID NOT NULL,
    "offer_id" UUID,
    "purchase_request_id" UUID,
    "previous_price" DECIMAL(18,4) NOT NULL,
    "proposed_price" DECIMAL(18,4) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "customer_profile_id" UUID,
    "seller_org_id" UUID,
    "created_by_id" UUID,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "payment_method" "PaymentMethod",
    "target_price" DECIMAL(18,4),
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "required_by_date" TIMESTAMP(3),
    "delivery_location" TEXT,
    "billing_address_id" UUID,
    "shipping_address_id" UUID,
    "notes" TEXT,
    "rejection_reason" TEXT,
    "metadata" JSONB,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_items" (
    "id" UUID NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "product_id" UUID,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "target_unit_price" DECIMAL(18,4),
    "packaging" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_cases" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "purchase_request_id" UUID NOT NULL,
    "organization_id" UUID,
    "status" "ProcurementStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_assignments" (
    "id" UUID NOT NULL,
    "procurement_case_id" UUID NOT NULL,
    "assignee_user_id" UUID NOT NULL,
    "role_label" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "procurement_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_activities" (
    "id" UUID NOT NULL,
    "procurement_case_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quotations" (
    "id" UUID NOT NULL,
    "procurement_case_id" UUID NOT NULL,
    "offer_id" UUID,
    "seller_org_id" UUID,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "payment_method" "PaymentMethod",
    "valid_until" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "purchase_request_id" UUID,
    "procurement_case_id" UUID,
    "customer_org_id" UUID NOT NULL,
    "seller_org_id" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payment_method" "PaymentMethod",
    "confirmed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "purchase_request_id" UUID,
    "purchase_order_id" UUID,
    "customer_org_id" UUID NOT NULL,
    "seller_org_id" UUID NOT NULL,
    "customer_profile_id" UUID,
    "seller_profile_id" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "freight_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "platform_fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payment_method" "PaymentMethod",
    "billing_address_snapshot" JSONB,
    "shipping_address_snapshot" JSONB,
    "notes" TEXT,
    "metadata" JSONB,
    "ordered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID,
    "grade_id" UUID NOT NULL,
    "offer_id" UUID,
    "description" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "unit_price" DECIMAL(18,4) NOT NULL,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "rail" "PaymentRail",
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "amount" DECIMAL(18,2) NOT NULL,
    "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pending_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "utr" TEXT,
    "paid_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "verified_by_id" UUID,
    "gateway_metadata" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "rail" "PaymentRail",
    "utr" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "processed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "order_id" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_status_history" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "from_status" "PaymentStatus",
    "to_status" "PaymentStatus" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "type" "VehicleType" NOT NULL DEFAULT 'TRUCK',
    "number_plate" TEXT NOT NULL,
    "transporter_name" TEXT,
    "driver_name" TEXT,
    "driver_phone" TEXT,
    "capacity_mt" DECIMAL(18,3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_slots" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "shipment_id" UUID,
    "slot_date" DATE NOT NULL,
    "time_slot" TEXT,
    "loading_bay" TEXT,
    "status" "VehicleSlotStatus" NOT NULL DEFAULT 'REQUESTED',
    "quantity_mt" DECIMAL(18,3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "customer_org_id" UUID NOT NULL,
    "seller_org_id" UUID NOT NULL,
    "origin_warehouse_id" UUID,
    "destination_warehouse_id" UUID,
    "vehicle_id" UUID,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PLANNED',
    "dispatched_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "eway_bill_number" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_items" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "order_item_id" UUID,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_tracking_events" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "location" TEXT,
    "notes" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "uploaded_by_id" UUID,
    "owner_type" "EntityOwnerType" NOT NULL,
    "owner_id" UUID NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT,
    "mime_type" TEXT,
    "file_size_bytes" BIGINT,
    "storage_provider" "StorageProvider" NOT NULL DEFAULT 'CLOUDFLARE_R2',
    "storage_key" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "verification_notes" TEXT,
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size_bytes" BIGINT,
    "mime_type" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "organization_id" UUID,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entity_type" "EntityOwnerType",
    "entity_id" UUID,
    "metadata" JSONB,
    "read_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "event_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "seller_profile_id" UUID,
    "order_id" UUID,
    "bank_account_id" UUID,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "gross_amount" DECIMAL(18,2) NOT NULL,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "platform_fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tds_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(18,2) NOT NULL,
    "settlement_date" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_items" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "payment_id" UUID,
    "description" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_transactions" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'INR',
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "txn_reference" TEXT,
    "processed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_status_history" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "from_status" "SettlementStatus",
    "to_status" "SettlementStatus" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "organization_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" "EntityOwnerType" NOT NULL,
    "entity_id" UUID,
    "previous_data" JSONB,
    "new_data" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");

-- CreateIndex
CREATE INDEX "organizations_type_idx" ON "organizations"("type");

-- CreateIndex
CREATE INDEX "organizations_status_idx" ON "organizations"("status");

-- CreateIndex
CREATE INDEX "organizations_gstin_idx" ON "organizations"("gstin");

-- CreateIndex
CREATE INDEX "organizations_pan_idx" ON "organizations"("pan");

-- CreateIndex
CREATE INDEX "organizations_verification_status_idx" ON "organizations"("verification_status");

-- CreateIndex
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");

-- CreateIndex
CREATE INDEX "organization_members_status_idx" ON "organization_members"("status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_id_key" ON "role_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE INDEX "user_roles_user_id_idx" ON "user_roles"("user_id");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_organization_id_key" ON "user_roles"("user_id", "role_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_user_id_key" ON "customer_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_organization_id_key" ON "customer_profiles"("organization_id");

-- CreateIndex
CREATE INDEX "customer_profiles_status_idx" ON "customer_profiles"("status");

-- CreateIndex
CREATE INDEX "customer_profiles_credit_status_idx" ON "customer_profiles"("credit_status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_preferences_customer_profile_id_key" ON "customer_preferences"("customer_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_profiles_customer_profile_id_key" ON "customer_credit_profiles"("customer_profile_id");

-- CreateIndex
CREATE INDEX "customer_credit_profiles_status_idx" ON "customer_credit_profiles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "seller_profiles_user_id_key" ON "seller_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_profiles_organization_id_key" ON "seller_profiles"("organization_id");

-- CreateIndex
CREATE INDEX "seller_profiles_status_idx" ON "seller_profiles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "seller_verifications_seller_profile_id_key" ON "seller_verifications"("seller_profile_id");

-- CreateIndex
CREATE INDEX "seller_verifications_overall_status_idx" ON "seller_verifications"("overall_status");

-- CreateIndex
CREATE UNIQUE INDEX "seller_compliance_profiles_seller_profile_id_key" ON "seller_compliance_profiles"("seller_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_profiles_user_id_key" ON "admin_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_profiles_employee_id_key" ON "admin_profiles"("employee_id");

-- CreateIndex
CREATE INDEX "admin_profiles_status_idx" ON "admin_profiles"("status");

-- CreateIndex
CREATE INDEX "addresses_organization_id_type_idx" ON "addresses"("organization_id", "type");

-- CreateIndex
CREATE INDEX "addresses_city_state_idx" ON "addresses"("city", "state");

-- CreateIndex
CREATE INDEX "bank_accounts_organization_id_idx" ON "bank_accounts"("organization_id");

-- CreateIndex
CREATE INDEX "bank_accounts_ifsc_idx" ON "bank_accounts"("ifsc");

-- CreateIndex
CREATE UNIQUE INDEX "grade_categories_code_key" ON "grade_categories"("code");

-- CreateIndex
CREATE INDEX "grade_categories_parent_group_idx" ON "grade_categories"("parent_group");

-- CreateIndex
CREATE INDEX "grade_categories_is_active_idx" ON "grade_categories"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "grades_code_key" ON "grades"("code");

-- CreateIndex
CREATE INDEX "grades_category_id_idx" ON "grades"("category_id");

-- CreateIndex
CREATE INDEX "grades_status_idx" ON "grades"("status");

-- CreateIndex
CREATE INDEX "grades_name_idx" ON "grades"("name");

-- CreateIndex
CREATE INDEX "grades_customer_visible_seller_visible_status_idx" ON "grades"("customer_visible", "seller_visible", "status");

-- CreateIndex
CREATE INDEX "products_grade_id_idx" ON "products"("grade_id");

-- CreateIndex
CREATE INDEX "products_seller_profile_id_idx" ON "products"("seller_profile_id");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_code_key" ON "products"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE INDEX "warehouses_organization_id_idx" ON "warehouses"("organization_id");

-- CreateIndex
CREATE INDEX "warehouses_city_state_idx" ON "warehouses"("city", "state");

-- CreateIndex
CREATE INDEX "inventory_organization_id_idx" ON "inventory"("organization_id");

-- CreateIndex
CREATE INDEX "inventory_seller_profile_id_idx" ON "inventory"("seller_profile_id");

-- CreateIndex
CREATE INDEX "inventory_status_idx" ON "inventory"("status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_product_id_warehouse_id_key" ON "inventory"("product_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_lots_batch_number_idx" ON "inventory_lots"("batch_number");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_lots_inventory_id_lot_number_key" ON "inventory_lots"("inventory_id", "lot_number");

-- CreateIndex
CREATE INDEX "stock_movements_inventory_id_created_at_idx" ON "stock_movements"("inventory_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_type_idx" ON "stock_movements"("type");

-- CreateIndex
CREATE INDEX "stock_movements_reference_type_reference_id_idx" ON "stock_movements"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "offers_reference_number_key" ON "offers"("reference_number");

-- CreateIndex
CREATE INDEX "offers_organization_id_status_idx" ON "offers"("organization_id", "status");

-- CreateIndex
CREATE INDEX "offers_seller_profile_id_idx" ON "offers"("seller_profile_id");

-- CreateIndex
CREATE INDEX "offers_product_id_idx" ON "offers"("product_id");

-- CreateIndex
CREATE INDEX "offers_grade_id_idx" ON "offers"("grade_id");

-- CreateIndex
CREATE INDEX "offers_status_valid_until_idx" ON "offers"("status", "valid_until");

-- CreateIndex
CREATE INDEX "offer_price_tiers_offer_id_idx" ON "offer_price_tiers"("offer_id");

-- CreateIndex
CREATE INDEX "price_revisions_offer_id_idx" ON "price_revisions"("offer_id");

-- CreateIndex
CREATE INDEX "price_revisions_purchase_request_id_idx" ON "price_revisions"("purchase_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_reference_number_key" ON "purchase_requests"("reference_number");

-- CreateIndex
CREATE INDEX "purchase_requests_customer_org_id_status_idx" ON "purchase_requests"("customer_org_id", "status");

-- CreateIndex
CREATE INDEX "purchase_requests_seller_org_id_idx" ON "purchase_requests"("seller_org_id");

-- CreateIndex
CREATE INDEX "purchase_requests_status_created_at_idx" ON "purchase_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "purchase_requests_priority_idx" ON "purchase_requests"("priority");

-- CreateIndex
CREATE INDEX "purchase_request_items_purchase_request_id_idx" ON "purchase_request_items"("purchase_request_id");

-- CreateIndex
CREATE INDEX "purchase_request_items_grade_id_idx" ON "purchase_request_items"("grade_id");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_cases_reference_number_key" ON "procurement_cases"("reference_number");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_cases_purchase_request_id_key" ON "procurement_cases"("purchase_request_id");

-- CreateIndex
CREATE INDEX "procurement_cases_status_idx" ON "procurement_cases"("status");

-- CreateIndex
CREATE INDEX "procurement_cases_priority_idx" ON "procurement_cases"("priority");

-- CreateIndex
CREATE INDEX "procurement_assignments_procurement_case_id_idx" ON "procurement_assignments"("procurement_case_id");

-- CreateIndex
CREATE INDEX "procurement_assignments_assignee_user_id_idx" ON "procurement_assignments"("assignee_user_id");

-- CreateIndex
CREATE INDEX "procurement_activities_procurement_case_id_created_at_idx" ON "procurement_activities"("procurement_case_id", "created_at");

-- CreateIndex
CREATE INDEX "supplier_quotations_procurement_case_id_idx" ON "supplier_quotations"("procurement_case_id");

-- CreateIndex
CREATE INDEX "supplier_quotations_offer_id_idx" ON "supplier_quotations"("offer_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_reference_number_key" ON "purchase_orders"("reference_number");

-- CreateIndex
CREATE INDEX "purchase_orders_customer_org_id_status_idx" ON "purchase_orders"("customer_org_id", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_seller_org_id_status_idx" ON "purchase_orders"("seller_org_id", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_status_created_at_idx" ON "purchase_orders"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_reference_number_key" ON "orders"("reference_number");

-- CreateIndex
CREATE INDEX "orders_customer_org_id_status_idx" ON "orders"("customer_org_id", "status");

-- CreateIndex
CREATE INDEX "orders_seller_org_id_status_idx" ON "orders"("seller_org_id", "status");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_ordered_at_idx" ON "orders"("ordered_at");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_grade_id_idx" ON "order_items"("grade_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_number_key" ON "payments"("reference_number");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_organization_id_idx" ON "payments"("organization_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_method_idx" ON "payments"("method");

-- CreateIndex
CREATE INDEX "payment_transactions_payment_id_idx" ON "payment_transactions"("payment_id");

-- CreateIndex
CREATE INDEX "payment_transactions_status_idx" ON "payment_transactions"("status");

-- CreateIndex
CREATE INDEX "payment_allocations_payment_id_idx" ON "payment_allocations"("payment_id");

-- CreateIndex
CREATE INDEX "payment_status_history_payment_id_created_at_idx" ON "payment_status_history"("payment_id", "created_at");

-- CreateIndex
CREATE INDEX "vehicles_type_idx" ON "vehicles"("type");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_number_plate_key" ON "vehicles"("number_plate");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_slots_shipment_id_key" ON "vehicle_slots"("shipment_id");

-- CreateIndex
CREATE INDEX "vehicle_slots_warehouse_id_slot_date_idx" ON "vehicle_slots"("warehouse_id", "slot_date");

-- CreateIndex
CREATE INDEX "vehicle_slots_status_idx" ON "vehicle_slots"("status");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_reference_number_key" ON "shipments"("reference_number");

-- CreateIndex
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- CreateIndex
CREATE INDEX "shipments_customer_org_id_idx" ON "shipments"("customer_org_id");

-- CreateIndex
CREATE INDEX "shipments_seller_org_id_idx" ON "shipments"("seller_org_id");

-- CreateIndex
CREATE INDEX "shipments_status_idx" ON "shipments"("status");

-- CreateIndex
CREATE INDEX "shipment_items_shipment_id_idx" ON "shipment_items"("shipment_id");

-- CreateIndex
CREATE INDEX "shipment_tracking_events_shipment_id_occurred_at_idx" ON "shipment_tracking_events"("shipment_id", "occurred_at");

-- CreateIndex
CREATE INDEX "documents_organization_id_idx" ON "documents"("organization_id");

-- CreateIndex
CREATE INDEX "documents_owner_type_owner_id_idx" ON "documents"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "documents_category_status_idx" ON "documents"("category", "status");

-- CreateIndex
CREATE INDEX "documents_storage_key_idx" ON "documents"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "document_versions"("document_id", "version_number");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_organization_id_idx" ON "notifications"("organization_id");

-- CreateIndex
CREATE INDEX "notifications_status_created_at_idx" ON "notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "notifications_entity_type_entity_id_idx" ON "notifications"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_channel_event_key_key" ON "notification_preferences"("user_id", "channel", "event_key");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_reference_number_key" ON "settlements"("reference_number");

-- CreateIndex
CREATE INDEX "settlements_organization_id_status_idx" ON "settlements"("organization_id", "status");

-- CreateIndex
CREATE INDEX "settlements_seller_profile_id_idx" ON "settlements"("seller_profile_id");

-- CreateIndex
CREATE INDEX "settlements_order_id_idx" ON "settlements"("order_id");

-- CreateIndex
CREATE INDEX "settlements_status_created_at_idx" ON "settlements"("status", "created_at");

-- CreateIndex
CREATE INDEX "settlement_items_settlement_id_idx" ON "settlement_items"("settlement_id");

-- CreateIndex
CREATE INDEX "settlement_transactions_settlement_id_idx" ON "settlement_transactions"("settlement_id");

-- CreateIndex
CREATE INDEX "settlement_status_history_settlement_id_created_at_idx" ON "settlement_status_history"("settlement_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_idx" ON "audit_logs"("organization_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_preferences" ADD CONSTRAINT "customer_preferences_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_profiles" ADD CONSTRAINT "customer_credit_profiles_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_verifications" ADD CONSTRAINT "seller_verifications_seller_profile_id_fkey" FOREIGN KEY ("seller_profile_id") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_compliance_profiles" ADD CONSTRAINT "seller_compliance_profiles_seller_profile_id_fkey" FOREIGN KEY ("seller_profile_id") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "grade_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_seller_profile_id_fkey" FOREIGN KEY ("seller_profile_id") REFERENCES "seller_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_seller_profile_id_fkey" FOREIGN KEY ("seller_profile_id") REFERENCES "seller_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_seller_profile_id_fkey" FOREIGN KEY ("seller_profile_id") REFERENCES "seller_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_price_tiers" ADD CONSTRAINT "offer_price_tiers_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_revisions" ADD CONSTRAINT "price_revisions_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_revisions" ADD CONSTRAINT "price_revisions_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_seller_org_id_fkey" FOREIGN KEY ("seller_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_cases" ADD CONSTRAINT "procurement_cases_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_cases" ADD CONSTRAINT "procurement_cases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_assignments" ADD CONSTRAINT "procurement_assignments_procurement_case_id_fkey" FOREIGN KEY ("procurement_case_id") REFERENCES "procurement_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_assignments" ADD CONSTRAINT "procurement_assignments_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_activities" ADD CONSTRAINT "procurement_activities_procurement_case_id_fkey" FOREIGN KEY ("procurement_case_id") REFERENCES "procurement_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_activities" ADD CONSTRAINT "procurement_activities_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotations" ADD CONSTRAINT "supplier_quotations_procurement_case_id_fkey" FOREIGN KEY ("procurement_case_id") REFERENCES "procurement_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotations" ADD CONSTRAINT "supplier_quotations_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_procurement_case_id_fkey" FOREIGN KEY ("procurement_case_id") REFERENCES "procurement_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_seller_org_id_fkey" FOREIGN KEY ("seller_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_org_id_fkey" FOREIGN KEY ("seller_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_profile_id_fkey" FOREIGN KEY ("seller_profile_id") REFERENCES "seller_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_slots" ADD CONSTRAINT "vehicle_slots_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_slots" ADD CONSTRAINT "vehicle_slots_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_slots" ADD CONSTRAINT "vehicle_slots_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_customer_org_id_fkey" FOREIGN KEY ("customer_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_seller_org_id_fkey" FOREIGN KEY ("seller_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_origin_warehouse_id_fkey" FOREIGN KEY ("origin_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_destination_warehouse_id_fkey" FOREIGN KEY ("destination_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_tracking_events" ADD CONSTRAINT "shipment_tracking_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_seller_profile_id_fkey" FOREIGN KEY ("seller_profile_id") REFERENCES "seller_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_transactions" ADD CONSTRAINT "settlement_transactions_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_status_history" ADD CONSTRAINT "settlement_status_history_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
