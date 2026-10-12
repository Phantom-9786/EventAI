'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { formatEventDate, formatPrice } from '@/lib/api';
import {
  approveOrganizerRefund,
  getOrganizerRefundRequests,
  rejectOrganizerRefund,
  type OrganizerRefundRequest,
} from '@/lib/organizer';
import { cn } from '@/lib/utils';

type FilterTab = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';

const TAB_OPTIONS: { id: FilterTab; label: string }[] = [
  { id: 'PENDING', label: 'Pending review' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'ALL', label: 'All requests' },
];

function statusBadge(status?: string | null) {
  switch (status) {
    case 'PENDING':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
          <Clock className="h-3 w-3" /> Awaiting approval
        </span>
      );
    case 'APPROVED':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
          <CheckCircle2 className="h-3 w-3" /> Approved
        </span>
      );
    case 'REJECTED':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
          <XCircle className="h-3 w-3" /> Rejected
        </span>
      );
    case 'FAILED':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold text-destructive">
          Provider failed
        </span>
      );
    default:
      return null;
  }
}

export function OrganizerRefundRequests() {
  const [requests, setRequests] = useState<OrganizerRefundRequest[] | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('PENDING');
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (tab: FilterTab) => {
    setError(null);
    try {
      const data = await getOrganizerRefundRequests(tab);
      setRequests(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load refund requests');
    }
  }, []);

  useEffect(() => {
    setRequests(null);
    void load(activeTab);
  }, [activeTab, load]);

  const decide = async (
    request: OrganizerRefundRequest,
    decision: 'approve' | 'reject',
  ) => {
    const prompt =
      decision === 'approve'
        ? `Approve refund of ${formatPrice(request.amount)} for ${request.booking.event.title} and initiate the Razorpay refund?`
        : `Reject refund request for ${request.booking.event.title}? No money will be refunded.`;
    if (!window.confirm(prompt)) return;

    setActionId(request.bookingId);
    setError(null);
    setMessage(null);
    try {
      const result =
        decision === 'approve'
          ? await approveOrganizerRefund(request.bookingId)
          : await rejectOrganizerRefund(request.bookingId);
      
      setMessage(
        decision === 'approve'
          ? `Refund approved and submitted to payment provider for ${request.booking.event.title}.`
          : `Refund request rejected for ${request.booking.event.title}.`,
      );
      if (result.refundStatus === 'pending') {
        setMessage(
          `Refund approved for ${request.booking.event.title}. Reconciliation is required via Razorpay webhook. Do not retry.`,
        );
      }
      await load(activeTab);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Failed to ${decision} refund request`,
      );
    } finally {
      setActionId(null);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Refund requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review attendee requests. Razorpay is contacted only after you approve a request.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(activeTab)}
          disabled={requests === null}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'self-start sm:self-auto')}
        >
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b pb-2 text-sm">
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'rounded-md px-3 py-1.5 font-medium transition-colors',
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void load(activeTab)}
            className="mt-2 font-semibold underline underline-offset-4"
          >
            Try loading again
          </button>
        </div>
      )}

      {message && (
        <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-primary">
          {message}
        </p>
      )}

      {requests === null ? (
        <div className="flex justify-center py-16" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading requests…</span>
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
          {activeTab === 'PENDING'
            ? 'No refund requests are awaiting review.'
            : activeTab === 'APPROVED'
              ? 'No approved refund requests found.'
              : activeTab === 'REJECTED'
                ? 'No rejected refund requests found.'
                : 'No refund requests found.'}
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => {
            const attendee =
              [request.booking.user.firstName, request.booking.user.lastName]
                .filter(Boolean)
                .join(' ') || 'Attendee';
            const isPending =
              !request.refundRequestStatus || request.refundRequestStatus === 'PENDING';

            return (
              <article
                key={request.bookingId}
                className="rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">{request.booking.event.title}</h2>
                      {statusBadge(request.refundRequestStatus)}
                      {request.status && request.status !== 'CAPTURED' && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground font-mono">
                          Payment: {request.status}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {attendee} · {request.booking.user.email}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Event date: {formatEventDate(request.booking.event.startDate)} · Booking ID:{' '}
                      <span className="font-mono">{request.bookingId}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">{formatPrice(request.amount)}</p>
                    <p className="text-xs text-muted-foreground">
                      Requested {request.refundRequestedAt ? new Date(request.refundRequestedAt).toLocaleDateString() : 'recently'}
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm">
                  <p>
                    <span className="font-medium text-muted-foreground">Tickets: </span>
                    {request.booking.items
                      .map((item) => `${item.quantity} × ${item.ticketType.name}`)
                      .join(', ')}
                  </p>
                  <p className="mt-1">
                    <span className="font-medium text-muted-foreground">Attendee reason: </span>
                    {request.refundRequestReason?.trim() || 'No reason provided'}
                  </p>
                </div>

                {isPending && (
                  <div className="mt-4 flex flex-wrap gap-2.5">
                    <button
                      type="button"
                      disabled={actionId !== null}
                      onClick={() => void decide(request, 'approve')}
                      className={cn(buttonVariants({ size: 'sm' }), 'disabled:opacity-60')}
                    >
                      {actionId === request.bookingId && (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      )}
                      Approve and issue refund
                    </button>
                    <button
                      type="button"
                      disabled={actionId !== null}
                      onClick={() => void decide(request, 'reject')}
                      className={cn(
                        buttonVariants({ variant: 'outline', size: 'sm' }),
                        'disabled:opacity-60',
                      )}
                    >
                      Reject request
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
