-- CreateEnum
CREATE TYPE "AdminRoleType" AS ENUM ('OWNER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AdminInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "admin_role" "AdminRoleType";

-- CreateTable
CREATE TABLE "admin_invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "AdminRoleType" NOT NULL DEFAULT 'ADMIN',
    "token" TEXT NOT NULL,
    "status" "AdminInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invited_by_id" TEXT NOT NULL,
    "accepted_by_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_invitations_token_key" ON "admin_invitations"("token");

-- CreateIndex
CREATE INDEX "admin_invitations_email_idx" ON "admin_invitations"("email");

-- CreateIndex
CREATE INDEX "admin_invitations_status_idx" ON "admin_invitations"("status");

-- CreateIndex
CREATE INDEX "admin_invitations_expires_at_idx" ON "admin_invitations"("expires_at");

-- AddForeignKey
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
