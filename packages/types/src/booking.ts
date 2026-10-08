// ── Booking types ──────────────────────────────────

export enum BookingStatus {
  PENDING = 'PENDING',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  REFUNDED = 'REFUNDED',
}

export interface Booking {
  id: string;
  userId: string;
  eventId: string;
  status: BookingStatus;
  totalAmount: number; // in paise
  currency: string;
  items: BookingItem[];
  paymentId?: string;
  idempotencyKey: string;
  expiresAt?: string;
  confirmedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookingItem {
  id: string;
  bookingId: string;
  ticketTypeId: string;
  seatId?: string;
  quantity: number;
  unitPrice: number; // in paise
  totalPrice: number; // in paise
}

export interface CreateBookingRequest {
  eventId: string;
  items: {
    ticketTypeId: string;
    quantity: number;
    seatIds?: string[];
  }[];
  idempotencyKey: string;
}

export interface BookingSummary {
  id: string;
  event: {
    id: string;
    title: string;
    slug: string;
    coverImage?: string;
    startDate: string;
  };
  status: BookingStatus;
  totalAmount: number;
  currency: string;
  itemCount: number;
  createdAt: string;
}

/** Seat hold — temporary reservation */
export interface SeatHold {
  userId: string;
  eventId: string;
  seatIds: string[];
  ticketTypeId: string;
  expiresAt: string;
  holdId: string;
}
