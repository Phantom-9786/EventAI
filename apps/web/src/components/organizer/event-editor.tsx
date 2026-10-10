'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EventForm } from '@/components/organizer/event-form';
import { TicketTypeManager } from '@/components/organizer/ticket-type-manager';
import {
  cancelOrganizerEvent,
  getOrganizerEvent,
  publishOrganizerEvent,
  type OrganizerEventDetail,
} from '@/lib/organizer';

export function OrganizerEventEditor({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const [event, setEvent] = useState<OrganizerEventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getOrganizerEvent(id)
      .then((result) => { if (active) setEvent(result); })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Could not load this event.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (searchParams.get('created') === '1') setNotice('Draft created. Add ticket types, then publish when it is ready.');
  }, [searchParams]);

  async function changeStatus(action: 'publish' | 'cancel') {
    if (!event) return;
    if (action === 'cancel' && !window.confirm('Cancel this event? Customers will no longer be able to book it.')) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = action === 'publish'
        ? await publishOrganizerEvent(event.id)
        : await cancelOrganizerEvent(event.id);
      setEvent(updated);
      setNotice(action === 'publish' ? 'Event published.' : 'Event cancelled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} this event.`);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="animate-pulse text-sm text-muted-foreground" role="status">Loading event…</p>;
  if (!event) return <div><p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">{error ?? 'Event not found.'}</p><Link href="/organizer/events" className="mt-4 inline-block text-sm text-primary hover:underline">Back to events</Link></div>;

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{event.status}</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Manage event</h1><p className="mt-1 text-sm text-muted-foreground">{event.title}</p></div>
        <div className="flex flex-wrap gap-2">
          {event.status === 'DRAFT' && <Button type="button" disabled={busy} onClick={() => void changeStatus('publish')}>{busy ? 'Working…' : 'Publish event'}</Button>}
          {(event.status === 'DRAFT' || event.status === 'PUBLISHED') && <Button type="button" variant="destructive" disabled={busy} onClick={() => void changeStatus('cancel')}>Cancel event</Button>}
          {event.status === 'PUBLISHED' && <Link href={`/events/${encodeURIComponent(event.slug)}`} className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent">View public page</Link>}
        </div>
      </div>
      {error && <p role="alert" className="mt-5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="mt-5 rounded-md border border-green-600/30 bg-green-600/10 px-3 py-2 text-sm">{notice}</p>}
      <section className="mt-8" aria-labelledby="event-details-heading">
        <h2 id="event-details-heading" className="mb-4 text-xl font-semibold">Event details</h2>
        {event.status === 'CANCELLED' || event.status === 'COMPLETED'
          ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">This {event.status.toLowerCase()} event cannot be edited.</p>
          : <EventForm key={event.id} event={event} onSaved={setEvent} />}
      </section>
      <TicketTypeManager event={event} />
    </div>
  );
}
