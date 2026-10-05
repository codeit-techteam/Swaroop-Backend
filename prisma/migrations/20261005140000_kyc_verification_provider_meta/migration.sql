-- Provider reconciliation and request metadata for PAN / GSTIN verification attempts.
ALTER TABLE "kyc_verifications"
  ADD COLUMN "provider_reference" TEXT,
  ADD COLUMN "linked_pan_hash" TEXT,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "request_id" TEXT;

-- Admin queue: latest attempt per owner and type.
CREATE INDEX "kyc_verifications_owner_type_type_created_at_idx"
  ON "kyc_verifications"("owner_type", "type", "created_at");
