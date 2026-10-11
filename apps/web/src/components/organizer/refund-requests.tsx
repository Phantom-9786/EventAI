'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { formatEventDate, formatPrice } from '@/lib/api';
import {
  approveOrganizerRefund,
  getOrganizerRefundRequests,
  rejectOrganizerRefund,
  type OrganizerRefundRequest,
} from '@/lib/organizer';
import { cn } from '@/lib/utils';

export function OrganizerRefundRequests() {
  const [requests, setRequests] = useState<OrganizerRefundRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRequests(await getOrganizerRefundRequests());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load refund requests');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (
    request: OrganizerRefundRequest,
    decision: 'approve' | 'reject',
  ) => {
    const prompt =
      decision === 'approve'
        ? 'Approve this refund request and initiate a full Razorpay refund?'
        : 'Reject this refund request? No refund will be issued.';
    if (!window.confirm(prompt)) return;

    setActionId(request.bookingId);
    setError(null);
    setMessage(null);
    try {
      const result =
        decision === 'approve'
          ? await approveOrganizerRefund(request.bookingId)
          : await rejectOrganizerRefund(request.bookingId);
      setRequests(
        (current) =>
          current?.filter((item) => item.bookingId !== request.bookingId) ?? [],
      );
      setMessage(
        decision === 'approve'
          ? `Refund approved and initiated for ${request.booking.event.title}. The payment may remain pending provider confirmation.`
          : `Refund request rejected for ${request.booking.event.title}.`,
      );
      if (result.refundStatus === 'pending') {
        setMessage(
          `Refund approved for ${request.booking.event.title}, but Razorpay has not yet confirmed completion. Reconciliation is required; do not retry.`,
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Failed to ${decision} refund request`,
      );
      if (decision === 'approve') {
        void load();
      }
    } finally {
      setActionId(null);
    }
  };

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Refund requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review attendee requests. Razorpay is contacted only after you approve one.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={requests === null}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-5 rounded-md border px-3 py-2 text-sm">
          {message}
        </p>
      )}

      {requests === null ? (
        <div className="mt-10 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : requests.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No refund requests are awaiting review.
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {requests.map((request) => {
            const attendee =
              [request.booking.user.firstName, request.booking.user.lastName]
                .filter(Boolean)
                .join(' ') || 'Attendee';
            return (
              <article
                key={request.bookingId}
                className="rounded-lg border bg-card p-4 shadow-sm"
              >
                <div className="flex flex-col justify-between gap-3 sm:flex-row">
                  <div>
                    <h2 className="font-semibold">{request.booking.event.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {attendee} · {request.booking.user.email}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatEventDate(request.booking.event.startDate)} · Booking{' '}
                      {request.bookingId}
                    </p>
                  </div>
                  <p className="font-semibold">{formatPrice(request.amount)}</p>
                </div>
                <p className="mt-3 text-sm">
                  <span className="font-medium">Tickets: </span>
                  {request.booking.items
                    .map((item) => `${item.quantity} × ${item.ticketType.name}`)
                    .join(', ')}
                </p>
                <p className="mt-2 text-sm">
                  <span className="font-medium">Attendee reason: </span>
                  {request.refundRequestReason?.trim() || 'No reason provided'}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
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
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
