-- Phase 10 Documents + Storage-ready schema extensions

ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'REPLACED';
ALTER TYPE "StorageProvider" ADD VALUE IF NOT EXISTS 'NONE';

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "document_number" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "original_file_name" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "root_document_id" UUID;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "previous_document_id" UUID;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "approved_by_id" UUID;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "rejected_by_id" UUID;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "documents_document_number_key" ON "documents"("document_number");
CREATE INDEX IF NOT EXISTS "documents_status_expires_at_idx" ON "documents"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "documents_expires_at_idx" ON "documents"("expires_at");
CREATE INDEX IF NOT EXISTS "documents_uploaded_by_id_idx" ON "documents"("uploaded_by_id");
CREATE INDEX IF NOT EXISTS "documents_root_document_id_idx" ON "documents"("root_document_id");
CREATE INDEX IF NOT EXISTS "documents_created_at_idx" ON "documents"("created_at");

ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_root_document_id_fkey";
ALTER TABLE "documents" ADD CONSTRAINT "documents_root_document_id_fkey"
  FOREIGN KEY ("root_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_previous_document_id_fkey";
ALTER TABLE "documents" ADD CONSTRAINT "documents_previous_document_id_fkey"
  FOREIGN KEY ("previous_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill document numbers for existing rows
UPDATE "documents"
SET "document_number" = 'DOC-' || to_char("created_at", 'YYYY') || '-' || substr(replace("id"::text, '-', ''), 1, 12)
WHERE "document_number" IS NULL;
