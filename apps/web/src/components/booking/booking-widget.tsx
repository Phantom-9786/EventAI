'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Ticket } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import {
  createBooking,
  createPaymentOrder,
  getTicketQr,
  verifyPayment,
  type BookingView,
  type TicketView,
} from '@/lib/booking';
import { formatPrice, type TicketTypeView } from '@/lib/api';
import { cn } from '@/lib/utils';

type Phase = 'idle' | 'creating' | 'paying' | 'verifying' | 'done';

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description?: string;
  prefill?: { email?: string };
  theme?: { color?: string };
  callback_url?: string;
  handler: (response: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => { open: () => void };
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function saleWindowOpen(t: TicketTypeView): boolean {
  const now = Date.now();
  return (
    (!t.saleStartDate || new Date(t.saleStartDate).getTime() <= now) &&
    (!t.saleEndDate || new Date(t.saleEndDate).getTime() >= now)
  );
}

export function BookingWidget({
  eventId,
  eventTitle,
  ticketTypes,
}: {
  eventId: string;
  eventTitle: string;
  ticketTypes: TicketTypeView[];
}) {
  const { user, loading } = useAuth();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<BookingView | null>(null);
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});
  const attemptRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const submitLock = useRef(false);

  const purchasable = useMemo(
    () => ticketTypes.filter((t) => t.availableQuantity > 0 && saleWindowOpen(t)),
    [ticketTypes],
  );

  const total = useMemo(
    () =>
      purchasable.reduce((sum, t) => {
        const price =
          typeof t.price === 'number' && Number.isFinite(t.price)
            ? Math.round(t.price)
            : 0;
        const qty = quantities[t.id] ?? 0;
        return sum + price * qty;
      }, 0),
    [purchasable, quantities],
  );

  const setQty = useCallback((t: TicketTypeView, next: number) => {
    const capped = Math.max(0, Math.min(next, t.maxPerBooking, t.availableQuantity));
    setQuantities((q) => ({ ...q, [t.id]: capped }));
  }, []);

  const busy = phase === 'creating' || phase === 'verifying';
  const selectedCount = Object.values(quantities).reduce((a, b) => a + b, 0);

  async function loadQrUrls(tickets: TicketView[]) {
    for (const ticket of tickets) {
      try {
        const dataUrl = await getTicketQr(ticket.id);
        setQrUrls((prev) => ({ ...prev, [ticket.id]: dataUrl }));
      } catch {
        // QR rendering failure degrades gracefully
      }
    }
  }

  async function onBook() {
    if (submitLock.current) return;
    setError(null);
    if (!user) return;
    const items = purchasable
      .map((t) => ({ ticketTypeId: t.id, quantity: quantities[t.id] ?? 0 }))
      .filter((i) => i.quantity > 0);
    if (items.length === 0) return;

    submitLock.current = true;
    const fingerprint = JSON.stringify({ eventId, items });
    if (attemptRef.current?.fingerprint !== fingerprint) {
      attemptRef.current = { fingerprint, idempotencyKey: crypto.randomUUID() };
    }

    setPhase('creating');
    try {
      const booking = await createBooking({
        eventId,
        items,
        idempotencyKey: attemptRef.current.idempotencyKey,
      });

      // If the booking is already confirmed (e.g. idempotency replay or free)
      if (booking.status === 'CONFIRMED') {
        setConfirmed(booking);
        attemptRef.current = null;
        setPhase('done');
        if (booking.tickets) void loadQrUrls(booking.tickets);
        return;
      }

      setPhase('paying');
      const order = await createPaymentOrder(booking.id);

      // Free bookings confirmed by the server
      if (order.amount === 0 || (order as { free?: boolean }).free) {
        setConfirmed(booking);
        attemptRef.current = null;
        setPhase('done');
        if (booking.tickets) void loadQrUrls(booking.tickets);
        return;
      }

      if (!order.keyId) {
        throw new Error(
          'Payments are not configured yet — your booking is held and will expire safely.',
        );
      }
      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) {
        throw new Error(
          'Could not load the payment gateway. Please check your connection.',
        );
      }

      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'EventPoint',
        description: eventTitle,
        prefill: { email: user.email },
        theme: { color: '#4f46e5' },
        callback_url: `${window.location.origin}/bookings/payment-callback/handler?bookingId=${booking.id}`,
        handler: (response) => {
          void (async () => {
            setPhase('verifying');
            try {
              const result = await verifyPayment({
                bookingId: booking.id,
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              });
              setConfirmed(result);
              attemptRef.current = null;
              setPhase('done');
              if (result.tickets) void loadQrUrls(result.tickets);
            } catch (err) {
              setError(
                err instanceof Error ? err.message : 'Payment verification failed',
              );
              setPhase('idle');
            } finally {
              submitLock.current = false;
            }
          })();
        },
        modal: {
          ondismiss: () => {
            setError(
              'Checkout was closed before payment completed. Your tickets are held for 10 minutes — you can retry.',
            );
            setPhase('idle');
            submitLock.current = false;
          },
        },
      });
      checkout.open();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      );
      setPhase('idle');
      submitLock.current = false;
    }
  }

  // ── Success panel ──────────────────────────────────
  if (phase === 'done' && confirmed) {
    return (
      <div className="mt-4 rounded-xl border border-green-500/20 bg-green-500/5 p-5">
        <div className="flex items-center gap-2 font-semibold text-green-700 dark:text-green-400">
          <CheckCircle2 className="h-5 w-5" />
          <span>Booking confirmed!</span>
        </div>
        <p className="mt-2 text-2xl font-bold tracking-tight">
          {formatPrice(confirmed.totalAmount)} paid
        </p>
        <p className="mt-1 text-xs text-muted-foreground font-mono">
          Booking #{confirmed.id}
        </p>

        {confirmed.tickets && confirmed.tickets.length > 0 ? (
          <div className="mt-4 space-y-3">
            {confirmed.tickets.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-sm"
              >
                {qrUrls[t.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrUrls[t.id]}
                    alt={`QR code for ${t.ticketCode}`}
                    className="h-16 w-16 rounded border bg-white p-0.5"
                  />
                ) : (
                  <div
                    className="flex h-16 w-16 items-center justify-center rounded border bg-muted"
                    aria-hidden
                  >
                    <Ticket className="h-6 w-6 text-muted-foreground/40" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold tracking-wide">
                    {t.ticketCode}
                  </p>
                  <p className="text-xs text-muted-foreground">{t.holderName}</p>
                  <span className="mt-1 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    Valid Entry
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Your digital tickets are being issued and will appear in My Tickets.
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <Link href="/tickets" className={cn(buttonVariants({ size: 'sm' }), 'w-full')}>
            Go to My Tickets <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
          <p className="text-center text-[11px] text-muted-foreground">
            Save or screenshot your ticket QR code for venue entrance.
          </p>
        </div>
      </div>
    );
  }

  // The approved preview presentation; payment state machine above is unchanged.
  return (
    <div className="ep-booking-widget">
      {purchasable.length === 0 ? (
        <div className="notice">Tickets are currently sold out or sales are closed.</div>
      ) : (
        purchasable.map((t) => {
          const qty = quantities[t.id] ?? 0;
          const max = Math.min(t.maxPerBooking, t.availableQuantity);
          return (
            <div key={t.id} className={'tier ' + (qty ? 'on' : '')}>
              <div className="tier-top">
                <h3>{t.name}</h3>
              </div>
              {t.description && <p>{t.description}</p>}
              <p>
                {t.availableQuantity} available · Max {t.maxPerBooking} per booking
              </p>
              <div className="tier-bottom">
                <strong>{formatPrice(t.price)}</strong>
                <div className="stepper" role="group" aria-label={t.name + ' quantity'}>
                  <button
                    type="button"
                    aria-label={'Remove one ' + t.name + ' ticket'}
                    disabled={busy || phase === 'paying' || qty === 0}
                    onClick={() => setQty(t, qty - 1)}
                  >
                    −
                  </button>
                  <output aria-live="polite">{qty}</output>
                  <button
                    type="button"
                    aria-label={'Add one ' + t.name + ' ticket'}
                    disabled={busy || phase === 'paying' || qty >= max}
                    onClick={() => setQty(t, qty + 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}
      <div className="order-total">
        <span>
          Total <small className="muted">({selectedCount} selected)</small>
        </span>
        <strong aria-live="polite">{formatPrice(total)}</strong>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <button className="btn full" disabled>
          Loading…
        </button>
      ) : user ? (
        <button
          type="button"
          className="btn full"
          disabled={busy || phase === 'paying' || selectedCount === 0}
          onClick={() => void onBook()}
        >
          {phase === 'creating'
            ? 'Reserving tickets…'
            : phase === 'paying'
              ? 'Opening payment gateway…'
              : phase === 'verifying'
                ? 'Confirming payment…'
                : 'Continue to checkout'}
          <ArrowRight className="icon" />
        </button>
      ) : (
        <Link
          className="btn full"
          href={'/signin?returnUrl=/events/' + encodeURIComponent(eventId)}
        >
          Sign in to book tickets
          <ArrowRight className="icon" />
        </Link>
      )}
      <p className="ticket-fineprint">
        Secure payment · Verified tickets
        <br />
        Final pricing and availability are verified at checkout.
      </p>
    </div>
  );
}
