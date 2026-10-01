-- CreateEnum
CREATE TYPE "SupportTicketChannel" AS ENUM ('WEB', 'APP');

-- AlterEnum
ALTER TYPE "EntityOwnerType" ADD VALUE IF NOT EXISTS 'SUPPORT_TICKET';

-- AlterTable
ALTER TABLE "support_tickets"
  ADD COLUMN "channel" "SupportTicketChannel" NOT NULL DEFAULT 'WEB',
  ADD COLUMN "resolution_note" TEXT;

-- CreateIndex
CREATE INDEX "support_tickets_status_updated_at_idx" ON "support_tickets"("status", "updated_at");
