'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { formatEventDate } from '@/lib/api';
import { listOrganizerEventPage, type OrganizerEventRow } from '@/lib/organizer';
import { useSystemControls } from '@/components/layout/maintenance-guard';
import { Wrench } from 'lucide-react';

export type EventCategoryFilter = 'all' | 'drafts' | 'pending' | 'approved' | 'rejected';

export function OrganizerEventsList() {
  const { controls } = useSystemControls();
  const isCreationMaintenance = Boolean(controls?.eventCreationMaintenance);
  const creationMessage =
    controls?.eventCreationMaintenanceMessage ||
    'New event creation is temporarily unavailable. Existing events remain accessible.';

  const [events, setEvents] = useState<OrganizerEventRow[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<EventCategoryFilter>('all');
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

  const filteredEvents = events.filter((event) => {
    const modStatus = event.moderation?.status ?? 'DRAFT';
    if (categoryFilter === 'drafts') return event.status === 'DRAFT' && modStatus === 'DRAFT';
    if (categoryFilter === 'pending') return modStatus === 'PENDING_APPROVAL';
    if (categoryFilter === 'approved') return modStatus === 'APPROVED' || event.status === 'PUBLISHED';
    if (categoryFilter === 'rejected') return modStatus === 'REJECTED';
    return true;
  });

  return (
    <div className="ep-organizer-events">
      {isCreationMaintenance && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-amber-800 dark:text-amber-300 flex items-center gap-2.5 text-xs sm:text-sm font-medium">
          <Wrench className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>{creationMessage}</span>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My events</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create, edit, publish, and manage your event inventory.</p>
        </div>
        {isCreationMaintenance ? (
          <button
            type="button"
            disabled
            title="Event creation is currently paused for maintenance"
            className="inline-flex h-9 items-center justify-center rounded-md bg-muted px-4 text-sm font-medium text-muted-foreground cursor-not-allowed opacity-60"
          >
            Create event (Paused)
          </button>
        ) : (
          <Link href="/organizer/events/new" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Create event</Link>
        )}
      </div>

      {/* Category filter tabs */}
      <div role="tablist" aria-label="Event moderation categories" className="mt-6 flex flex-wrap gap-1 border-b">
        {[
          { id: 'all' as const, label: 'All' },
          { id: 'drafts' as const, label: 'Drafts' },
          { id: 'pending' as const, label: 'Pending Approval' },
          { id: 'approved' as const, label: 'Approved / Published' },
          { id: 'rejected' as const, label: 'Rejected' },
        ].map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={categoryFilter === tab.id}
            onClick={() => setCategoryFilter(tab.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              categoryFilter === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive" role="alert"><p>{error}</p><Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void load()}>Try again</Button></div>}
      {loading ? <p className="mt-8 animate-pulse text-sm text-muted-foreground" role="status">Loading your events…</p> : events.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium">No events yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Create a draft to start setting up ticket types and inventory.</p>
          <Link href="/organizer/events/new" className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Create your first event</Link>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No events in this category.
        </div>
      ) : (
        <>
          <div className="ep-surface ep-surface-list mt-6 divide-y rounded-lg border">
            {filteredEvents.map((event) => {
              const modStatus = event.moderation?.status ?? 'DRAFT';
              return (
                <article key={event.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="ep-organizer-event-title">{event.title}</h2>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        event.status === 'PUBLISHED' ? 'bg-green-500/15 text-green-700 dark:text-green-300' :
                        modStatus === 'PENDING_APPROVAL' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' :
                        modStatus === 'APPROVED' ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300' :
                        modStatus === 'REJECTED' ? 'bg-destructive/15 text-destructive' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {event.status === 'PUBLISHED' ? 'PUBLISHED' : modStatus === 'PENDING_APPROVAL' ? 'PENDING APPROVAL' : modStatus === 'APPROVED' ? 'APPROVED (DRAFT)' : modStatus === 'REJECTED' ? 'REJECTED' : 'DRAFT'}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{event.category.name} · {event.venue.name}, {event.venue.city}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatEventDate(event.startDate)}</p>
                    {modStatus === 'REJECTED' && event.moderation?.rejectionReason && (
                      <p className="mt-1.5 text-xs text-destructive">Rejection reason: {event.moderation.rejectionReason}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Link href={`/organizer/events/${encodeURIComponent(event.id)}`} className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent">Manage event</Link>
                    <Link href={`/dashboard/scan?event=${encodeURIComponent(event.id)}`} className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent">Attendees &amp; scan</Link>
                  </div>
                </article>
              );
            })}
          </div>
          {pages > 1 && <div className="mt-4 flex items-center justify-between text-sm"><span>Page {page} of {pages}</span><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button><Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((current) => Math.min(pages, current + 1))}>Next</Button></div></div>}
        </>
      )}
    </div>
  );
}
