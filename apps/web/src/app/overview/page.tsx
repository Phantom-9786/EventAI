'use client';
import { RefreshButton } from '@/components/ui/refresh-button';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SavedEvents } from '@/components/approved/saved-events';
import { CalendarDays, Heart, Ticket, ArrowRight, Bell } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { listBookings, type BookingListEntry } from '@/lib/booking';
import { useFavorites } from '@/lib/favorites';
import { formatEventDate } from '@/lib/api';
import { getNotifications } from '@/lib/notifications';
import { PreviewHeading, PreviewPanel, PreviewStat } from '@/components/approved/ui';

function AttendeeOverview() {
  const { user, loading } = useAuth();
  const params = useSearchParams();
  const { count } = useFavorites();
  const [bookings, setBookings] = useState<BookingListEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await listBookings(1, 100);
      setBookings(data.bookings);
      setTotal(data.total);
      try {
        setUnread((await getNotifications()).unreadCount);
      } catch {
        setUnread(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load your bookings');
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (user) void load();
  }, [user, load]);
  if (loading)
    return (
      <div className="container py-20" role="status">
        Checking sign-in…
      </div>
    );
  if (!user)
    return (
      <div className="container py-20 text-center">
        <h1 className="text-3xl font-bold">Sign in to your dashboard</h1>
        <p className="mt-3 text-muted-foreground">
          Your plans, tickets and saved experiences in one place.
        </p>
        <Link
          className="mt-6 inline-flex rounded-xl bg-primary px-5 py-3 text-primary-foreground"
          href="/signin?returnUrl=/overview"
        >
          Sign in
        </Link>
      </div>
    );
  if (params.get('view') === 'saved') return <SavedEvents />;
  const upcoming = bookings.filter(
    (b) => b.status === 'CONFIRMED' && new Date(b.event.startDate) > new Date(),
  );
  return (
    <>
      <PreviewHeading
        title="Your next story starts here."
        sub="All your experiences, tickets, and plans in one place."
        action={
          <div className="ep-actions">
            <RefreshButton className="btn outline" variant="outline" onClick={load} disabled={busy} refreshing={busy} />
          <Link href="/events" className="btn">
            Find an experience
            <ArrowRight className="icon" />
          </Link>
          </div>
        }
      />
      {error && (
        <div className="notice" role="alert">
          {error}
          <button onClick={() => void load()}>Try again</button>
        </div>
      )}
      <div className="stats">
        <PreviewStat
          label="Upcoming plans"
          value={busy ? '…' : String(upcoming.length)}
          href="/calendar"
          icon={<CalendarDays className="icon" />}
        />
        <PreviewStat
          label="Digital tickets"
          value={
            busy
              ? '…'
              : String(bookings.reduce((n, b) => n + (b.tickets?.length ?? 0), 0))
          }
          href="/tickets"
          icon={<Ticket className="icon" />}
        />
        <PreviewStat
          label="Saved events"
          value={String(count)}
          href="/overview?view=saved"
          icon={<Heart className="icon" />}
        />
        <PreviewStat
          label="Notifications"
          value={unread === null ? '—' : String(unread)}
          href="/notifications"
          icon={<Bell className="icon" />}
        />
      </div>
      <div className="workspace-grid">
        <PreviewPanel title="Your next experience">
          {busy ? (
            <p className="help" role="status">
              Loading your plans…
            </p>
          ) : upcoming[0] ? (
            <>
              <div className="notice">
                <CalendarDays className="icon" />{' '}
                {formatEventDate(upcoming[0].event.startDate)}
              </div>
              <h3>{upcoming[0].event.title}</h3>
              <p className="help">
                {upcoming[0].event.venue.name}, {upcoming[0].event.venue.city}
              </p>
              <Link className="btn" href="/tickets">
                View your ticket
                <ArrowRight className="icon" />
              </Link>
            </>
          ) : (
            <>
              <div className="notice">
                <CalendarDays className="icon" /> Your next good plan is waiting.
              </div>
              <h3>No upcoming bookings yet.</h3>
              <p className="help">
                Discover something new and make room for your next experience.
              </p>
              <Link className="btn" href="/events">
                Find an experience
                <ArrowRight className="icon" />
              </Link>
            </>
          )}
        </PreviewPanel>
        <PreviewPanel title="A little more out of the everyday">
          <p className="help">
            Find a new favourite gig, discover a creative workshop, or make room for a
            slower Sunday.
          </p>
          <div className="actions">
            <Link href="/events" className="btn outline">
              Discover events
              <ArrowRight className="icon" />
            </Link>
            <Link href="/ai" className="btn outline">
              Ask your assistant
              <ArrowRight className="icon" />
            </Link>
          </div>
          <div className="notice">
            Your bookings, notifications, profile and organizer application, all in one
            place.
          </div>
        </PreviewPanel>
      </div>
      {total > bookings.length && (
        <p className="ep-health-note">
          Overview totals cover your latest {bookings.length} bookings. Open My bookings
          to see your complete history.
        </p>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p role="status">Loading dashboard…</p>}>
      <AttendeeOverview />
    </Suspense>
  );
}
