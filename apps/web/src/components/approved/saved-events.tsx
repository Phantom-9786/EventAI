'use client';
import { RefreshButton } from '@/components/ui/refresh-button';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Heart } from 'lucide-react';
import { useFavorites } from '@/lib/favorites';
import { API_URL, type EventDetail, type EventSummary } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { EventCard } from '@/components/events/event-card';
import { PreviewHeading } from './ui';
export function SavedEvents() {
  const { favorites, mounted } = useFavorites();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const key = favorites.join('|');
  const pages = Math.max(1, Math.ceil(favorites.length / 12));
  const current = Math.min(page, pages);
  useEffect(() => {
    if (!mounted) return;
    let live = true;
    const c = new AbortController();
    setBusy(true);
    setError('');
    const ids = key ? key.split('|').slice((current - 1) * 12, current * 12) : [];
    const token = getAccessToken();
    const timer = setTimeout(() => c.abort(), 12000);
    Promise.all(
      ids.map(async (id) => {
        const r = await fetch(API_URL + '/events/' + encodeURIComponent(id), {
          signal: c.signal,
          headers: token ? { Authorization: 'Bearer ' + token } : {},
        });
        if (r.status === 404 || r.status === 410) return null;
        if (!r.ok) throw Error('Unable to load saved events. Please retry.');
        const data = (await r.json()) as { event: EventDetail };
        const e = data.event;
        const prices = e.ticketTypes?.map((t) => t.price) ?? [];
        return {
          ...e,
          minPrice: e.minPrice ?? (prices.length ? Math.min(...prices) : null),
          maxPrice: e.maxPrice ?? (prices.length ? Math.max(...prices) : null),
        } as EventSummary;
      }),
    )
      .then((data) => {
        if (live) setEvents(data.filter((e): e is EventSummary => Boolean(e)));
      })
      .catch((e) => {
        if (live) {
          setEvents([]);
          setError(
            c.signal.aborted
              ? 'Loading took too long. Please retry.'
              : e instanceof Error
                ? e.message
                : 'Unable to load saved events.',
          );
        }
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
  }, [key, current, mounted, revision]);
  return (
    <>
      <PreviewHeading
        title="Your saved experiences."
        sub="The events you love, right here in your dashboard."
        action={<div className="ep-saved-heading-actions">
          <RefreshButton className="btn outline" disabled={busy}
            onClick={() => setRevision((n) => n + 1)} refreshing={Boolean(busy)} />
          <Link href="/overview" className="btn outline">
            <ArrowLeft className="icon" />
            My Dashboard
          </Link>
        </div>}
      />
      <div className="ep-saved-toolbar">
        <p>
          {favorites.length} saved event{favorites.length === 1 ? '' : 's'}
        </p>
      </div>
      {busy || !mounted ? (
        <p role="status" className="notice">
          Loading your saved events…
        </p>
      ) : error ? (
        <div className="notice" role="alert">
          {error}
          <button onClick={() => setRevision((n) => n + 1)}>Try again</button>
        </div>
      ) : events.length ? (
        <div className="ep-grid">
          {events.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <Heart className="icon" />
          <h2>
            {favorites.length
              ? 'These saved events are no longer available.'
              : 'Save something to look forward to.'}
          </h2>
          <p>
            {favorites.length
              ? 'Unpublished or removed events cannot be displayed.'
              : 'Tap the heart on any event. It will appear here.'}
          </p>
          <Link className="btn" href="/events">
            Discover events
          </Link>
        </div>
      )}
      {pages > 1 && (
        <div className="actions">
          <button
            className="btn outline"
            disabled={current <= 1 || busy}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span>
            Page {current} of {pages}
          </span>
          <button
            className="btn outline"
            disabled={current >= pages || busy}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
