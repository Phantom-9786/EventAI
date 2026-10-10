'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { formatEventDate } from '@/lib/api';
import { listOrganizerEventPage, type OrganizerEventRow } from '@/lib/organizer';

export function OrganizerEventsList() {
  const [events, setEvents] = useState<OrganizerEventRow[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listOrganizerEventPage(page, 20);
      setEvents(result.events);
      setPages(Math.max(1, result.pages));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your events.');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My events</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create, edit, publish, and manage your event inventory.</p>
        </div>
        <Link href="/organizer/events/new" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Create event</Link>
      </div>
      {error && <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive" role="alert"><p>{error}</p><Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void load()}>Try again</Button></div>}
      {loading ? <p className="mt-8 animate-pulse text-sm text-muted-foreground" role="status">Loading your events…</p> : events.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium">No events yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Create a draft to start setting up ticket types and inventory.</p>
          <Link href="/organizer/events/new" className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Create your first event</Link>
        </div>
      ) : (
        <>
          <div className="mt-6 divide-y rounded-lg border">
            {events.map((event) => (
              <article key={event.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{event.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{event.category.name} · {event.venue.name}, {event.venue.city}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatEventDate(event.startDate)} · {event.status}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link href={`/organizer/events/${encodeURIComponent(event.id)}`} className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent">Manage event</Link>
                  <Link href={`/dashboard/scan?event=${encodeURIComponent(event.id)}`} className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent">Attendees &amp; scan</Link>
                </div>
              </article>
            ))}
          </div>
          {pages > 1 && <div className="mt-4 flex items-center justify-between text-sm"><span>Page {page} of {pages}</span><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button><Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((current) => Math.min(pages, current + 1))}>Next</Button></div></div>}
        </>
      )}
    </div>
  );
}
