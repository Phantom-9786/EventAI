'use client';
import { RefreshButton } from '@/components/ui/refresh-button';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/auth-provider';
import { listAllBookings, type BookingListEntry } from '@/lib/booking';
import { DigitalTicketPass } from '@/components/tickets/digital-ticket-pass';
import { PreviewHeading } from '@/components/approved/ui';
import { Ticket } from 'lucide-react';
export default function TicketsPage() {
  const { user, loading } = useAuth();
  const [bookings, setBookings] = useState<BookingListEntry[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const load = useCallback(async (signal: AbortSignal) => {
    setBusy(true);
    setError('');
    try {
      const data = await listAllBookings(signal);
      if (!signal.aborted) setBookings(data);
    } catch (e) {
      if (!signal.aborted)
        setError(e instanceof Error ? e.message : 'Unable to load tickets.');
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }, []);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!user) return;
    const c = new AbortController();
    const timer = setTimeout(() => {
      c.abort();
      setError('Ticket loading timed out. Please refresh.');
      setBusy(false);
    }, 20000);
    void load(c.signal).finally(() => clearTimeout(timer));

    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [user, load, revision]);
  useEffect(() => {
    if (busy || !bookings.length) return;
    const bookingId = new URLSearchParams(location.search).get('booking');
    if (bookingId)
      document
        .getElementById('booking-' + bookingId)
        ?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [busy, bookings]);
  if (loading) return <p role="status">Checking sign-in…</p>;
  if (!user)
    return (
      <div className="empty">
        <Ticket className="icon" />
        <h1>Sign in to view your tickets</h1>
        <Link className="btn" href="/signin?returnUrl=/tickets">
          Sign in
        </Link>
      </div>
    );
  const withTickets = bookings.filter((b) => b.tickets?.length);
  const groups = Array.from(new Set(withTickets.map((b) => b.event.id))).map((id) => ({
    event: withTickets.find((b) => b.event.id === id)!.event,
    bookings: withTickets.filter((b) => b.event.id === id),
  }));

  return (
    <>
      <PreviewHeading
        title="Your digital tickets."
        sub="Your entry passes, ready when you are."
        action={
          <RefreshButton
            className="btn outline"
            disabled={busy}
            onClick={() => setRevision((n) => n + 1)}
            refreshing={Boolean(busy)}
          />
        }
      />
      {busy ? (
        <p role="status">Loading tickets…</p>
      ) : error ? (
        <div className="notice" role="alert">
          {error}
          <button onClick={() => setRevision((n) => n + 1)}>Retry</button>
        </div>
      ) : !groups.length ? (
        <div className="empty">
          <Ticket className="icon" />
          <h2>No digital tickets yet.</h2>
          <p>Issued tickets will appear here after your booking is confirmed.</p>
          <Link className="btn outline" href="/bookings">
            My bookings
          </Link>
        </div>
      ) : (
        <>
          <div className="ep-ticket-groups">
            {groups.map((group) => (
              <section
                key={group.event.id}
                className="ep-ticket-event-group"
                aria-label={'Tickets for ' + group.event.title}
              >
                <header>
                  <div>
                    <span className="small-label">Event tickets</span>
                    <h2>{group.event.title}</h2>
                    <p>
                      {group.event.venue.name}, {group.event.venue.city} ·{' '}
                      {new Date(group.event.startDate).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <Link className="btn outline" href={'/events/' + group.event.slug}>
                    View event
                  </Link>
                </header>
                <div className="ep-event-pass-list">
                  {group.bookings.map((booking) => (
                    <div
                      key={booking.id}
                      id={'booking-' + booking.id}
                      className="ep-booking-passes"
                    >
                      <div className="ep-pass-order">
                        <span>
                          Booking {booking.id.slice(0, 8)} · {booking.tickets!.length}{' '}
                          ticket{booking.tickets!.length === 1 ? '' : 's'}
                        </span>
                        <Link className="text-link" href="/bookings">
                          Booking details →
                        </Link>
                      </div>
                      {booking.tickets!.map((t) => (
                        <DigitalTicketPass
                          key={t.id}
                          ticket={{
                            ...t,
                            ticketType: booking.items.find(
                              (item) => item.ticketType.id === t.ticketTypeId,
                            )?.ticketType,
                          }}
                          event={booking.event}
                          bookingRef={booking.id}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
