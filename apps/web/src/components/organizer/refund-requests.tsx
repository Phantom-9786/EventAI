'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { formatEventDate, formatPrice } from '@/lib/api';
import {
  approveOrganizerRefund,
  getOrganizerRefundRequests,
  reconcileOrganizerRefund,
  rejectOrganizerRefund,
  type OrganizerRefundCounts,
  type OrganizerRefundRequest,
} from '@/lib/organizer';
import { cn } from '@/lib/utils';

type FilterTab = 'PENDING' | 'APPROVED' | 'REFUNDED' | 'REJECTED' | 'FAILED' | 'ALL';

const TAB_OPTIONS: { id: FilterTab; label: string }[] = [
  { id: 'PENDING', label: 'Pending review' },
  { id: 'APPROVED', label: 'Approved / processing' },
  { id: 'REFUNDED', label: 'Successfully refunded' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'FAILED', label: 'Failed / needs reconciliation' },
  { id: 'ALL', label: 'All requests' },
];

function statusBadge(refundRequestStatus?: string | null, paymentStatus?: string | null) {
  if (paymentStatus === 'REFUNDED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" /> Successfully refunded
      </span>
    );
  }
  if (refundRequestStatus === 'APPROVED' || paymentStatus === 'REFUND_PENDING') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
        <Clock className="h-3 w-3" /> Approved — settlement processing
      </span>
    );
  }
  if (refundRequestStatus === 'REJECTED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
        <XCircle className="h-3 w-3" /> Declined by organizer
      </span>
    );
  }
  if (refundRequestStatus === 'FAILED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold text-destructive">
        <AlertTriangle className="h-3 w-3" /> Provider settlement failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
      <Clock className="h-3 w-3" /> Awaiting review
    </span>
  );
}

export function OrganizerRefundRequests() {
  const [requests, setRequests] = useState<OrganizerRefundRequest[] | null>(null);
  const [counts, setCounts] = useState<OrganizerRefundCounts>({
    PENDING: 0,
    APPROVED: 0,
    REFUNDED: 0,
    REJECTED: 0,
    FAILED: 0,
    ALL: 0,
  });
  const [activeTab, setActiveTab] = useState<FilterTab>('PENDING');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (tab: FilterTab, pageNum = 1) => {
    setError(null);
    try {
      const data = await getOrganizerRefundRequests(tab, pageNum, 15);
      setRequests(data.refundRequests);
      setCounts(data.counts);
      if (data.total !== undefined) {
        setTotalPages(Math.max(1, Math.ceil(data.total / (data.limit || 15))));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load refund requests');
    }
  }, []);

  useEffect(() => {
    setRequests(null);
    setPage(1);
    void load(activeTab, 1);
  }, [activeTab, load]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    void load(activeTab, newPage);
  };

  const decide = async (
    request: OrganizerRefundRequest,
    decision: 'approve' | 'reject',
  ) => {
    const prompt =
      decision === 'approve'
        ? `Approve refund of ${formatPrice(request.amount)} for ${request.booking.event.title} and initiate the payment provider refund?`
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
          : `Refund request declined for ${request.booking.event.title}.`,
      );
      if (result.refundStatus === 'pending') {
        setMessage(
          `Refund approved for ${request.booking.event.title}. Provider settlement is pending reconciliation.`,
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : `Failed to ${decision} refund request`;
      if (errMsg.includes('pending provider reconciliation')) {
        setMessage(
          `Refund approved for ${request.booking.event.title}. Provider outcome is pending reconciliation; use the Reconcile button to verify status.`,
        );
      } else {
        setError(errMsg);
      }
    } finally {
      setActionId(null);
      await load(activeTab, page);
    }
  };

  const handleReconcile = async (bookingId: string) => {
    setActionId(bookingId);
    setError(null);
    setMessage(null);
    try {
      const res = await reconcileOrganizerRefund(bookingId);
      if (res.outcome === 'processed' || res.status === 'REFUNDED') {
        setMessage('Provider reconciliation complete: refund confirmed as processed.');
      } else if (res.outcome === 'failed') {
        setMessage('Provider reconciliation complete: refund settlement failed.');
      } else if (res.outcome === 'missing_configuration') {
        setError(res.message || 'Payment provider keys (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) are missing in configuration.');
      } else if (res.outcome === 'provider_error') {
        setError(res.message || 'Payment provider authentication failed: invalid or expired Razorpay API keys.');
      } else if (res.outcome === 'provider_unavailable') {
        setError(res.message || 'Payment provider is temporarily unreachable. The refund remains safely pending settlement.');
      } else {
        setMessage(res.message || 'Provider settlement is still in progress. Please check back shortly.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reconcile refund');
    } finally {
      setActionId(null);
      await load(activeTab, page);
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
          onClick={() => void load(activeTab, page)}
          disabled={requests === null}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'self-start sm:self-auto')}
        >
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Filter Tabs with real counts */}
      <div className="flex flex-wrap gap-1.5 border-b pb-2 text-sm">
        {TAB_OPTIONS.map((tab) => {
          const count = counts[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span>{tab.label}</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.2 text-xs font-semibold',
                  activeTab === tab.id
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void load(activeTab, page)}
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
              ? 'No approved refund requests currently processing.'
              : activeTab === 'REFUNDED'
                ? 'No settled refunds found.'
                : activeTab === 'REJECTED'
                  ? 'No rejected refund requests found.'
                  : activeTab === 'FAILED'
                    ? 'No failed or unreconciled refund requests found.'
                    : 'No refund requests found under All requests.'}
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
            const isProcessingSettlement = request.status === 'REFUND_PENDING';

            return (
              <article
                key={request.bookingId}
                className="rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">{request.booking.event.title}</h2>
                      {statusBadge(request.refundRequestStatus, request.status)}
                      {request.status && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground font-mono">
                          Payment: {request.status}
                        </span>
                      )}
                      {request.refundId && (
                        <span className="rounded-full bg-muted/80 px-2 py-0.5 text-xs text-muted-foreground font-mono">
                          Ref: {request.refundId}
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
                      Requested: {request.refundRequestedAt ? new Date(request.refundRequestedAt).toLocaleDateString() : 'recently'}
                    </p>
                    {request.refundReviewedAt && (
                      <p className="text-xs text-muted-foreground">
                        Reviewed: {new Date(request.refundReviewedAt).toLocaleDateString()}
                      </p>
                    )}
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

                <div className="mt-4 flex flex-wrap gap-2.5">
                  {isPending && (
                    <>
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
                    </>
                  )}

                  {isProcessingSettlement && (
                    <button
                      type="button"
                      disabled={actionId !== null}
                      onClick={() => void handleReconcile(request.bookingId)}
                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
                    >
                      {actionId === request.bookingId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Reconcile / Check provider status
                    </button>
                  )}
                </div>
              </article>
            );
          })}

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t pt-4 text-sm text-muted-foreground">
              <span>
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => handlePageChange(page - 1)}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'disabled:opacity-50')}
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => handlePageChange(page + 1)}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'disabled:opacity-50')}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
