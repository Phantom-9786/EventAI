'use client';

// ═══════════════════════════════════════════════════
// Client-side booking + payment API calls (authed via
// authFetch: bearer token + silent refresh).
// ═══════════════════════════════════════════════════

import { authFetch } from './auth';

export class BookingApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'BookingApiError';
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await authFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
  } & T;
  if (!res.ok) {
    const message = Array.isArray(data.message)
      ? data.message.join(', ')
      : (data.message ?? `Request failed (${res.status})`);
    throw new BookingApiError(message, res.status);
  }
  return data;
}

export async function cancelBooking(bookingId: string, reason = 'Customer cancellation') {
  const { booking } = await postJson<{ booking: BookingListEntry }>(
    `/bookings/${bookingId}/cancel`,
    { reason },
  );
  return booking;
}

export async function refundBooking(bookingId: string, reason = 'Customer refund request') {
  return postJson<{
    refundRequest: {
      bookingId: string;
      status: 'PENDING';
      reason: string | null;
      requestedAt: string;
    };
  }>('/payments/refund', { bookingId, reason });
}

export interface BookingItemInput {
  ticketTypeId: string;
  quantity: number;
}

export interface TicketView {
  id: string;
  ticketCode: string;
  holderName: string;
  status: string;
}

export interface BookingView {
  id: string;
  status: string;
  totalAmount: number;
  expiresAt: string | null;
  tickets?: TicketView[];
  payment?: {
    id: string;
    status: string;
    amount: number;
    refundRequestStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'FAILED' | null;
    refundRequestReason?: string | null;
    refundRequestedAt?: string | null;
  } | null;
}

export async function createBooking(input: {
  eventId: string;
  items: BookingItemInput[];
  idempotencyKey: string;
}): Promise<BookingView> {
  const { booking } = await postJson<{ booking: BookingView }>('/bookings', input);
  return booking;
}

export interface PaymentOrder {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string | null;
}

export async function createPaymentOrder(bookingId: string): Promise<PaymentOrder> {
  return postJson<PaymentOrder>('/payments/order', { bookingId });
}

export async function verifyPayment(input: {
  bookingId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<BookingView> {
  const { booking } = await postJson<{ booking: BookingView }>('/payments/verify', input);
  return booking;
}

export async function getTicketQr(ticketId: string): Promise<string> {
  const res = await authFetch(`/payments/tickets/${ticketId}/qr`);
  if (!res.ok) throw new Error(`Failed to load QR (${res.status})`);
  const { dataUrl } = (await res.json()) as { dataUrl: string };
  return dataUrl;
}

export interface BookingListEntry extends BookingView {
  event: { id: string; title: string; slug: string; startDate: string; venue: { name: string; city: string } };
  items: { id: string; quantity: number; ticketType: { name: string } }[];
  totalAmount: number;
}

export async function listBookings(page = 1, limit = 20): Promise<{
  bookings: BookingListEntry[];
  total: number;
  pages: number;
}> {
  const res = await authFetch(`/bookings?page=${page}&limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to load bookings (${res.status})`);
  return res.json();
}
