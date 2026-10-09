'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarDays, IndianRupee, Loader2, Ticket, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import {
  createAdminCategory,
  deactivateAdminCategory,
  useAdminData,
} from '@/lib/admin';
import { formatPrice } from '@/lib/api';

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

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const { stats, categories, error, loading, reload } = useAdminData(user?.role === 'ADMIN');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#8B5CF6');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (authLoading || (loading && !stats)) {
    return (
      <div className="container flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
      <p className="mt-1 text-sm text-muted-foreground">Platform-wide statistics and category management</p>

      {error && (
        <p role="alert" className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {stats && (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      {actionError && (
        <p role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

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
  );
}
