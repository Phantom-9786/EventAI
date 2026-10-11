CREATE TYPE "RefundRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FAILED');

ALTER TABLE "payments"
  ADD COLUMN "refund_request_status" "RefundRequestStatus",
  ADD COLUMN "refund_request_reason" TEXT,
  ADD COLUMN "refund_requested_at" TIMESTAMP(3),
  ADD COLUMN "refund_reviewed_at" TIMESTAMP(3),
  ADD COLUMN "refund_reviewed_by" TEXT;

CREATE INDEX "payments_refund_request_status_idx"
  ON "payments"("refund_request_status");
