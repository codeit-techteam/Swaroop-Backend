-- Seller Manager accounts: a User assigned to one Seller, with explicit permissions.
-- One active assignment per manager. One active primary manager per seller.

ALTER TABLE "users" ADD COLUMN "login_id" TEXT;
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "users_login_id_key" ON "users"("login_id");

ALTER TABLE "password_reset_tokens" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'PASSWORD_RESET';

CREATE TYPE "ManagerAssignmentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'REVOKED');

CREATE TABLE "seller_manager_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "seller_profile_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" "ManagerAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by_id" UUID,
    "deactivated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_manager_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_permission_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permission_grants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "seller_manager_assignments_user_id_status_idx" ON "seller_manager_assignments"("user_id", "status");
CREATE INDEX "seller_manager_assignments_seller_profile_id_status_idx" ON "seller_manager_assignments"("seller_profile_id", "status");
CREATE INDEX "seller_manager_assignments_assigned_by_id_idx" ON "seller_manager_assignments"("assigned_by_id");
CREATE UNIQUE INDEX "seller_manager_one_active" ON "seller_manager_assignments"("user_id") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "seller_manager_one_primary" ON "seller_manager_assignments"("seller_profile_id") WHERE "is_primary" = true AND "status" = 'ACTIVE';

CREATE UNIQUE INDEX "user_permission_grants_user_id_code_key" ON "user_permission_grants"("user_id", "code");
CREATE INDEX "user_permission_grants_user_id_idx" ON "user_permission_grants"("user_id");

ALTER TABLE "seller_manager_assignments" ADD CONSTRAINT "seller_manager_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seller_manager_assignments" ADD CONSTRAINT "seller_manager_assignments_seller_profile_id_fkey" FOREIGN KEY ("seller_profile_id") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seller_manager_assignments" ADD CONSTRAINT "seller_manager_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_permission_grants" ADD CONSTRAINT "user_permission_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE SEQUENCE IF NOT EXISTS "seller_manager_login_seq" START 1;
