-- CreateEnum
CREATE TYPE "KycVerificationType" AS ENUM ('PAN', 'GST');

-- CreateEnum
CREATE TYPE "KycVerificationStatus" AS ENUM ('VERIFYING', 'VERIFIED', 'FAILED', 'MANUAL_REVIEW');

-- CreateTable
CREATE TABLE "kyc_verifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "owner_type" "EntityOwnerType" NOT NULL,
    "owner_id" UUID NOT NULL,
    "type" "KycVerificationType" NOT NULL,
    "status" "KycVerificationStatus" NOT NULL DEFAULT 'VERIFYING',
    "identifier_hash" TEXT NOT NULL,
    "identifier_masked" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "result" JSONB,
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "requested_by_id" UUID,
    "verified_at" TIMESTAMP(3),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kyc_verifications_owner_type_owner_id_type_created_at_idx" ON "kyc_verifications"("owner_type", "owner_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "kyc_verifications_organization_id_idx" ON "kyc_verifications"("organization_id");

-- CreateIndex
CREATE INDEX "kyc_verifications_identifier_hash_idx" ON "kyc_verifications"("identifier_hash");

-- CreateIndex
CREATE INDEX "kyc_verifications_status_idx" ON "kyc_verifications"("status");

-- Only one in-flight provider call per owner and type, so a double-clicked
-- "Verify" cannot fan out into parallel provider requests.
CREATE UNIQUE INDEX IF NOT EXISTS kyc_verifications_owner_type_inflight_uidx
ON kyc_verifications (owner_type, owner_id, type)
WHERE status = 'VERIFYING';
