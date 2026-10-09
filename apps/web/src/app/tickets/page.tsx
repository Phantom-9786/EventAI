'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Loader2, MapPin, Ticket } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import {
  getTicketQr,
  listBookings,
  type BookingListEntry,
} from '@/lib/booking';
import { formatEventDate, formatPrice } from '@/lib/api';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  PENDING: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  PAYMENT_PENDING: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  CANCELLED: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  EXPIRED: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  REFUNDED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
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
    return <div className="h-20 w-20 rounded border bg-muted" title="QR unavailable" />;
  }
  return qr ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={qr} alt="Ticket QR code" className="h-20 w-20 rounded border bg-white p-1" />
  ) : (
    <div className="h-20 w-20 animate-pulse rounded border bg-muted" />
  );
}

export default function TicketsPage() {
  const { user, loading } = useAuth();
  const [bookings, setBookings] = useState<BookingListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
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
      <div className="container flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container flex max-w-md flex-col items-center py-24 text-center">
        <Ticket className="h-10 w-10 text-muted-foreground/50" />
        <h1 className="mt-4 text-xl font-semibold">Sign in to see your tickets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your bookings and digital tickets live here once you are signed in.
        </p>
        <Link href="/signin" className={cn(buttonVariants(), 'mt-6')}>
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="container py-10">
      <h1 className="text-3xl font-bold tracking-tight">My Tickets</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Present the QR code at the venue entrance.
      </p>

      {error && (
        <p role="alert" className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {bookings === null ? (
        <div className="mt-10 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : bookings.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed p-12 text-center">
          <p className="text-lg font-medium">No bookings yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Book your first event and your tickets will appear here.
          </p>
          <Link href="/events" className={cn(buttonVariants(), 'mt-4')}>
            Browse events
          </Link>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-4">
          {bookings.map((booking) => (
            <div key={booking.id} className="rounded-lg border bg-card shadow-sm">
              <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Link
                    href={`/events/${booking.event.slug}`}
                    className="font-semibold hover:text-primary"
                  >
                    {booking.event.title}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {formatEventDate(booking.event.startDate)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {booking.event.venue.name}, {booking.event.venue.city}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">
                    {formatPrice(booking.totalAmount)}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-medium',
                      STATUS_STYLES[booking.status] ?? 'bg-muted text-muted-foreground',
                    )}
                  >
                    {booking.status.replace('_', ' ')}
                  </span>
                </div>
              </div>

              {booking.tickets && booking.tickets.length > 0 ? (
                <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  {booking.tickets.map((ticket) => (
                    <div key={ticket.id} className="flex items-center gap-3 rounded-md border p-3">
                      {ticket.status === 'VALID' ? (
                        <TicketQr ticketId={ticket.id} />
                      ) : (
                        <div className="flex h-20 w-20 items-center justify-center rounded border bg-muted text-[10px] uppercase text-muted-foreground">
                          {ticket.status}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-medium">
                          {ticket.ticketCode}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {ticket.holderName}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  {booking.status === 'CONFIRMED'
                    ? 'Tickets are being issued…'
                    : 'No tickets issued for this booking.'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
