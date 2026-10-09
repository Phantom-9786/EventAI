'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Minus, Plus, ShieldCheck, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
        // QR is decorative in the success panel; ignore failures
      }
    }
  }

  async function onBook() {
    setError(null);
    if (!user) return; // button renders a sign-in link when logged out
    const items = purchasable
      .map((t) => ({ ticketTypeId: t.id, quantity: quantities[t.id] ?? 0 }))
      .filter((i) => i.quantity > 0);
    if (items.length === 0) return;

    setPhase('creating');
    try {
      const booking = await createBooking({
        eventId,
        items,
        idempotencyKey: crypto.randomUUID(),
      });

      setPhase('paying');
      const order = await createPaymentOrder(booking.id);
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
        theme: { color: '#6d28d9' },
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
              setPhase('done');
              if (result.tickets) void loadQrUrls(result.tickets);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Payment verification failed');
              setPhase('idle');
            }
          })();
        },
        modal: {
          ondismiss: () => {
            setError(
              'Checkout was closed before payment. Your seats are held for a short while — you can retry.',
            );
            setPhase('idle');
          },
        },
      });
      checkout.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setPhase('idle');
    }
  }

  // ── Success panel ──────────────────────────────────
  if (phase === 'done' && confirmed) {
    return (
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <p className="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-400">
          <Ticket className="h-4 w-4" />
          Booking confirmed!
        </p>
        <p className="mt-1 text-2xl font-bold">{formatPrice(confirmed.totalAmount)} paid</p>
        {confirmed.tickets && confirmed.tickets.length > 0 ? (
          <div className="mt-4 flex flex-col gap-3">
            {confirmed.tickets.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-md border p-3">
                {qrUrls[t.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrUrls[t.id]} alt={`QR for ${t.ticketCode}`} className="h-16 w-16" />
                ) : (
                  <div className="h-16 w-16 animate-pulse rounded bg-muted" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-medium">{t.ticketCode}</p>
                  <p className="text-xs text-muted-foreground">{t.holderName}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Your tickets are being issued…
          </p>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Keep your ticket codes safe — they are scanned at the venue entry.
        </p>
      </div>
    );
  }

  // ── Booking panel ──────────────────────────────────
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      {purchasable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tickets are sold out or not on sale right now.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {purchasable.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatPrice(t.price)} · max {t.maxPerBooking} per booking
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label={`Remove one ${t.name} ticket`}
                  disabled={busy || !user || (quantities[t.id] ?? 0) === 0}
                  onClick={() => setQty(t, (quantities[t.id] ?? 0) - 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-md border disabled:opacity-40"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="w-6 text-center text-sm font-semibold" aria-live="polite">
                  {quantities[t.id] ?? 0}
                </span>
                <button
                  type="button"
                  aria-label={`Add one ${t.name} ticket`}
                  disabled={
                    busy ||
                    !user ||
                    (quantities[t.id] ?? 0) >= Math.min(t.maxPerBooking, t.availableQuantity)
                  }
                  onClick={() => setQty(t, (quantities[t.id] ?? 0) + 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-md border disabled:opacity-40"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedCount > 0 && (
        <p className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {selectedCount} ticket{selectedCount === 1 ? '' : 's'}
          </span>
          <span className="text-lg font-bold">{formatPrice(total)}</span>
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {loading ? (
        <Button className="mt-4 w-full" size="lg" disabled>
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        </Button>
      ) : user ? (
        <Button
          className="mt-4 w-full"
          size="lg"
          disabled={busy || phase === 'paying' || selectedCount === 0}
          onClick={() => void onBook()}
        >
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {phase === 'creating'
            ? 'Reserving seats…'
            : phase === 'paying'
              ? 'Waiting for checkout…'
              : phase === 'verifying'
                ? 'Verifying payment…'
                : 'Book Tickets'}
        </Button>
      ) : (
        <Link
          href="/signin"
          className="mt-4 flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Sign in to book
        </Link>
      )}

      <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        Secure payments by Razorpay
      </p>
    </div>
  );
}
