-- AlterTable: add attempts and last_sent_at to email_verification_tokens
ALTER TABLE "email_verification_tokens" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "email_verification_tokens" ADD COLUMN "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
