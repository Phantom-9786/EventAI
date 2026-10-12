'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CalendarDays, Loader2, Ticket } from 'lucide-react';
import { BookingApiError, verifyPayment, type BookingView } from '@/lib/booking';
import { ApiError } from '@/lib/auth';
import { formatPrice } from '@/lib/api';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RZP_ID_RE = /^[A-Za-z0-9]+$/; // pay_… / order_… ids are alphanumeric
const SIGNATURE_RE = /^[0-9a-f]{32,128}$/i; // HMAC-SHA256 hex

type CallbackState =
  | 'verifying'
  | 'success'
  | 'failed' // Razorpay reported a payment failure/cancellation
  | 'invalid' // malformed or missing callback parameters
  | 'error'; // server-side verification failed

function PaymentCallbackPanel() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<CallbackState>('verifying');
  const [message, setMessage] = useState('');
  const [booking, setBooking] = useState<BookingView | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const bookingId = searchParams.get('bookingId') ?? '';
    const orderId = searchParams.get('razorpay_order_id') ?? '';
    const paymentId = searchParams.get('razorpay_payment_id') ?? '';
    const signature = searchParams.get('razorpay_signature') ?? '';
    const errorCode = searchParams.get('error_code');

    // Razorpay redirects here with error parameters on failure/cancellation.
    if (errorCode) {
      setState('failed');
      const description = searchParams.get('error_description') ?? '';
      setMessage(
        description
          ? `The payment did not go through: ${description}`
          : 'The payment did not go through. Your seats are held for a short while — you can retry from the event page.',
      );
      return;
    }

    // Shape-validate everything client-side; the server re-validates the
    // signature (HMAC) and the booking/order association before confirming.
    const shapeOk =
      UUID_RE.test(bookingId) &&
      /^order_/.test(orderId) &&
      RZP_ID_RE.test(orderId.slice(6)) &&
      /^pay_/.test(paymentId) &&
      RZP_ID_RE.test(paymentId.slice(4)) &&
      SIGNATURE_RE.test(signature);
    if (!shapeOk) {
      setState('invalid');
      setMessage(
        'This payment callback is missing or has malformed parameters. If you completed a payment, check My Tickets in a minute — it is verified server-side and cannot be lost.',
      );
      return;
    }

    verifyPayment({
      bookingId,
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
    })
      .then((result) => {
        setBooking(result);
        setState('success');
      })
      .catch((err: unknown) => {
        setState('error');
        const isAuth401 =
          (err instanceof BookingApiError && err.status === 401) ||
          (err instanceof ApiError && err.statusCode === 401);
        setMessage(
          isAuth401
            ? 'Please sign in to finish verifying this payment, then reopen this page or check My Tickets.'
            : err instanceof Error
              ? err.message
              : 'Payment verification failed',
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'verifying') {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Verifying your payment…</p>
      </div>
    );
  }

  if (state === 'success' && booking) {
    return (
      <div className="flex flex-col gap-3 text-center" role="status">
        <p className="flex items-center justify-center gap-2 text-sm font-medium text-green-600 dark:text-green-400">
          <Ticket className="h-4 w-4" />
          Booking confirmed!
        </p>
        <p className="text-2xl font-bold">{formatPrice(booking.totalAmount)} paid</p>
        {booking.tickets && booking.tickets.length > 0 ? (
          <div className="flex flex-col gap-2">
            {booking.tickets.map((t) => (
              <p key={t.id} className="rounded-md border p-2 font-mono text-sm">
                {t.ticketCode}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Your tickets are being issued…</p>
        )}
        <Link href="/tickets" className="text-sm font-medium text-primary hover:underline">
          View my tickets
        </Link>
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p role="alert" className="text-sm text-destructive">{message}</p>
        <Link href="/events" className="text-sm font-medium text-primary hover:underline">
          Back to events
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p role="alert" className="text-sm text-destructive">{message}</p>
      <Link href="/tickets" className="text-sm font-medium text-primary hover:underline">
        Go to my tickets
      </Link>
    </div>
  );
}

export default function PaymentCallbackPage() {
  return (
    <div className="container flex max-w-md flex-col py-16">
      <div className="mb-8 flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <CalendarDays className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Payment status</h1>
      </div>

      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <Suspense fallback={<Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}>
          <PaymentCallbackPanel />
        </Suspense>
      </div>
    </div>
  );
}
