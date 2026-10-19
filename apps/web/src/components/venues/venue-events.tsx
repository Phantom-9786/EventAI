'use client';
import { useEffect, useState } from 'react';
import { searchEvents, type EventSummary } from '@/lib/api';
import { EventCard } from '@/components/events/event-card';
export function VenueEvents({ venueId }: { venueId: string }) {
  const [events, setEvents] = useState<EventSummary[]>([]),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError('');
    searchEvents({ venueId, page, limit: 12, sortBy: 'date', sortDir: 'asc' })
      .then((data) => {
        if (!Array.isArray(data.events)) throw new Error('Invalid venue event response');
        if (live) {
          setEvents(data.events);
          setPages(data.pages);
        }
      })
      .catch(() => {
        if (live) setError('Unable to load venue events. Please retry.');
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [venueId, page, revision]);
  return (
    <section id="venue-events" className="section ep-venue-events">
      <div className="section-heading">
        <h2>Events at this venue.</h2>
      </div>
      {busy ? (
        <p role="status">Loading venue events…</p>
      ) : error ? (
        <div role="alert" className="notice">
          {error}
          <button onClick={() => setRevision((n) => n + 1)}>Retry</button>
        </div>
      ) : events.length ? (
        <div className="ep-grid">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <p className="notice">No published events are currently listed at this venue.</p>
      )}
      {pages > 1 && (
        <div className="ep-actions">
          <button
            className="btn outline"
            disabled={busy || page === 1}
            onClick={() => setPage((n) => n - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button
            className="btn outline"
            disabled={busy || page >= pages}
            onClick={() => setPage((n) => n + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
