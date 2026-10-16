'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BadgeCheck,
  CalendarDays,
  IndianRupee,
  Loader2,
  Search,
  Ticket,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import {
  createAdminCategory,
  deactivateAdminCategory,
  listAdminEvents,
  getAdminBooking,
  listAdminBookings,
  reconcileAdminRefund,
  recoverAdminRefund,
  listAdminAuditLogs,
  listAdminOrganizers,
  listAdminUsers,
  moderateAdminEvent,
  reviewAdminEvent,
  setAdminOrganizerVerification,
  setAdminUserStatus,
  useAdminData,
  type AdminAuditLogRow,
  type AdminEventRow,
  type AdminBookingDetail,
  type AdminBookingRow,
  type AdminOrganizerRow,
  type AdminUser,
} from '@/lib/admin';
import { formatPrice } from '@/lib/api';

type Tab = 'overview' | 'users' | 'events' | 'organizers' | 'bookings' | 'audit-logs';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'events', label: 'Events' },
  { id: 'organizers', label: 'Organizers' },
  { id: 'bookings', label: 'Bookings & payments' },
  { id: 'audit-logs', label: 'Audit logs' },
];

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PUBLISHED: 'bg-green-500/15 text-green-700 dark:text-green-400',
  CANCELLED: 'bg-destructive/15 text-destructive',
  COMPLETED: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  SOLDOUT: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
};

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-5 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? 'bg-muted text-muted-foreground'}`}
    >
      {status}
    </span>
  );
}

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const { stats, categories, error, loading, reload } = useAdminData(user?.role === 'ADMIN');
  const [tab, setTab] = useState<Tab>('overview');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#8B5CF6');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (authLoading) {
    return (
      <div className="container flex flex-col items-center gap-3 py-24 text-muted-foreground" role="status">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
        <p className="text-sm">Checking sign-in…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container flex max-w-md flex-col items-center py-24 text-center">
        <h1 className="text-xl font-semibold">Sign in as an admin to continue</h1>
        <Link href="/signin" className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Sign In
        </Link>
      </div>
    );
  }

  if (user.role !== 'ADMIN') {
    return (
      <div className="container max-w-md py-24 text-center">
        <h1 className="text-xl font-semibold">Admins only</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your account does not have platform administration rights.</p>
      </div>
    );
  }

  if (loading && !stats) {
    return (
      <div className="container flex flex-col items-center gap-3 py-24 text-muted-foreground" role="status">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
        <p className="text-sm">Loading admin dashboard…</p>
      </div>
    );
  }

  const runAction = async (fn: () => Promise<void>) => {
    setActionError(null);
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container py-10">
      <h1 className="text-3xl font-bold tracking-tight">Platform admin</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Platform statistics, users, event moderation, and organizers
      </p>

      <div role="tablist" aria-label="Admin sections" className="mt-6 flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {tab === 'overview' && (
        <div className="mt-8">
          {stats && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Users" value={String(stats.users)} icon={<Users className="h-3.5 w-3.5" />} />
                <StatCard label="Organizers" value={`${stats.organizers.verified}/${stats.organizers.total} verified`} icon={<Users className="h-3.5 w-3.5" />} />
                <StatCard label="Events" value={String(stats.events.total)} icon={<CalendarDays className="h-3.5 w-3.5" />} />
                <StatCard label="Net revenue" value={formatPrice(stats.revenue.net)} icon={<IndianRupee className="h-3.5 w-3.5" />} />
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <StatCard label="Tickets issued" value={String(stats.tickets.issued)} icon={<Ticket className="h-3.5 w-3.5" />} />
                <StatCard label="Checked in" value={String(stats.tickets.checkedIn)} icon={<Ticket className="h-3.5 w-3.5" />} />
                <StatCard label="Confirmed bookings" value={String(stats.bookings.CONFIRMED ?? 0)} icon={<CalendarDays className="h-3.5 w-3.5" />} />
              </div>
            </>
          )}

          <div className="mt-12 flex items-end justify-between">
            <h2 className="text-xl font-semibold">Categories</h2>
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void runAction(async () => {
                  await createAdminCategory({ name, color });
                  setName('');
                });
              }}
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="cat-name" className="text-xs font-medium text-muted-foreground">New category</label>
                <input
                  id="cat-name"
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Film & Cinema"
                  className="h-9 w-52 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <input
                type="color"
                aria-label="Category color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-10 cursor-pointer rounded-md border border-input bg-background p-1"
              />
              <Button type="submit" size="sm" disabled={busy || name.trim().length < 2}>
                {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Create
              </Button>
            </form>
          </div>

          {!categories || categories.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No active categories.
            </p>
          ) : (
            <div className="mt-3 divide-y rounded-lg border">
              {categories.map((cat) => (
                <div key={cat.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: cat.color ?? '#8B5CF6' }} />
                    <div>
                      <p className="font-medium">{cat.name}</p>
                      <p className="text-xs text-muted-foreground">
                        /{cat.slug} · {cat.eventCount} published event{cat.eventCount === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void runAction(() => deactivateAdminCategory(cat.id))}
                  >
                    Deactivate
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'users' && <UsersTab busy={busy} onAction={runAction} />}
      {tab === 'events' && <EventsTab busy={busy} onAction={runAction} />}
      {tab === 'organizers' && <OrganizersTab busy={busy} onAction={runAction} />}
      {tab === 'bookings' && <BookingsTab />}
      {tab === 'audit-logs' && <AuditLogsTab />}
    </div>
  );
}

function BookingsTab() {
  const [bookings, setBookings] = useState<AdminBookingRow[]>([]);
  const [detail, setDetail] = useState<AdminBookingDetail | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void listAdminBookings({
      search: debouncedSearch || undefined,
      status: status || undefined,
      page,
      signal: controller.signal,
    }).then((body) => {
      if (controller.signal.aborted) return;
      setBookings(body.bookings);
      setPages(body.pages);
      setError(null);
    }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Failed to load bookings');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [debouncedSearch, status, page]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setError(null);
    setActionMessage(null);
    try {
      setDetail(await getAdminBooking(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load booking details');
    } finally {
      setDetailLoading(false);
    }
  };

  const reconcile = async () => {
    if (!detail || !window.confirm('Check Razorpay’s authoritative refund status for this booking? This will not create or retry a refund.')) return;
    setReconciling(true);
    setError(null);
    setActionMessage(null);
    try {
      const result = await reconcileAdminRefund(detail.id);
      const freshDetail = await getAdminBooking(detail.id);
      setDetail(freshDetail);
      setBookings((current) => current.map((item) => item.id !== result.bookingId ? item : {
        ...item,
        status: result.status === 'REFUNDED' ? 'REFUNDED' : result.outcome === 'failed' ? 'CONFIRMED' : item.status,
        payment: item.payment ? {
          ...item.payment,
          status: result.outcome === 'processed' ? 'REFUNDED' : result.outcome === 'failed' ? 'CAPTURED' : item.payment.status,
        } : null,
      }));
      setActionMessage(result.outcome === 'processed'
        ? 'Razorpay confirmed the refund. Booking and ticket inventory were reconciled.'
        : result.outcome === 'failed'
          ? 'Razorpay confirmed the refund failed. The payment is retryable; the booking and tickets remain active.'
          : result.outcome === 'not_pending'
            ? `No reconciliation was needed; current payment status is ${result.status}.`
            : 'Razorpay has not provided a definitive outcome. The refund remains pending and no booking or inventory state was changed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund reconciliation failed');
    } finally {
      setReconciling(false);
    }
  };

  const recover = async () => {
    if (!detail) return;
    if (
      !window.confirm(
        'Attempt safe recovery for this approved refund? The system will verify provider state and acquire an atomic claim before processing.',
      )
    ) {
      return;
    }
    setRecovering(true);
    setError(null);
    setActionMessage(null);
    try {
      const result = await recoverAdminRefund(detail.id);
      const freshDetail = await getAdminBooking(detail.id);
      setDetail(freshDetail);
      setBookings((current) =>
        current.map((item) =>
          item.id !== result.bookingId
            ? item
            : {
                ...item,
                status: result.status === 'REFUNDED' ? 'REFUNDED' : item.status,
                payment: item.payment
                  ? {
                      ...item.payment,
                      status: result.status === 'REFUNDED' ? 'REFUNDED' : item.payment.status,
                    }
                  : null,
              },
        ),
      );
      setActionMessage(
        result.status === 'REFUNDED'
          ? 'Refund was safely recovered and processed. Booking and tickets were updated.'
          : result.message ?? `Recovery status: ${result.status}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund recovery failed');
    } finally {
      setRecovering(false);
    }
  };

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); setDetail(null); }} placeholder="Booking ID, customer email, or event" aria-label="Search bookings" className="h-9 w-80 rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); setDetail(null); }} aria-label="Filter bookings by status" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">All booking statuses</option>
          {['PENDING', 'PAYMENT_PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'REFUNDED'].map((value) => <option key={value}>{value}</option>)}
        </select>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {actionMessage && <p role="status" className="mt-3 text-sm text-muted-foreground">{actionMessage}</p>}
      <div className="mt-3 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-2.5">Booking / event</th><th className="px-4 py-2.5">Customer</th><th className="px-4 py-2.5">Booking</th><th className="px-4 py-2.5">Payment</th><th className="px-4 py-2.5">Amount</th><th className="px-4 py-2.5 text-right">Details</th></tr></thead>
          <tbody className="divide-y">
            {bookings.map((booking) => <tr key={booking.id}>
              <td className="px-4 py-3"><p className="font-medium">{booking.event.title}</p><p className="font-mono text-[11px] text-muted-foreground">{booking.id}</p></td>
              <td className="px-4 py-3"><p>{booking.user.firstName} {booking.user.lastName}</p><p className="text-xs text-muted-foreground">{booking.user.email}</p></td>
              <td className="px-4 py-3">{booking.status}</td><td className="px-4 py-3">{booking.payment?.status ?? 'No payment'}</td><td className="px-4 py-3">{formatPrice(booking.totalAmount)}</td>
              <td className="px-4 py-3 text-right"><Button size="sm" variant="outline" disabled={detailLoading} onClick={() => void openDetail(booking.id)}>View</Button></td>
            </tr>)}
            {!loading && bookings.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No bookings match the filters.</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && <div className="mt-3 flex items-center justify-end gap-2 text-sm"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button><span className="text-muted-foreground">Page {page} of {pages}</span><Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button></div>}
      {detailLoading && <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading booking details…</div>}
      {detail && <section aria-label="Booking detail" className="mt-6 rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">Booking details</h2><p className="mt-1 font-mono text-xs text-muted-foreground">{detail.id}</p></div><Button size="sm" variant="ghost" onClick={() => setDetail(null)}>Close</Button></div>
        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <p><span className="text-muted-foreground">Customer:</span><br />{detail.user.firstName} {detail.user.lastName} · {detail.user.email}</p>
          <p><span className="text-muted-foreground">Event:</span><br />{detail.event.title}</p>
          <p><span className="text-muted-foreground">Booking status:</span><br />{detail.status}</p>
          <p><span className="text-muted-foreground">Payment status:</span><br />{detail.payment?.status ?? 'No payment'}</p>
          <p><span className="text-muted-foreground">Booking amount:</span><br />{formatPrice(detail.totalAmount)}</p>
          <p><span className="text-muted-foreground">Refund amount:</span><br />{detail.payment?.refundAmount == null ? '—' : formatPrice(detail.payment.refundAmount)}</p>
          <p><span className="text-muted-foreground">Payment method:</span><br />{detail.payment?.method ?? '—'}</p>
          <p><span className="text-muted-foreground">Refund reference:</span><br /><span className="font-mono text-xs">{detail.payment?.refundId ?? '—'}</span></p>
          <p><span className="text-muted-foreground">Created:</span><br />{new Date(detail.createdAt).toLocaleString()}</p>
        </div>
        <h3 className="mt-5 text-sm font-semibold">Items and tickets</h3>
        <ul className="mt-2 space-y-1 text-sm">{detail.items.map((item, index) => <li key={`${item.ticketType.name}-${index}`}>{item.ticketType.name} · {item.quantity} × {formatPrice(item.unitPrice)} = {formatPrice(item.totalPrice)}</li>)}</ul>
        <p className="mt-3 text-xs text-muted-foreground">Ticket states: {Object.entries(detail.ticketCounts).map(([state, count]) => `${state}: ${count}`).join(' · ') || 'No tickets issued'}</p>
        {detail.cancellationReason && <p className="mt-3 text-sm text-muted-foreground">Cancellation reason: {detail.cancellationReason}</p>}
        {detail.payment?.status === 'REFUND_PENDING' && (
          <div className="mt-4 space-y-3">
            {detail.payment?.refundRequestStatus === 'APPROVED' && !detail.payment?.refundId && (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
                <div className="flex-1">
                  <p className="text-xs font-semibold text-primary">Approved refund awaiting recovery</p>
                  <p className="text-xs text-muted-foreground">
                    This refund was approved but failed before provider creation. Safe recovery checks provider status, acquires an atomic claim, and executes the refund without duplicating.
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={recovering || reconciling}
                  onClick={() => void recover()}
                >
                  {recovering && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  {recovering ? 'Recovering refund…' : 'Recover refund'}
                </Button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-muted p-3">
              <p className="flex-1 text-xs text-muted-foreground">
                The refund outcome is unresolved. This action checks Razorpay and never issues another refund.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={reconciling || recovering}
                onClick={() => void reconcile()}
              >
                {reconciling && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                {reconciling ? 'Checking provider…' : 'Reconcile refund'}
              </Button>
            </div>
          </div>
        )}
      </section>}
    </div>
  );
}

// ── Users tab ───────────────────────────────────────

function UsersTab({
  busy,
  onAction,
}: {
  busy: boolean;
  onAction: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await listAdminUsers({
        search: search || undefined,
        role: role || undefined,
        page,
      });
      setUsers(body.users);
      setPages(body.pages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [search, role, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search email or name"
            aria-label="Search users"
            className="h-9 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by role"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">All roles</option>
          <option value="CUSTOMER">Customer</option>
          <option value="ORGANIZER">Organizer</option>
          <option value="ADMIN">Admin</option>
        </select>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-3 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5">User</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Bookings</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(users ?? []).map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">
                    {u.firstName} {u.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </td>
                <td className="px-4 py-3">{u.role}</td>
                <td className="px-4 py-3">{u.bookingCount}</td>
                <td className="px-4 py-3">
                  {!u.isActive ? (
                    <span className="text-destructive">Deactivated</span>
                  ) : u.isEmailVerified ? (
                    'Active'
                  ) : (
                    'Active (unverified)'
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void onAction(async () => {
                        await setAdminUserStatus(u.id, !u.isActive);
                        await load();
                      })
                    }
                  >
                    {u.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </td>
              </tr>
            ))}
            {!loading && (users ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No users match the filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Events tab ──────────────────────────────────────

function EventsTab({
  busy,
  onAction,
}: {
  busy: boolean;
  onAction: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [events, setEvents] = useState<AdminEventRow[] | null>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await listAdminEvents({
        search: search || undefined,
        status: status || undefined,
        page,
      });
      setEvents(body.events);
      setPages(body.pages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search event title"
            aria-label="Search events"
            className="h-9 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="COMPLETED">Completed</option>
          <option value="SOLDOUT">Sold out</option>
        </select>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-3 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5">Event</th>
              <th className="px-4 py-2.5">Organizer</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Bookings</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(events ?? []).map((ev) => (
              <tr key={ev.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{ev.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {ev.venue ? `${ev.venue.name}, ${ev.venue.city}` : 'No venue'}
                  </p>
                </td>
                <td className="px-4 py-3 text-xs">{ev.organizerEmail}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <StatusBadge status={ev.status} />
                    {ev.moderation && (
                      <span className={`w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        ev.moderation.status === 'PENDING_APPROVAL' ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' :
                        ev.moderation.status === 'APPROVED' ? 'bg-green-500/20 text-green-700 dark:text-green-300' :
                        ev.moderation.status === 'REJECTED' ? 'bg-destructive/20 text-destructive' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {ev.moderation.status === 'PENDING_APPROVAL' ? 'PENDING REVIEW' : ev.moderation.status}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">{ev.bookingCount}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1.5">
                    {ev.moderation?.status === 'PENDING_APPROVAL' && (
                      <>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void onAction(async () => {
                              await reviewAdminEvent(ev.id, 'APPROVE');
                              await load();
                            })
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            const reason = window.prompt('Rejection reason (required):');
                            if (!reason || !reason.trim()) return;
                            void onAction(async () => {
                              await reviewAdminEvent(ev.id, 'REJECT', reason.trim());
                              await load();
                            });
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {ev.status === 'PUBLISHED' && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          const reason = window.prompt('Moderation reason (optional):') ?? undefined;
                          void onAction(async () => {
                            await moderateAdminEvent(ev.id, reason || undefined);
                            await load();
                          });
                        }}
                      >
                        Cancel event
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && (events ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No events match the filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Organizers tab ──────────────────────────────────

function OrganizersTab({
  busy,
  onAction,
}: {
  busy: boolean;
  onAction: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [organizers, setOrganizers] = useState<AdminOrganizerRow[] | null>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await listAdminOrganizers({ search: search || undefined, page });
      setOrganizers(body.organizers);
      setPages(body.pages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load organizers');
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search organization or email"
            aria-label="Search organizers"
            className="h-9 w-64 rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-3 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5">Organization</th>
              <th className="px-4 py-2.5">Contact</th>
              <th className="px-4 py-2.5">Events</th>
              <th className="px-4 py-2.5">Venues</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(organizers ?? []).map((o) => (
              <tr key={o.id}>
                <td className="px-4 py-3">
                  <p className="flex items-center gap-1.5 font-medium">
                    {o.organizationName}
                    {o.isVerified && <BadgeCheck className="h-4 w-4 text-primary" aria-label="Verified" />}
                  </p>
                </td>
                <td className="px-4 py-3 text-xs">
                  {o.user.email}
                  {!o.user.isActive && <span className="ml-1 text-destructive">(deactivated)</span>}
                </td>
                <td className="px-4 py-3">{o.eventCount}</td>
                <td className="px-4 py-3">{o.venueCount}</td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void onAction(async () => {
                        await setAdminOrganizerVerification(o.id, !o.isVerified);
                        await load();
                      })
                    }
                  >
                    {o.isVerified ? 'Remove badge' : 'Verify'}
                  </Button>
                </td>
              </tr>
            ))}
            {!loading && (organizers ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No organizers match the filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Audit logs tab ──────────────────────────────────

function AuditLogsTab() {
  const [logs, setLogs] = useState<AdminAuditLogRow[] | null>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const body = await listAdminAuditLogs({
        search: debouncedSearch || undefined,
        entity: entity || undefined,
        action: action || undefined,
        page,
        signal,
      });
      setLogs(body.logs);
      setPages(body.pages);
      setError(null);
    } catch (err) {
      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : 'Failed to load audit logs');
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [debouncedSearch, entity, action, page]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search email, action, or entity ID"
            aria-label="Search audit logs"
            className="h-9 w-72 rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <select
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by entity"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">All entities</option>
          <option value="USER">User</option>
          <option value="ORGANIZER">Organizer</option>
          <option value="EVENT">Event</option>
          <option value="PAYMENT">Payment</option>
        </select>
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by action"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">All actions</option>
          <option value="USER_ACTIVATED">USER_ACTIVATED</option>
          <option value="USER_DEACTIVATED">USER_DEACTIVATED</option>
          <option value="ORGANIZER_VERIFIED">ORGANIZER_VERIFIED</option>
          <option value="ORGANIZER_UNVERIFIED">ORGANIZER_UNVERIFIED</option>
          <option value="EVENT_CANCELLED_BY_ADMIN">EVENT_CANCELLED_BY_ADMIN</option>
          <option value="REFUND_RECONCILIATION_REQUIRED">REFUND_RECONCILIATION_REQUIRED</option>
        </select>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-3 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5">Timestamp</th>
              <th className="px-4 py-2.5">Acting Admin</th>
              <th className="px-4 py-2.5">Action</th>
              <th className="px-4 py-2.5">Entity</th>
              <th className="px-4 py-2.5">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(logs ?? []).map((log) => (
              <tr key={log.id}>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                  {new Date(log.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  {log.user ? (
                    <div>
                      <p className="font-medium">{log.user.firstName} {log.user.lastName}</p>
                      <p className="text-xs text-muted-foreground">{log.user.email}</p>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">System / Unknown</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-block rounded bg-muted px-2 py-0.5 font-mono text-xs font-medium">
                    {log.action}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <p className="text-xs font-semibold">{log.entity}</p>
                  {log.entityId && (
                    <p className="font-mono text-[11px] text-muted-foreground">{log.entityId}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  {log.details ? (
                    <pre className="max-w-xs overflow-x-auto rounded bg-muted/60 p-1.5 font-mono text-[11px] text-muted-foreground">
                      {JSON.stringify(log.details, null, 1)}
                    </pre>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && (logs ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No audit logs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

