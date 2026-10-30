'use client';
import { RefreshButton } from '@/components/ui/refresh-button';
import { useEffect, useState, useRef } from 'react';
import Link from '@/components/ui/app-link';
import { useAuth } from '@/components/auth/auth-provider';
import { listAllBookings, type BookingListEntry } from '@/lib/booking';
import { PreviewHeading } from '@/components/approved/ui';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
const dateKey = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-');
export default function CalendarPage() {
  const { user, loading } = useAuth();
  const [month, setMonth] = useState(
      () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    ),
    [selected, setSelected] = useState(() => dateKey(new Date())),
    [bookings, setBookings] = useState<BookingListEntry[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const initialMonth = useRef(false);
  useEffect(() => {
    if (!user) return;
    const c = new AbortController();
    let live = true;
    setBusy(true);
    setError('');
    const timer = setTimeout(() => {
      c.abort();
      if (live) {
        setError('Loading took too long. Please refresh.');
        setBusy(false);
      }
    }, 20000);
    listAllBookings(c.signal)
      .then((data) => {
        if (live) {
          setBookings(data);
          if (!initialMonth.current) {
            initialMonth.current = true;
            const next = data
              .filter(
                (b) =>
                  b.status === 'CONFIRMED' &&
                  b.event.status !== 'CANCELLED' &&
                  new Date(b.event.endDate || b.event.startDate) >= new Date(),
              )
              .sort(
                (a, b) =>
                  new Date(a.event.startDate).getTime() -
                  new Date(b.event.startDate).getTime(),
              )[0];
            if (next) {
              const d = new Date(next.event.startDate);
              setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
              setSelected(dateKey(d));
            }
          }
        }
      })
      .catch((e) => {
        if (live && !c.signal.aborted)
          setError(e instanceof Error ? e.message : 'Unable to load calendar.');
      })
      .finally(() => {
        clearTimeout(timer);
        if (live) setBusy(false);
      });
    return () => {
      live = false;
      clearTimeout(timer);
      c.abort();
    };
  }, [user, revision]);
  if (loading) return <p role="status">Checking sign-in…</p>;
  if (!user)
    return (
      <div className="empty">
        <h1>Sign in to view your calendar</h1>
        <Link className="btn" href="/signin?returnUrl=/calendar">
          Sign in
        </Link>
      </div>
    );
  const confirmed = bookings.filter(
    (b) => b.status === 'CONFIRMED' && b.event.status !== 'CANCELLED',
  );
  const days = Array.from(
    { length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() },
    (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1),
  );
  const eventsFor = (d: Date) =>
    confirmed.filter((b) => {
      const start = new Date(b.event.startDate),
        end = new Date(b.event.endDate || b.event.startDate);
      const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      return (
        date >= new Date(start.getFullYear(), start.getMonth(), start.getDate()) &&
        date <= new Date(end.getFullYear(), end.getMonth(), end.getDate())
      );
    });
  const activeDay = days.find((d) => dateKey(d) === selected);
  const plans = activeDay ? eventsFor(activeDay) : [];
  return (
    <>
      <PreviewHeading
        title="Your plans, on the calendar."
        sub="Confirmed bookings in your local time. Pick a date to see your plans."
        action={
          <RefreshButton
            className="btn outline"
            disabled={busy}
            onClick={() => setRevision((n) => n + 1)}
            refreshing={Boolean(busy)}
          />
        }
      />
      {error ? (
        <div className="notice" role="alert">
          {error}
        </div>
      ) : busy ? (
        <p role="status">Loading your calendar…</p>
      ) : (
        <div className="ep-calendar-layout">
          <section className="panel ep-calendar" aria-label="Booking calendar">
            <div className="ep-calendar-heading">
              <h2>
                {month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </h2>
              <div className="ep-actions">
                <button
                  className="icon-btn"
                  aria-label="Previous month"
                  onClick={() => {
                    setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1));
                    setSelected('');
                  }}
                >
                  <ChevronLeft className="icon" />
                </button>
                <button
                  className="btn outline"
                  onClick={() => {
                    setMonth(
                      new Date(new Date().getFullYear(), new Date().getMonth(), 1),
                    );
                    setSelected(dateKey(new Date()));
                  }}
                >
                  Today
                </button>
                <button
                  className="icon-btn"
                  aria-label="Next month"
                  onClick={() => {
                    setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1));
                    setSelected('');
                  }}
                >
                  <ChevronRight className="icon" />
                </button>
              </div>
            </div>
            <div className="ep-calendar-grid">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <strong key={d}>{d}</strong>
              ))}
              {Array.from({ length: month.getDay() }, (_, i) => (
                <span key={'blank' + i} />
              ))}
              {days.map((d) => {
                const events = eventsFor(d);
                return (
                  <button
                    key={dateKey(d)}
                    aria-label={
                      d.toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      }) +
                      ', ' +
                      events.length +
                      ' events'
                    }
                    aria-pressed={selected === dateKey(d)}
                    className={
                      (events.length ? 'has-plans ' : '') +
                      (selected === dateKey(d) ? 'selected ' : '') +
                      (dateKey(d) === dateKey(new Date()) ? 'today' : '')
                    }
                    onClick={() => setSelected(dateKey(d))}
                  >
                    <span>{d.getDate()}</span>
                    {events.length > 0 && (
                      <small>
                        {events.length} event{events.length === 1 ? '' : 's'}
                      </small>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
          <section className="panel ep-calendar-plans" aria-live="polite">
            <h2>
              {activeDay
                ? activeDay.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
                : 'Choose a date'}
            </h2>
            {plans.length ? (
              plans.map((b) => (
                <div className="ep-calendar-plan" key={b.id}>
                  <CalendarDays className="icon" />
                  <div>
                    <Link
                      href={'/events/' + b.event.slug}
                      className="ep-calendar-event-link"
                    >
                      <h3>{b.event.title}</h3>
                      <span>View event →</span>
                    </Link>
                    <p>
                      {b.event.venue.name}, {b.event.venue.city}
                    </p>
                  </div>
                  <Link
                    className="btn outline"
                    href={'/tickets?booking=' + encodeURIComponent(b.id)}
                  >
                    View tickets
                  </Link>
                </div>
              ))
            ) : (
              <p className="help">No confirmed events on this date.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
