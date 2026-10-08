import { z } from 'zod';

export const createBookingSchema = z.object({
  eventId: z.string().uuid('Invalid event'),
  items: z
    .array(
      z.object({
        ticketTypeId: z.string().uuid('Invalid ticket type'),
        quantity: z.number().int().min(1).max(10),
        seatIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .min(1, 'At least one item is required')
    .max(5, 'Maximum 5 ticket types per booking'),
  idempotencyKey: z.string().uuid('Invalid idempotency key'),
});

export const verifyPaymentSchema = z.object({
  bookingId: z.string().uuid('Invalid booking'),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export const cancelBookingSchema = z.object({
  reason: z.string().max(500).optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
