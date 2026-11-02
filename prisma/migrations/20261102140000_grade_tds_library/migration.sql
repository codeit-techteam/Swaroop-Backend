-- CreateEnum
CREATE TYPE "TdsDocumentType" AS ENUM ('TDS', 'SDS', 'MSDS', 'COA', 'OTHER');

-- CreateEnum
CREATE TYPE "TdsVerificationStatus" AS ENUM ('PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'NEEDS_MAPPING', 'MISSING');

-- CreateEnum
CREATE TYPE "TdsSourceKind" AS ENUM ('APP', 'WEB', 'WEB_DEALER', 'WEB_MULTI_GRADE', 'WEB_DOUBTFUL', 'IMAGE', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TdsImportBatchStatus" AS ENUM ('RUNNING', 'DRY_RUN', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TdsRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'FULFILLED', 'REJECTED', 'CLOSED');

-- CreateTable
CREATE TABLE "tds_import_batches" (
    "id" UUID NOT NULL,
    "status" "TdsImportBatchStatus" NOT NULL DEFAULT 'RUNNING',
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "excel_file_name" TEXT,
    "zip_file_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trigger" TEXT NOT NULL DEFAULT 'CLI',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "stats" JSONB,
    "report" JSONB,
    "error_message" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tds_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_tds_documents" (
    "id" UUID NOT NULL,
    "import_key" TEXT NOT NULL,
    "grade_id" UUID,
    "category_code" TEXT NOT NULL,
    "grade_code" TEXT NOT NULL,
    "producer_name" TEXT NOT NULL,
    "document_title" TEXT NOT NULL,
    "document_type" "TdsDocumentType" NOT NULL DEFAULT 'TDS',
    "original_filename" TEXT,
    "storage_key" TEXT,
    "mime_type" TEXT,
    "file_size_bytes" BIGINT,
    "checksum" TEXT,
    "source_kind" "TdsSourceKind" NOT NULL DEFAULT 'UNKNOWN',
    "source_raw" TEXT,
    "source_url" TEXT,
    "source_file_path" TEXT,
    "workbook_availability" TEXT,
    "workbook_notes" TEXT,
    "verification_status" "TdsVerificationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "review_notes" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "mapping_confidence" TEXT,
    "import_batch_id" UUID,
    "uploaded_by_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "rejected_by_id" UUID,
    "rejected_at" TIMESTAMP(3),
    "effective_date" TIMESTAMP(3),
    "uploaded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "grade_tds_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tds_requests" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "customer_profile_id" UUID,
    "grade_id" UUID NOT NULL,
    "status" "TdsRequestStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT,
    "admin_notes" TEXT,
    "fulfilled_document_id" UUID,
    "assigned_to_user_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tds_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "grade_tds_documents_import_key_key" ON "grade_tds_documents"("import_key");

-- CreateIndex
CREATE INDEX "grade_tds_documents_grade_id_verification_status_is_active_idx" ON "grade_tds_documents"("grade_id", "verification_status", "is_active");

-- CreateIndex
CREATE INDEX "grade_tds_documents_category_code_idx" ON "grade_tds_documents"("category_code");

-- CreateIndex
CREATE INDEX "grade_tds_documents_grade_code_idx" ON "grade_tds_documents"("grade_code");

-- CreateIndex
CREATE INDEX "grade_tds_documents_producer_name_idx" ON "grade_tds_documents"("producer_name");

-- CreateIndex
CREATE INDEX "grade_tds_documents_verification_status_idx" ON "grade_tds_documents"("verification_status");

-- CreateIndex
CREATE INDEX "grade_tds_documents_source_kind_idx" ON "grade_tds_documents"("source_kind");

-- CreateIndex
CREATE INDEX "grade_tds_documents_checksum_idx" ON "grade_tds_documents"("checksum");

-- CreateIndex
CREATE INDEX "grade_tds_documents_storage_key_idx" ON "grade_tds_documents"("storage_key");

-- CreateIndex
CREATE INDEX "grade_tds_documents_import_batch_id_idx" ON "grade_tds_documents"("import_batch_id");

-- CreateIndex
CREATE INDEX "grade_tds_documents_created_at_idx" ON "grade_tds_documents"("created_at");

-- CreateIndex
CREATE INDEX "tds_import_batches_status_created_at_idx" ON "tds_import_batches"("status", "created_at");

-- CreateIndex
CREATE INDEX "tds_import_batches_created_at_idx" ON "tds_import_batches"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tds_requests_reference_number_key" ON "tds_requests"("reference_number");

-- CreateIndex
CREATE INDEX "tds_requests_user_id_created_at_idx" ON "tds_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "tds_requests_grade_id_status_idx" ON "tds_requests"("grade_id", "status");

-- CreateIndex
CREATE INDEX "tds_requests_status_created_at_idx" ON "tds_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "tds_requests_customer_profile_id_idx" ON "tds_requests"("customer_profile_id");

-- AddForeignKey
ALTER TABLE "grade_tds_documents" ADD CONSTRAINT "grade_tds_documents_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_tds_documents" ADD CONSTRAINT "grade_tds_documents_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "tds_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tds_requests" ADD CONSTRAINT "tds_requests_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tds_requests" ADD CONSTRAINT "tds_requests_fulfilled_document_id_fkey" FOREIGN KEY ("fulfilled_document_id") REFERENCES "grade_tds_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
