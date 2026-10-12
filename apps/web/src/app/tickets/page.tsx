'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  RefreshCw,
  Ticket,
  XCircle,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import {
  getTicketQr,
  listBookings,
  cancelBooking,
  refundBooking,
  type BookingListEntry,
} from '@/lib/booking';
import { formatEventDate, formatPrice } from '@/lib/api';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20',
  PENDING: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
  PAYMENT_PENDING: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
  EXPIRED: 'bg-muted text-muted-foreground border-border',
  REFUNDED: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
};

function TicketQr({ ticketId }: { ticketId: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTicketQr(ticketId)
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  if (failed) {
    return (
      <div className="flex h-20 w-20 items-center justify-center rounded-lg border bg-muted text-[11px] text-muted-foreground">
        QR code
      </div>
    );
  }
  return qr ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={qr} alt="Ticket QR code" className="h-20 w-20 rounded-lg border bg-white p-1 shadow-sm" />
  ) : (
    <div className="h-20 w-20 animate-pulse rounded-lg border bg-muted" />
  );
}

export default function TicketsPage() {
  const { user, loading } = useAuth();
  const [bookings, setBookings] = useState<BookingListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await listBookings();
      setBookings(data.bookings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your tickets');
      setBookings([]);
    }
  }, []);

  useEffect(() => {
    if (user && bookings === null) void load();
  }, [user, bookings, load]);

  if (loading) {
    return (
      <div className="container flex justify-center py-24" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading your tickets…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container flex max-w-md flex-col items-center py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Ticket className="h-8 w-8" />
        </div>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Sign in to view your tickets</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your confirmed bookings and digital admission tickets are securely linked to your account.
        </p>
        <Link href="/signin?returnUrl=/tickets" className={cn(buttonVariants({ size: 'lg' }), 'mt-6 w-full')}>
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="container max-w-5xl py-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Tickets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your bookings, view digital entry passes, and track refund requests.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={bookings === null}
          className="self-start sm:self-auto"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {error && (
        <div role="alert" className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="mt-2 font-semibold underline underline-offset-4">
            Try loading again
          </button>
        </div>
      )}

      {actionMessage && (
        <div role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-green-600/30 bg-green-600/10 p-4 text-sm text-green-700 dark:text-green-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {bookings === null ? (
        <div className="flex justify-center py-20" role="status">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading bookings…</span>
        </div>
      ) : bookings.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed p-14 text-center">
          <Ticket className="mx-auto h-12 w-12 text-muted-foreground/40" />
          <p className="mt-4 text-lg font-semibold">No bookings yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Explore upcoming concerts, workshops, and gatherings to get started.
          </p>
          <Link href="/events" className={cn(buttonVariants({ size: 'default' }), 'mt-6')}>
            Discover events
          </Link>
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          {bookings.map((booking) => {
            const isEventCancelled = booking.event.status === 'CANCELLED';
            const refundStatus = booking.payment?.refundRequestStatus;
            const isConfirmed = booking.status === 'CONFIRMED';
            const isPendingPayment = booking.status === 'PENDING' || booking.status === 'PAYMENT_PENDING';

            return (
              <article
                key={booking.id}
                className="overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md"
              >
                {/* Event Cancellation Alert */}
                {isEventCancelled && (
                  <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-5 py-3 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>This event was cancelled by the organizer.</span>
                    {booking.payment?.status === 'CAPTURED' && !refundStatus && (
                      <span className="font-semibold">Refund request queued.</span>
                    )}
                  </div>
                )}

                {/* Booking Header */}
                <div className="flex flex-col justify-between gap-4 border-b p-5 sm:flex-row sm:items-start">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Link
                        href={`/events/${booking.event.slug}`}
                        className="text-lg font-bold hover:text-primary transition-colors"
                      >
                        {booking.event.title}
                      </Link>
                      <span
                        className={cn(
                          'rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                          STATUS_STYLES[booking.status] ?? 'bg-muted text-muted-foreground',
                        )}
                      >
                        {booking.status.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 font-medium text-foreground">
                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                        {formatEventDate(booking.event.startDate)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {booking.event.venue.name}, {booking.event.venue.city}
                        {booking.event.venue.address && ` (${booking.event.venue.address})`}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        Ref: #{booking.id.slice(0, 8)}…
                      </span>
                    </div>
                  </div>

                  <div className="flex sm:flex-col sm:items-end justify-between items-center gap-1">
                    <span className="text-xl font-bold tracking-tight">
                      {formatPrice(booking.totalAmount)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {booking.items.reduce((acc, i) => acc + i.quantity, 0)} ticket(s)
                    </span>
                  </div>
                </div>

                {/* Ticket Types Summary */}
                <div className="border-b bg-muted/30 px-5 py-3 text-xs sm:text-sm">
                  <span className="font-semibold text-muted-foreground">Purchased: </span>
                  <span className="font-medium text-foreground">
                    {booking.items
                      .map((item) => `${item.quantity} × ${item.ticketType.name}`)
                      .join(', ')}
                  </span>
                </div>

                {/* Payment & Refund Status bar */}
                <div className="flex flex-col gap-3 border-b px-5 py-3.5 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground">
                      Payment:{' '}
                      <span className="font-semibold text-foreground">
                        {booking.payment?.status ?? 'Not captured'}
                      </span>
                    </p>
                    {refundStatus === 'PENDING' && (
                      <p className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                        <Clock className="h-3.5 w-3.5" /> Refund request awaiting organizer approval
                      </p>
                    )}
                    {refundStatus === 'APPROVED' && (
                      <p className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Refund approved — settlement processing via Razorpay
                      </p>
                    )}
                    {refundStatus === 'REJECTED' && (
                      <p className="flex items-center gap-1 text-muted-foreground">
                        <XCircle className="h-3.5 w-3.5" /> Refund request declined by organizer
                      </p>
                    )}
                    {booking.payment?.status === 'REFUNDED' && (
                      <p className="flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Full refund processed to original payment method
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Unpaid Booking: Cancel Hold */}
                    {isPendingPayment && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actionId !== null}
                        onClick={() => {
                          if (!window.confirm('Cancel this unpaid reservation? Reserved ticket hold will be released.')) return;
                          setActionId(booking.id);
                          setError(null);
                          setActionMessage(null);
                          void cancelBooking(booking.id)
                            .then((updated) => {
                              setBookings((current) =>
                                current?.map((item) =>
                                  item.id === booking.id ? { ...item, ...updated } : item,
                                ) ?? [],
                              );
                              setActionMessage('Unpaid reservation cancelled. Seats released.');
                            })
                            .catch((err: unknown) => {
                              setError(err instanceof Error ? err.message : 'Cancellation failed');
                            })
                            .finally(() => setActionId(null));
                        }}
                      >
                        {actionId === booking.id && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                        Cancel reservation
                      </Button>
                    )}

                    {/* Confirmed Paid Booking: Request Refund */}
                    {isConfirmed && booking.payment?.status === 'CAPTURED' && !isEventCancelled && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          actionId !== null ||
                          refundStatus === 'PENDING' ||
                          refundStatus === 'APPROVED'
                        }
                        onClick={() => {
                          if (refundStatus === 'PENDING' || refundStatus === 'APPROVED') return;
                          if (!window.confirm('Submit a full refund request to the organizer for approval?')) return;
                          setActionId(booking.id);
                          setError(null);
                          setActionMessage(null);
                          void refundBooking(booking.id)
                            .then(({ refundRequest }) => {
                              setBookings((current) =>
                                current?.map((item) =>
                                  item.id === booking.id
                                    ? {
                                        ...item,
                                        payment: item.payment
                                          ? {
                                              ...item.payment,
                                              refundRequestStatus: refundRequest.status,
                                              refundRequestReason: refundRequest.reason,
                                              refundRequestedAt: refundRequest.requestedAt,
                                            }
                                          : item.payment,
                                      }
                                    : item,
                                ) ?? [],
                              );
                              setActionMessage('Refund request sent to the event organizer.');
                            })
                            .catch((err: unknown) => {
                              setError(err instanceof Error ? err.message : 'Refund request failed');
                            })
                            .finally(() => setActionId(null));
                        }}
                      >
                        {actionId === booking.id && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                        {refundStatus === 'PENDING'
                          ? 'Refund request submitted'
                          : refundStatus === 'APPROVED'
                            ? 'Refund approved'
                            : 'Request refund'}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Digital Admission Tickets */}
                {booking.tickets && booking.tickets.length > 0 ? (
                  <div className="p-5">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Digital Admission Tickets
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {booking.tickets.map((ticket) => (
                        <div
                          key={ticket.id}
                          className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm transition-colors hover:border-primary/40"
                        >
                          {ticket.status === 'VALID' ? (
                            <TicketQr ticketId={ticket.id} />
                          ) : (
                            <div className="flex h-20 w-20 items-center justify-center rounded-lg border bg-muted text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              {ticket.status}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-sm font-bold tracking-wide">
                              {ticket.ticketCode}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {ticket.holderName}
                            </p>
                            <span
                              className={cn(
                                'mt-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                ticket.status === 'VALID'
                                  ? 'bg-green-500/10 text-green-700 dark:text-green-300'
                                  : 'bg-muted text-muted-foreground',
                              )}
                            >
                              {ticket.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-5 text-sm text-muted-foreground">
                    {booking.status === 'CONFIRMED'
                      ? 'Tickets are being minted and will appear shortly…'
                      : 'No active tickets for this reservation.'}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
