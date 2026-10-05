-- CreateEnum
CREATE TYPE "GradeImportStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "grades" ADD COLUMN     "full_grade_name" TEXT,
ADD COLUMN     "grade_group" TEXT,
ADD COLUMN     "grade_no" TEXT,
ADD COLUMN     "import_batch_id" UUID,
ADD COLUMN     "in_todays_delhi_price_list" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_imported_at" TIMESTAMP(3),
ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "price_today_rs_kg" DECIMAL(12,2),
ADD COLUMN     "producer_price_rs_kg" DECIMAL(12,2),
ADD COLUMN     "producer_price_type" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "source_key" TEXT,
ADD COLUMN     "source_reference" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "grade_import_batches" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "status" "GradeImportStatus" NOT NULL DEFAULT 'RUNNING',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "inserted_rows" INTEGER NOT NULL DEFAULT 0,
    "updated_rows" INTEGER NOT NULL DEFAULT 0,
    "unchanged_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "categories_created" INTEGER NOT NULL DEFAULT 0,
    "grade_groups_created" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "error_message" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'ADMIN',
    "created_by_id" UUID,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "grade_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grade_import_batches_source_status_idx" ON "grade_import_batches"("source", "status");

-- CreateIndex
CREATE INDEX "grade_import_batches_file_sha256_idx" ON "grade_import_batches"("file_sha256");

-- CreateIndex
CREATE INDEX "grade_import_batches_started_at_idx" ON "grade_import_batches"("started_at");

-- CreateIndex
CREATE INDEX "grades_manufacturer_idx" ON "grades"("manufacturer");

-- CreateIndex
CREATE INDEX "grades_grade_group_idx" ON "grades"("grade_group");

-- CreateIndex
CREATE INDEX "grades_grade_no_idx" ON "grades"("grade_no");

-- CreateIndex
CREATE INDEX "grades_in_todays_delhi_price_list_idx" ON "grades"("in_todays_delhi_price_list");

-- CreateIndex
CREATE UNIQUE INDEX "grades_source_source_key_key" ON "grades"("source", "source_key");

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "grade_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

