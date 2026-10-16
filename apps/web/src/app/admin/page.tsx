'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  IndianRupee,
  Loader2,
  Phone,
  Search,
  ShieldAlert,
  Ticket,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
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
  listPendingOrganizerApplications,
  approveOrganizerApplication,
  rejectOrganizerApplication,
  useAdminData,
  type AdminAuditLogRow,
  type AdminEventRow,
  type AdminBookingDetail,
  type AdminBookingRow,
  type AdminOrganizerRow,
  type AdminUser,
  type OrganizerApplication,
} from '@/lib/admin';
import { formatPrice } from '@/lib/api';

type Tab = 'overview' | 'users' | 'events' | 'organizers' | 'bookings' | 'audit-logs';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'events', label: 'Events' },
  { id: 'organizers', label: 'Organizers & Applications' },
  { id: 'bookings', label: 'Bookings & payments' },
  { id: 'audit-logs', label: 'Audit logs' },
];

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground border-border',
  PUBLISHED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  CANCELLED: 'bg-destructive/10 text-destructive border-destructive/20',
  COMPLETED: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  SOLDOUT: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
};

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        STATUS_COLORS[status] ?? 'bg-muted text-muted-foreground border-border'
      }`}
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
  const [color, setColor] = useState('#6366F1');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (authLoading) {
    return (
      <div className="container flex flex-col items-center justify-center gap-3 py-32 text-muted-foreground" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm font-medium">Checking authorization…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container flex max-w-md flex-col items-center py-24 text-center">
        <div className="rounded-full bg-primary/10 p-3 text-primary">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Admin Sign In Required</h1>
        <p className="mt-2 text-sm text-muted-foreground">Please sign in with administrator credentials to view this area.</p>
        <Link href="/signin" className="mt-6 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow transition hover:bg-primary/90">
          Sign In
        </Link>
      </div>
    );
  }

  if (user.role !== 'ADMIN') {
    return (
      <div className="container max-w-md py-24 text-center">
        <div className="rounded-full bg-destructive/10 p-3 text-destructive inline-block">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Access Restricted</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your account does not have platform administration rights.</p>
        <Link href="/" className="mt-6 inline-block rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-accent">
          Return to Home
        </Link>
      </div>
    );
  }

  if (loading && !stats) {
    return (
      <div className="container flex flex-col items-center justify-center gap-3 py-32 text-muted-foreground" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm font-medium">Loading platform dashboard…</p>
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
    <div className="container py-8 sm:py-10">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl text-foreground">Platform Administration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform metrics, user governance, event review, organizer approvals, and payment oversight.
          </p>
        </div>
        <div className="mt-3 sm:mt-0">
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={busy || loading}>
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Refresh Data
          </Button>
        </div>
      </div>

      <div role="tablist" aria-label="Admin sections" className="mt-6 flex overflow-x-auto border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="mt-6 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p>{error}</p>
        </div>
      )}
      {actionError && (
        <div role="alert" className="mt-4 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p>{actionError}</p>
        </div>
      )}

      {tab === 'overview' && (
        <div className="mt-8 space-y-8">
          {stats && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Total Users" value={stats.users.toLocaleString()} icon={<Users className="h-4 w-4" />} />
                <StatCard label="Organizers" value={`${stats.organizers.verified} / ${stats.organizers.total} verified`} icon={<Building2 className="h-4 w-4" />} />
                <StatCard label="Total Events" value={stats.events.total.toLocaleString()} icon={<CalendarDays className="h-4 w-4" />} />
                <StatCard label="Net Revenue" value={formatPrice(stats.revenue.net)} icon={<IndianRupee className="h-4 w-4" />} />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard label="Tickets Issued" value={stats.tickets.issued.toLocaleString()} icon={<Ticket className="h-4 w-4" />} />
                <StatCard label="Checked In" value={stats.tickets.checkedIn.toLocaleString()} icon={<Ticket className="h-4 w-4" />} />
                <StatCard label="Confirmed Bookings" value={String(stats.bookings.CONFIRMED ?? 0)} icon={<CalendarDays className="h-4 w-4" />} />
              </div>
            </>
          )}

          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Event Categories</h2>
                <p className="text-xs text-muted-foreground">Manage platform-wide event categorization tags.</p>
              </div>
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void runAction(async () => {
                    await createAdminCategory({ name, color });
                    setName('');
                  });
                }}
              >
                <input
                  id="cat-name"
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="New category name"
                  aria-label="Category name"
                  className="h-9 w-44 sm:w-56 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <input
                  type="color"
                  aria-label="Category color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 w-10 cursor-pointer rounded-md border border-input bg-background p-1"
                />
                <Button type="submit" size="sm" disabled={busy || name.trim().length < 2}>
                  {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Create
                </Button>
              </form>
            </div>

            {!categories || categories.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No active categories. Create one above to get started.
              </p>
            ) : (
              <div className="mt-4 divide-y rounded-lg border">
                {categories.map((cat) => (
                  <div key={cat.id} className="flex items-center justify-between gap-3 p-3.5">
                    <div className="flex items-center gap-3">
                      <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: cat.color ?? '#6366F1' }} />
                      <div>
                        <p className="text-sm font-medium">{cat.name}</p>
                        <p className="text-xs text-muted-foreground">
                          /{cat.slug} · {cat.eventCount} published event{cat.eventCount === 1 ? '' : 's'}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
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

  // User deactivation / activation confirmation modal
  const [statusModal, setStatusModal] = useState<{
    isOpen: boolean;
    user: AdminUser | null;
    targetActive: boolean;
  }>({
    isOpen: false,
    user: null,
    targetActive: false,
  });

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

  const confirmStatusChange = async () => {
    if (!statusModal.user) return;
    const target = statusModal.user;
    const newActive = statusModal.targetActive;
    setStatusModal({ isOpen: false, user: null, targetActive: false });

    await onAction(async () => {
      await setAdminUserStatus(target.id, newActive);
      await load();
    });
  };

  return (
    <div className="mt-8 space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search email or name"
            aria-label="Search users"
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by role"
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
        >
          <option value="">All user roles</option>
          <option value="CUSTOMER">Customer</option>
          <option value="ORGANIZER">Organizer</option>
          <option value="ADMIN">Admin</option>
        </select>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">User</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Bookings</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(users ?? []).map((u) => (
              <tr key={u.id} className="transition-colors hover:bg-muted/30">
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">
                    {u.firstName} {u.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-block rounded-md bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">{u.bookingCount}</td>
                <td className="px-4 py-3">
                  {!u.isActive ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                      <UserX className="h-3 w-3" /> Deactivated
                    </span>
                  ) : u.isEmailVerified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      <UserCheck className="h-3 w-3" /> Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      <Clock className="h-3 w-3" /> Unverified Email
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      setStatusModal({
                        isOpen: true,
                        user: u,
                        targetActive: !u.isActive,
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
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  No users found matching your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm pt-2">
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

      {/* Confirmation Modal */}
      <Modal
        isOpen={statusModal.isOpen}
        onClose={() => setStatusModal({ isOpen: false, user: null, targetActive: false })}
        title={statusModal.targetActive ? 'Reactivate User Account' : 'Deactivate User Account'}
        description={
          statusModal.targetActive
            ? `Reactivate account for ${statusModal.user?.firstName} ${statusModal.user?.lastName} (${statusModal.user?.email})? They will be allowed to log in again.`
            : `Are you sure you want to deactivate ${statusModal.user?.firstName} ${statusModal.user?.lastName} (${statusModal.user?.email})? All active user sessions will be invalidated immediately.`
        }
        confirmLabel={statusModal.targetActive ? 'Activate User' : 'Deactivate User'}
        confirmVariant={statusModal.targetActive ? 'default' : 'destructive'}
        onConfirm={confirmStatusChange}
        isLoading={busy}
      />
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

  // In-UI modal for event approval, rejection, and cancellation
  const [modModal, setModModal] = useState<{
    isOpen: boolean;
    type: 'APPROVE' | 'REJECT' | 'CANCEL';
    event: AdminEventRow | null;
    reason: string;
  }>({
    isOpen: false,
    type: 'APPROVE',
    event: null,
    reason: '',
  });

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

  const handleModerationSubmit = async () => {
    if (!modModal.event) return;
    const { type, event, reason } = modModal;
    setModModal((prev) => ({ ...prev, isOpen: false }));

    await onAction(async () => {
      if (type === 'APPROVE') {
        await reviewAdminEvent(event.id, 'APPROVE');
      } else if (type === 'REJECT') {
        await reviewAdminEvent(event.id, 'REJECT', reason.trim());
      } else if (type === 'CANCEL') {
        await moderateAdminEvent(event.id, reason.trim() || undefined);
      }
      await load();
    });
  };

  return (
    <div className="mt-8 space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search event title"
            aria-label="Search events"
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Event</th>
              <th className="px-4 py-3 font-semibold">Organizer</th>
              <th className="px-4 py-3 font-semibold">Status / Moderation</th>
              <th className="px-4 py-3 font-semibold">Bookings</th>
              <th className="px-4 py-3 text-right font-semibold">Moderation Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(events ?? []).map((ev) => (
              <tr key={ev.id} className="transition-colors hover:bg-muted/30">
                <td className="px-4 py-3">
                  <p className="font-semibold text-foreground">{ev.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {ev.venue ? `${ev.venue.name}, ${ev.venue.city}` : 'No venue configured'}
                  </p>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{ev.organizerEmail}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1 items-start">
                    <StatusBadge status={ev.status} />
                    {ev.moderation && (
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          ev.moderation.status === 'PENDING_APPROVAL'
                            ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                            : ev.moderation.status === 'APPROVED'
                              ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                              : ev.moderation.status === 'REJECTED'
                                ? 'bg-destructive/20 text-destructive'
                                : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {ev.moderation.status === 'PENDING_APPROVAL' ? 'Pending Review' : ev.moderation.status}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 font-medium">{ev.bookingCount}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    {ev.moderation?.status === 'PENDING_APPROVAL' && (
                      <>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            setModModal({
                              isOpen: true,
                              type: 'APPROVE',
                              event: ev,
                              reason: '',
                            })
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            setModModal({
                              isOpen: true,
                              type: 'REJECT',
                              event: ev,
                              reason: '',
                            })
                          }
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {ev.status === 'PUBLISHED' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                        disabled={busy}
                        onClick={() =>
                          setModModal({
                            isOpen: true,
                            type: 'CANCEL',
                            event: ev,
                            reason: '',
                          })
                        }
                      >
                        Cancel Event
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && (events ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  No events found matching your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm pt-2">
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

      {/* Event Moderation Modal */}
      <Modal
        isOpen={modModal.isOpen}
        onClose={() => setModModal((prev) => ({ ...prev, isOpen: false }))}
        title={
          modModal.type === 'APPROVE'
            ? 'Approve Event for Publication'
            : modModal.type === 'REJECT'
              ? 'Reject Event Submission'
              : 'Cancel Published Event'
        }
        description={
          modModal.type === 'APPROVE'
            ? `Approve "${modModal.event?.title}"? The event will transition to APPROVED status and can be published immediately.`
            : modModal.type === 'REJECT'
              ? `Provide a required feedback reason for rejecting "${modModal.event?.title}". The organizer will see this note to submit revisions.`
              : `Cancelling "${modModal.event?.title}" will invalidate all active tickets and create refund requests for captured bookings.`
        }
        confirmLabel={
          modModal.type === 'APPROVE'
            ? 'Approve Event'
            : modModal.type === 'REJECT'
              ? 'Reject Submission'
              : 'Cancel Event'
        }
        confirmVariant={modModal.type === 'APPROVE' ? 'default' : 'destructive'}
        isConfirmDisabled={modModal.type === 'REJECT' && modModal.reason.trim().length === 0}
        onConfirm={handleModerationSubmit}
        isLoading={busy}
      >
        {modModal.type !== 'APPROVE' && (
          <div className="mt-3 flex flex-col gap-1.5">
            <label htmlFor="mod-reason" className="text-xs font-semibold uppercase text-muted-foreground">
              {modModal.type === 'REJECT' ? 'Rejection Reason (Required)' : 'Reason for Cancellation (Optional)'}
            </label>
            <textarea
              id="mod-reason"
              rows={3}
              required={modModal.type === 'REJECT'}
              value={modModal.reason}
              onChange={(e) => setModModal((prev) => ({ ...prev, reason: e.target.value }))}
              placeholder={
                modModal.type === 'REJECT'
                  ? 'e.g. Please clarify ticket cancellation policies and supply venue details.'
                  : 'e.g. Event cancelled due to severe weather warning.'
              }
              className="w-full rounded-md border border-input bg-background p-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Organizers tab (with pending application review) ────────

function OrganizersTab({
  busy,
  onAction,
}: {
  busy: boolean;
  onAction: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [subTab, setSubTab] = useState<'pending' | 'all'>('pending');
  const [applications, setApplications] = useState<OrganizerApplication[] | null>(null);
  const [pendingLoading, setPendingLoading] = useState(true);

  const [organizers, setOrganizers] = useState<AdminOrganizerRow[] | null>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal dialog for approving / rejecting applications or toggling badge
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: 'approve_app' | 'reject_app' | 'toggle_badge';
    app?: OrganizerApplication | null;
    org?: AdminOrganizerRow | null;
    reason: string;
  }>({
    isOpen: false,
    type: 'approve_app',
    reason: '',
  });

  const loadPending = useCallback(async () => {
    setPendingLoading(true);
    try {
      const res = await listPendingOrganizerApplications();
      setApplications(res.applications);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pending organizer applications');
    } finally {
      setPendingLoading(false);
    }
  }, []);

  const loadOrganizers = useCallback(async () => {
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
    void loadPending();
    void loadOrganizers();
  }, [loadPending, loadOrganizers]);

  const handleModalConfirm = async () => {
    const { type, app, org, reason } = modalState;
    setModalState((prev) => ({ ...prev, isOpen: false }));

    await onAction(async () => {
      if (type === 'approve_app' && app) {
        await approveOrganizerApplication(app.id);
        await loadPending();
        await loadOrganizers();
      } else if (type === 'reject_app' && app) {
        await rejectOrganizerApplication(app.id, reason.trim());
        await loadPending();
        await loadOrganizers();
      } else if (type === 'toggle_badge' && org) {
        await setAdminOrganizerVerification(org.id, !org.isVerified);
        await loadOrganizers();
      }
    });
  };

  const pendingCount = applications ? applications.length : 0;

  return (
    <div className="mt-8 space-y-6">
      {/* Sub tabs */}
      <div className="flex items-center gap-2 border-b pb-3">
        <button
          type="button"
          onClick={() => setSubTab('pending')}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors ${
            subTab === 'pending'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          <Building2 className="h-4 w-4" />
          Pending Applications
          {pendingCount > 0 && (
            <span
              className={`rounded-full px-2 py-0.2 text-xs font-bold ${
                subTab === 'pending' ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/10 text-primary'
              }`}
            >
              {pendingCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('all')}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors ${
            subTab === 'all'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          <BadgeCheck className="h-4 w-4" />
          Registered Organizers
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Subtab: Pending Applications */}
      {subTab === 'pending' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">Organizer Application Review Queue</h2>
              <p className="text-xs text-muted-foreground">
                Review and approve organizations applying to create and host ticketed events.
              </p>
            </div>
            {pendingLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {!pendingLoading && (!applications || applications.length === 0) ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card p-12 text-center shadow-sm">
              <div className="rounded-full bg-emerald-500/10 p-3 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h3 className="mt-3 text-base font-semibold text-foreground">No Pending Applications</h3>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                All organizer onboarding applications have been reviewed. New applications will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(applications ?? []).map((app) => (
                <div
                  key={app.id}
                  className="flex flex-col justify-between rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold">
                          {app.organizationName.charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <h3 className="font-semibold text-foreground">{app.organizationName}</h3>
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                            <Clock className="h-3 w-3" /> Awaiting Review
                          </span>
                        </div>
                      </div>
                    </div>

                    {app.description && (
                      <p className="line-clamp-3 text-xs text-muted-foreground">{app.description}</p>
                    )}

                    <div className="space-y-1.5 rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground">
                      {app.phone && (
                        <p className="flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 shrink-0" />
                          <span>{app.phone}</span>
                        </p>
                      )}
                      {app.website && (
                        <p className="flex items-center gap-1.5 truncate">
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          <a
                            href={app.website.startsWith('http') ? app.website : `https://${app.website}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate text-primary hover:underline"
                          >
                            {app.website}
                          </a>
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground/80 font-mono truncate">
                        Applicant ID: {app.userId}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-end gap-2 border-t pt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() =>
                        setModalState({
                          isOpen: true,
                          type: 'reject_app',
                          app,
                          reason: '',
                        })
                      }
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        setModalState({
                          isOpen: true,
                          type: 'approve_app',
                          app,
                          reason: '',
                        })
                      }
                    >
                      Approve Application
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Subtab: All Registered Organizers */}
      {subTab === 'all' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search organization or email"
                aria-label="Search organizers"
                className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Organization</th>
                  <th className="px-4 py-3 font-semibold">Primary Contact</th>
                  <th className="px-4 py-3 font-semibold">Events</th>
                  <th className="px-4 py-3 font-semibold">Venues</th>
                  <th className="px-4 py-3 text-right font-semibold">Verification Badge</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(organizers ?? []).map((o) => (
                  <tr key={o.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <p className="flex items-center gap-1.5 font-semibold text-foreground">
                        {o.organizationName}
                        {o.isVerified && <BadgeCheck className="h-4 w-4 text-primary" aria-label="Verified" />}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {o.user.email}
                      {!o.user.isActive && <span className="ml-1 text-destructive font-medium">(account deactivated)</span>}
                    </td>
                    <td className="px-4 py-3 font-medium">{o.eventCount}</td>
                    <td className="px-4 py-3 font-medium">{o.venueCount}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          setModalState({
                            isOpen: true,
                            type: 'toggle_badge',
                            org: o,
                            reason: '',
                          })
                        }
                      >
                        {o.isVerified ? 'Remove Badge' : 'Verify Organizer'}
                      </Button>
                    </td>
                  </tr>
                ))}
                {!loading && (organizers ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      No organizers found matching your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm pt-2">
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
      )}

      {/* Confirmation & Rejection Modal for Organizers */}
      <Modal
        isOpen={modalState.isOpen}
        onClose={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
        title={
          modalState.type === 'approve_app'
            ? 'Approve Organizer Application'
            : modalState.type === 'reject_app'
              ? 'Reject Organizer Application'
              : modalState.org?.isVerified
                ? 'Remove Verification Badge'
                : 'Grant Verified Status'
        }
        description={
          modalState.type === 'approve_app'
            ? `Approve application for "${modalState.app?.organizationName}"? This promotes the user to an official Organizer, permitting them to create and publish ticketed events.`
            : modalState.type === 'reject_app'
              ? `Provide a reason for rejecting the organizer application for "${modalState.app?.organizationName}". The applicant will be able to see this reason and reapply.`
              : modalState.org?.isVerified
                ? `Remove verified badge for "${modalState.org?.organizationName}"?`
                : `Grant verified trust badge to "${modalState.org?.organizationName}"?`
        }
        confirmLabel={
          modalState.type === 'approve_app'
            ? 'Approve Application'
            : modalState.type === 'reject_app'
              ? 'Reject Application'
              : modalState.org?.isVerified
                ? 'Remove Badge'
                : 'Verify Organizer'
        }
        confirmVariant={modalState.type === 'reject_app' ? 'destructive' : 'default'}
        isConfirmDisabled={modalState.type === 'reject_app' && modalState.reason.trim().length === 0}
        onConfirm={handleModalConfirm}
        isLoading={busy}
      >
        {modalState.type === 'reject_app' && (
          <div className="mt-3 flex flex-col gap-1.5">
            <label htmlFor="app-rejection-reason" className="text-xs font-semibold uppercase text-muted-foreground">
              Rejection Reason (Required)
            </label>
            <textarea
              id="app-rejection-reason"
              rows={3}
              required
              value={modalState.reason}
              onChange={(e) => setModalState((prev) => ({ ...prev, reason: e.target.value }))}
              placeholder="e.g. Please provide a registered organization phone number and valid website."
              className="w-full rounded-md border border-input bg-background p-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Bookings & payments tab ─────────────────────────

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

  // In-UI modal for refund reconcile & recover
  const [actionModal, setActionModal] = useState<{
    isOpen: boolean;
    type: 'reconcile' | 'recover';
  }>({
    isOpen: false,
    type: 'reconcile',
  });

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
    })
      .then((body) => {
        if (controller.signal.aborted) return;
        setBookings(body.bookings);
        setPages(body.pages);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Failed to load bookings');
      })
      .finally(() => {
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

  const handleReconcile = async () => {
    if (!detail) return;
    setActionModal({ isOpen: false, type: 'reconcile' });
    setReconciling(true);
    setError(null);
    setActionMessage(null);
    try {
      const result = await reconcileAdminRefund(detail.id);
      const freshDetail = await getAdminBooking(detail.id);
      setDetail(freshDetail);
      setBookings((current) =>
        current.map((item) =>
          item.id !== result.bookingId
            ? item
            : {
                ...item,
                status: result.status === 'REFUNDED' ? 'REFUNDED' : result.outcome === 'failed' ? 'CONFIRMED' : item.status,
                payment: item.payment
                  ? {
                      ...item.payment,
                      status:
                        result.outcome === 'processed'
                          ? 'REFUNDED'
                          : result.outcome === 'failed'
                            ? 'CAPTURED'
                            : item.payment.status,
                    }
                  : null,
              },
        ),
      );
      setActionMessage(
        result.outcome === 'processed'
          ? 'Authoritative payment provider confirmed the refund. Booking and ticket inventory were reconciled.'
          : result.outcome === 'failed'
            ? 'Provider confirmed the refund failed. Payment is retryable; booking remains active.'
            : result.outcome === 'not_pending'
              ? `No reconciliation was needed; current payment status is ${result.status}.`
              : 'Provider has not returned a definitive settlement outcome. The refund remains pending.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund reconciliation failed');
    } finally {
      setReconciling(false);
    }
  };

  const handleRecover = async () => {
    if (!detail) return;
    setActionModal({ isOpen: false, type: 'recover' });
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
    <div className="mt-8 space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
              setDetail(null);
            }}
            placeholder="Search booking ID, customer email, or event"
            aria-label="Search bookings"
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
            setDetail(null);
          }}
          aria-label="Filter bookings by status"
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
        >
          <option value="">All booking statuses</option>
          {['PENDING', 'PAYMENT_PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'REFUNDED'].map((val) => (
            <option key={val}>{val}</option>
          ))}
        </select>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {actionMessage && <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{actionMessage}</p>}

      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Booking / Event</th>
              <th className="px-4 py-3 font-semibold">Customer</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Payment</th>
              <th className="px-4 py-3 font-semibold">Total</th>
              <th className="px-4 py-3 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {bookings.map((booking) => (
              <tr key={booking.id} className="transition-colors hover:bg-muted/30">
                <td className="px-4 py-3">
                  <p className="font-semibold text-foreground">{booking.event.title}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{booking.id}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium">
                    {booking.user.firstName} {booking.user.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">{booking.user.email}</p>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={booking.status} />
                </td>
                <td className="px-4 py-3 text-xs font-medium">
                  {booking.payment?.status ?? 'No payment record'}
                </td>
                <td className="px-4 py-3 font-semibold">{formatPrice(booking.totalAmount)}</td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={detailLoading}
                    onClick={() => void openDetail(booking.id)}
                  >
                    View Detail
                  </Button>
                </td>
              </tr>
            ))}
            {!loading && bookings.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  No bookings found matching your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm pt-2">
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

      {detailLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Loading booking details…
        </div>
      )}

      {detail && (
        <section aria-label="Booking detail" className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-4">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-foreground">Booking Record</h2>
              <p className="font-mono text-xs text-muted-foreground">{detail.id}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setDetail(null)}>
              Close
            </Button>
          </div>

          <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs uppercase font-semibold text-muted-foreground">Customer</p>
              <p className="mt-1 font-medium">{detail.user.firstName} {detail.user.lastName}</p>
              <p className="text-xs text-muted-foreground">{detail.user.email}</p>
            </div>
            <div>
              <p className="text-xs uppercase font-semibold text-muted-foreground">Event</p>
              <p className="mt-1 font-medium">{detail.event.title}</p>
            </div>
            <div>
              <p className="text-xs uppercase font-semibold text-muted-foreground">Booking Status</p>
              <p className="mt-1"><StatusBadge status={detail.status} /></p>
            </div>
            <div>
              <p className="text-xs uppercase font-semibold text-muted-foreground">Payment Status</p>
              <p className="mt-1 font-medium">{detail.payment?.status ?? 'No payment'}</p>
            </div>
            <div>
              <p className="text-xs uppercase font-semibold text-muted-foreground">Total Paid</p>
              <p className="mt-1 font-semibold">{formatPrice(detail.totalAmount)}</p>
            </div>
            <div>
              <p className="text-xs uppercase font-semibold text-muted-foreground">Refunded</p>
              <p className="mt-1 font-medium">
                {detail.payment?.refundAmount == null ? '—' : formatPrice(detail.payment.refundAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase font-semibold text-muted-foreground">Payment Method</p>
              <p className="mt-1">{detail.payment?.method ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase font-semibold text-muted-foreground">Refund Reference</p>
              <p className="mt-1 font-mono text-xs">{detail.payment?.refundId ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase font-semibold text-muted-foreground">Created</p>
              <p className="mt-1 text-xs">{new Date(detail.createdAt).toLocaleString()}</p>
            </div>
          </div>

          <div className="mt-6 border-t pt-4">
            <h3 className="text-sm font-semibold text-foreground">Items and Tickets</h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              {detail.items.map((item, index) => (
                <li key={`${item.ticketType.name}-${index}`} className="flex justify-between border-b pb-1 text-xs sm:text-sm">
                  <span>{item.ticketType.name} × {item.quantity}</span>
                  <span className="font-semibold">{formatPrice(item.totalPrice)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Ticket status breakdown:{' '}
              {Object.entries(detail.ticketCounts)
                .map(([st, cnt]) => `${st}: ${cnt}`)
                .join(' · ') || 'No tickets issued'}
            </p>
            {detail.cancellationReason && (
              <p className="mt-3 rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground">
                <span className="font-semibold">Cancellation reason:</span> {detail.cancellationReason}
              </p>
            )}
          </div>

          {detail.payment?.status === 'REFUND_PENDING' && (
            <div className="mt-6 space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
              {detail.payment?.refundRequestStatus === 'APPROVED' && !detail.payment?.refundId && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-primary">Approved Refund Awaiting Recovery</p>
                    <p className="text-xs text-muted-foreground">
                      This refund was approved but paused before provider creation. Safe recovery verifies payment state, acquires an atomic claim, and executes without duplicating.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={recovering || reconciling}
                    onClick={() => setActionModal({ isOpen: true, type: 'recover' })}
                  >
                    {recovering && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    {recovering ? 'Recovering refund…' : 'Recover Refund'}
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex-1">
                  <p className="text-xs font-semibold text-foreground">Authoritative Provider Status Check</p>
                  <p className="text-xs text-muted-foreground">
                    Verifies Razorpay refund state without issuing another transaction.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reconciling || recovering}
                  onClick={() => setActionModal({ isOpen: true, type: 'reconcile' })}
                >
                  {reconciling && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  {reconciling ? 'Checking provider…' : 'Reconcile Refund'}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Confirmation Modal for Refund Recovery / Reconciliation */}
      <Modal
        isOpen={actionModal.isOpen}
        onClose={() => setActionModal((prev) => ({ ...prev, isOpen: false }))}
        title={actionModal.type === 'recover' ? 'Recover Approved Refund' : 'Reconcile Refund Status'}
        description={
          actionModal.type === 'recover'
            ? 'Safe recovery will inspect provider records and execute an idempotent atomic claim. This will not duplicate refunds.'
            : 'Check authoritative provider status for this booking? This inspects Razorpay and reconciles local ticket inventory without creating a new payment or refund.'
        }
        confirmLabel={actionModal.type === 'recover' ? 'Proceed with Recovery' : 'Reconcile Status'}
        onConfirm={actionModal.type === 'recover' ? handleRecover : handleReconcile}
        isLoading={recovering || reconciling}
      />
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
    <div className="mt-8 space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search details or user email"
            aria-label="Search audit logs"
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <select
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by entity"
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
        >
          <option value="">All entities</option>
          <option value="USER">User</option>
          <option value="EVENT">Event</option>
          <option value="ORGANIZER">Organizer</option>
          <option value="BOOKING">Booking</option>
        </select>
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by action"
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
        >
          <option value="">All actions</option>
          <option value="USER_ACTIVATED">USER_ACTIVATED</option>
          <option value="USER_DEACTIVATED">USER_DEACTIVATED</option>
          <option value="ORGANIZER_APPLICATION_SUBMITTED">ORGANIZER_APPLICATION_SUBMITTED</option>
          <option value="ORGANIZER_APPLICATION_APPROVED">ORGANIZER_APPLICATION_APPROVED</option>
          <option value="ORGANIZER_APPLICATION_REJECTED">ORGANIZER_APPLICATION_REJECTED</option>
          <option value="EVENT_CANCELLED_BY_ADMIN">EVENT_CANCELLED_BY_ADMIN</option>
        </select>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Timestamp</th>
              <th className="px-4 py-3 font-semibold">Action</th>
              <th className="px-4 py-3 font-semibold">Entity</th>
              <th className="px-4 py-3 font-semibold">Performed By</th>
              <th className="px-4 py-3 font-semibold">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y font-mono text-xs">
            {(logs ?? []).map((log) => (
              <tr key={log.id} className="transition-colors hover:bg-muted/30">
                <td className="px-4 py-3 font-sans text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-semibold text-foreground">{log.action}</td>
                <td className="px-4 py-3">
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-secondary-foreground">
                    {log.entity}
                  </span>
                  {log.entityId && <span className="ml-1 text-muted-foreground">({log.entityId.slice(0, 8)})</span>}
                </td>
                <td className="px-4 py-3 font-sans text-xs">
                  {log.user ? `${log.user.firstName} ${log.user.lastName} (${log.user.email})` : 'System'}
                </td>
                <td className="px-4 py-3 max-w-xs truncate text-muted-foreground">
                  {log.details ? JSON.stringify(log.details) : '—'}
                </td>
              </tr>
            ))}
            {!loading && (logs ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center font-sans text-muted-foreground">
                  No audit logs found matching your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm pt-2">
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
