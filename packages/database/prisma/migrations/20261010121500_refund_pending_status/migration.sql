-- Durable guard so a retry cannot issue a second provider refund while the first outcome is pending.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUND_PENDING' BEFORE 'REFUNDED';