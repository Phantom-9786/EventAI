# Booking Engine

The booking pipeline is the heart of the platform. Every step is designed so concurrent requests can never oversell or double-charge.

## Flow

```
POST /bookings ──► PENDING  (stock decremented, expiresAt = now + SEAT_HOLD_TTL_SECONDS, default 600s)
POST /payments/order ──► PAYMENT_PENDING  (Razorpay order; retry reuses the open order)
POST /payments/verify  ┐
                       ├──► CONFIRMED  (payment CAPTURED, tickets minted idempotently, email sent)
POST /payments/webhook ┘
POST /bookings/:id/cancel ──► unpaid: CANCELLED (stock released) · CONFIRMED: delegates to refund
POST /payments/refund ──► REFUNDED (payment REFUNDED with refundId, tickets CANCELLED, stock restored)
        expiry cron (every minute) ──► stale PENDING/PAYMENT_PENDING → EXPIRED (stock released)
```

## Safety mechanisms

1. **Conditional stock decrement** — inventory is reserved with `ticketType.updateMany({ where: { id, availableQuantity: { gte: qty } } })` inside the booking transaction. A lost race aborts the whole transaction with 409; no overselling is possible.
2. **Server-side pricing** — totals are computed from current DB prices at booking time; client-sent amounts are never trusted.
3. **Idempotency** — `bookings.idempotency_key` is unique; a repeated key returns the original booking (403 if the key belongs to another user). Concurrent same-key requests resolve through the P2002 fallback path.
4. **Expiry re-checks** — the minute cron (take 200) and lazy read-time sweeps re-verify status inside their transactions, so a concurrent payment always wins over expiry.
5. **Refund ordering** — the Razorpay refund API is called *before* the state transaction (money first), and the payment is re-checked as CAPTURED inside the transaction to prevent double refunds under concurrency.
6. **Ticket check-in** — door validation flips `VALID → USED` and stamps `validatedAt`/`validatedBy`; already-used tickets are refused with 409 and the original timestamp.

## Frontend

`BookingWidget` on the event page: quantity steppers (capped by `maxPerBooking` and live stock), live total, sign-in gate, then booking → order → Razorpay Checkout.js → verification → ticket codes + QRs. Checkout dismissal keeps seats held until expiry. `/tickets` lists bookings with status chips and QR images. Organizers get a door scanner at `/dashboard/scan` (manual code entry + camera QR where the browser supports `BarcodeDetector`) with per-event stats and the attendee list.
