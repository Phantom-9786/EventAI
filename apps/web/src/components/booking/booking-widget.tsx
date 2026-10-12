'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Loader2, Minus, Plus, ShieldCheck, Ticket } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
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
      purchasable.reduce(
        (sum, t) => sum + t.price * (quantities[t.id] ?? 0),
        0,
      ),
    [purchasable, quantities],
  );

  const setQty = useCallback(
    (t: TicketTypeView, next: number) => {
      const capped = Math.max(0, Math.min(next, t.maxPerBooking, t.availableQuantity));
      setQuantities((q) => ({ ...q, [t.id]: capped }));
    },
    [],
  );

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
        throw new Error('Could not load the payment gateway. Please check your connection.');
      }

      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'EventAI',
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
              setError(err instanceof Error ? err.message : 'Payment verification failed');
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
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
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
              <div key={t.id} className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-sm">
                {qrUrls[t.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrUrls[t.id]} alt={`QR code for ${t.ticketCode}`} className="h-16 w-16 rounded border bg-white p-0.5" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded border bg-muted" aria-hidden>
                    <Ticket className="h-6 w-6 text-muted-foreground/40" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold tracking-wide">{t.ticketCode}</p>
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
          <Link
            href="/tickets"
            className={cn(buttonVariants({ size: 'sm' }), 'w-full')}
          >
            Go to My Tickets <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
          <p className="text-center text-[11px] text-muted-foreground">
            Save or screenshot your ticket QR code for venue entrance.
          </p>
        </div>
      </div>
    );
  }

  // ── Booking panel ──────────────────────────────────
  return (
    <div className="mt-4 space-y-4">
      {purchasable.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          Tickets are currently sold out or sales are closed.
        </div>
      ) : (
        <div className="space-y-3">
          {purchasable.map((t) => {
            const currentQty = quantities[t.id] ?? 0;
            const maxAllowed = Math.min(t.maxPerBooking, t.availableQuantity);
            return (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card/60 p-3.5 transition-colors hover:border-primary/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{formatPrice(t.price)}</span>
                    {' · '}
                    {t.availableQuantity <= 10 ? (
                      <span className="font-medium text-amber-600 dark:text-amber-400">
                        Only {t.availableQuantity} left
                      </span>
                    ) : (
                      <span>Max {t.maxPerBooking}</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={`Remove one ${t.name} ticket`}
                    disabled={busy || currentQty === 0}
                    onClick={() => setQty(t, currentQty - 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-md border bg-background text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-7 text-center font-mono text-sm font-semibold" aria-live="polite">
                    {currentQty}
                  </span>
                  <button
                    type="button"
                    aria-label={`Add one ${t.name} ticket`}
                    disabled={busy || currentQty >= maxAllowed}
                    onClick={() => setQty(t, currentQty + 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-md border bg-background text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedCount > 0 && (
        <div className="rounded-lg bg-muted/50 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {selectedCount} ticket{selectedCount === 1 ? '' : 's'} selected
            </span>
            <span className="text-xl font-bold tracking-tight">{formatPrice(total)}</span>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {loading ? (
        <Button className="w-full" size="lg" disabled>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </Button>
      ) : user ? (
        <Button
          className="w-full text-base font-semibold shadow-md"
          size="lg"
          disabled={busy || phase === 'paying' || selectedCount === 0}
          onClick={() => void onBook()}
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {phase === 'creating'
            ? 'Reserving tickets…'
            : phase === 'paying'
              ? 'Opening payment gateway…'
              : phase === 'verifying'
                ? 'Confirming payment…'
                : selectedCount > 0
                  ? `Book Tickets · ${formatPrice(total)}`
                  : 'Select Tickets'}
        </Button>
      ) : (
        <Link
          href={`/signin?returnUrl=/events/${encodeURIComponent(eventId)}`}
          className={cn(buttonVariants({ size: 'lg' }), 'w-full text-base font-semibold')}
        >
          Sign in to complete booking
        </Link>
      )}

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
        Instant digital tickets & verified checkout
      </p>
    </div>
  );
}
