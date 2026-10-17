'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EventForm } from '@/components/organizer/event-form';
import {
  cancelOrganizerEvent,
  getOrganizerEvent,
  publishOrganizerEvent,
  submitOrganizerEventForReview,
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
    if (searchParams.get('created') === '1') setNotice('Draft created. Add ticket types, then submit for review.');
  }, [searchParams]);

  async function submitForReview() {
    if (!event) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await submitOrganizerEventForReview(event.id);
      const fresh = await getOrganizerEvent(event.id);
      setEvent(fresh);
      setNotice(res.message ?? 'Event submitted for administrator review.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit event for review.');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(action: 'publish' | 'cancel') {
    if (!event) return;
    if (action === 'cancel' && !window.confirm('Cancel this event? All active tickets will be cancelled. Captured payments will become refund requests that still require organizer approval before any Razorpay refund is initiated.')) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (action === 'publish') {
        setEvent(await publishOrganizerEvent(event.id));
        setNotice('Event published.');
      } else {
        const result = await cancelOrganizerEvent(event.id);
        setEvent(result.event);
        setNotice(`Event cancelled. ${result.refundRequestsQueued} captured payment${result.refundRequestsQueued === 1 ? '' : 's'} queued for organizer refund approval; no provider refunds were initiated.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} this event.`);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="animate-pulse text-sm text-muted-foreground" role="status">Loading event…</p>;
  if (!event) return <div><p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">{error ?? 'Event not found.'}</p><Link href="/organizer/events" className="mt-4 inline-block text-sm text-primary hover:underline">Back to events</Link></div>;

  const moderationStatus = event.moderation?.status ?? 'DRAFT';

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{event.status}</span>
            {event.status === 'DRAFT' && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                moderationStatus === 'APPROVED' ? 'bg-green-500/15 text-green-700 dark:text-green-300' :
                moderationStatus === 'PENDING_APPROVAL' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' :
                moderationStatus === 'REJECTED' ? 'bg-destructive/15 text-destructive' :
                'bg-muted text-muted-foreground'
              }`}>
                {moderationStatus === 'PENDING_APPROVAL' ? 'Pending Admin Review' : moderationStatus}
              </span>
            )}
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Manage event</h1>
          <p className="mt-1 text-sm text-muted-foreground">{event.title}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {event.status === 'DRAFT' && (
            <>
              {moderationStatus === 'APPROVED' && (
                <Button type="button" disabled={busy} onClick={() => void changeStatus('publish')}>
                  {busy ? 'Working…' : 'Publish event'}
                </Button>
              )}
              {moderationStatus === 'PENDING_APPROVAL' && (
                <span className="inline-flex h-9 items-center rounded-md border border-amber-500/30 bg-amber-500/10 px-3 text-xs font-medium text-amber-800 dark:text-amber-300">
                  Awaiting Admin Approval
                </span>
              )}
              {moderationStatus === 'REJECTED' && (
                <Button type="button" disabled={busy} onClick={() => void submitForReview()}>
                  {busy ? 'Working…' : 'Resubmit for review'}
                </Button>
              )}
              {(moderationStatus === 'DRAFT' || !event.moderation) && (
                <Button type="button" disabled={busy} onClick={() => void submitForReview()}>
                  {busy ? 'Working…' : 'Submit for review'}
                </Button>
              )}
            </>
          )}
          {(event.status === 'DRAFT' || event.status === 'PUBLISHED' || event.status === 'SOLDOUT') && (
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void changeStatus('cancel')}>
              Cancel event
            </Button>
          )}
          {event.status === 'PUBLISHED' && (
            <Link href={`/events/${encodeURIComponent(event.slug)}`} className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent">
              View public page
            </Link>
          )}
        </div>
      </div>
      {error && <p role="alert" className="mt-5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="mt-5 rounded-md border border-green-600/30 bg-green-600/10 px-3 py-2 text-sm">{notice}</p>}
      {moderationStatus === 'REJECTED' && event.moderation?.rejectionReason && (
        <div role="alert" className="mt-5 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-semibold">Event Rejected by Moderation</p>
          <p className="mt-1">Reason: {event.moderation.rejectionReason}</p>
          <p className="mt-2 text-xs text-muted-foreground">Update the necessary event details below, then click &ldquo;Resubmit for review&rdquo; above.</p>
        </div>
      )}
      <section className="mt-8" aria-labelledby="event-details-heading">
        <h2 id="event-details-heading" className="mb-4 text-xl font-semibold">Event details</h2>
        {event.status === 'CANCELLED' || event.status === 'COMPLETED'
          ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">This {event.status.toLowerCase()} event cannot be edited.</p>
          : <EventForm key={event.id} event={event} onSaved={setEvent} />}
      </section>
    </div>
  );
}
