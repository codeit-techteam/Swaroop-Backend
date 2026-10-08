-- CreateEnum
CREATE TYPE "WebsiteEnquiryTopic" AS ENUM ('BUY_MATERIALS', 'SELL_MATERIALS', 'CREDIT', 'LOGISTICS', 'PARTNERSHIP', 'OTHER');

-- CreateEnum
CREATE TYPE "WebsiteEnquiryStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'CLOSED');

-- CreateTable
CREATE TABLE "website_enquiries" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "topic" "WebsiteEnquiryTopic" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "WebsiteEnquiryStatus" NOT NULL DEFAULT 'NEW',
    "source" TEXT NOT NULL DEFAULT 'WEBSITE',
    "page_path" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "admin_notes" TEXT,
    "handled_by_user_id" UUID,
    "handled_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "website_enquiries_reference_number_key" ON "website_enquiries"("reference_number");

-- CreateIndex
CREATE INDEX "website_enquiries_status_created_at_idx" ON "website_enquiries"("status", "created_at");

-- CreateIndex
CREATE INDEX "website_enquiries_topic_idx" ON "website_enquiries"("topic");

-- CreateIndex
CREATE INDEX "website_enquiries_email_idx" ON "website_enquiries"("email");

-- CreateIndex
CREATE INDEX "website_enquiries_ip_address_created_at_idx" ON "website_enquiries"("ip_address", "created_at");

-- CreateIndex
CREATE INDEX "website_enquiries_created_at_idx" ON "website_enquiries"("created_at");
