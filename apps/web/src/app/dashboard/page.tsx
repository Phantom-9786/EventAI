'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarDays, CheckCircle2, IndianRupee, Loader2, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import { becomeOrganizer, leaveOrganizerProfile, useOrganizerDashboard } from '@/lib/organizer';
import { formatEventDate, formatPrice } from '@/lib/api';

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  PUBLISHED: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  COMPLETED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  SOLDOUT: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
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

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const { stats, events, profile, error, loading } = useOrganizerDashboard(!!user);
  const [orgName, setOrgName] = useState('');
  const [orgPhone, setOrgPhone] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

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
        <h1 className="text-xl font-semibold">Sign in to view your dashboard</h1>
        <Link href="/signin" className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Sign In
        </Link>
      </div>
    );
  }

  if (loading && !stats) {
    return (
      <div className="container flex flex-col items-center gap-3 py-24 text-muted-foreground" role="status">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
        <p className="text-sm">Loading organizer dashboard…</p>
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div className="container max-w-md py-16 text-center">
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6">
          <h2 className="text-lg font-semibold text-destructive">Unable to load Organizer Hub</h2>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <div className="mt-4 flex justify-center gap-3">
            <Button onClick={() => window.location.reload()} variant="outline" size="sm">
              Retry
            </Button>
            <Link href="/" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent">
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    // Not an organizer yet — inline onboarding
    return (
      <div className="container max-w-md py-16">
        <h1 className="text-2xl font-bold tracking-tight">Become an organizer</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create events, sell tickets, and check in attendees with the door scanner.
        </p>
        <form
          className="mt-6 flex flex-col gap-4 rounded-lg border bg-card p-6 shadow-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            setJoinError(null);
            setJoining(true);
            try {
              await becomeOrganizer({ organizationName: orgName, phone: orgPhone || undefined });
              window.location.reload();
            } catch (err) {
              setJoinError(err instanceof Error ? err.message : 'Failed to create profile');
            } finally {
              setJoining(false);
            }
          }}
        >
          {joinError && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {joinError}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="orgName" className="text-sm font-medium">Organization name</label>
            <input
              id="orgName"
              required
              minLength={2}
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Acme Events Pvt Ltd"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="orgPhone" className="text-sm font-medium">Organizer contact phone (optional)</label>
            <input
              id="orgPhone"
              type="tel"
              maxLength={20}
              value={orgPhone}
              onChange={(e) => setOrgPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Button type="submit" disabled={joining}>
            {joining && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Create organizer profile
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="container py-10">
      <h1 className="text-3xl font-bold tracking-tight">{profile.organizationName}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Organizer dashboard</p>
      {profile.phone && <p className="mt-1 text-sm text-muted-foreground">Organizer contact: {profile.phone}</p>}
      {profile.isVerified && profile.applicationStatus === 'APPROVED' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/organizer/events" className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent">Manage events</Link>
          <Link href="/organizer/events/new" className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">Create event</Link>
        </div>
      )}

      {profile.applicationStatus === 'PENDING' && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300" role="status">
          <p className="font-semibold">Organizer Application Under Review</p>
          <p className="mt-1">
            Your application is awaiting administrator verification. You will be able to create and publish events once your profile is approved.
          </p>
        </div>
      )}

      {profile.applicationStatus === 'REJECTED' && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
          <p className="font-semibold">Organizer Application Rejected</p>
          <p className="mt-1">Reason: {profile.rejectionReason ?? 'Application was not approved by administration.'}</p>
          <p className="mt-2 text-xs text-muted-foreground">You can submit updated details below to reapply for administrator review.</p>
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setJoinError(null);
              setJoining(true);
              try {
                await becomeOrganizer({ organizationName: orgName || profile.organizationName, phone: orgPhone || profile.phone || undefined });
                window.location.reload();
              } catch (err) {
                setJoinError(err instanceof Error ? err.message : 'Reapplication failed');
              } finally {
                setJoining(false);
              }
            }}
          >
            <input
              required
              minLength={2}
              defaultValue={profile.organizationName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Organization name"
              aria-label="Updated organization name"
              className="h-9 w-60 rounded-md border border-input bg-background px-3 text-xs"
            />
            <input
              type="tel"
              defaultValue={profile.phone ?? ''}
              onChange={(e) => setOrgPhone(e.target.value)}
              placeholder="Contact phone"
              aria-label="Updated contact phone"
              className="h-9 w-40 rounded-md border border-input bg-background px-3 text-xs"
            />
            <Button size="sm" type="submit" disabled={joining}>
              {joining ? 'Submitting…' : 'Reapply for review'}
            </Button>
          </form>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <section className="mt-10 rounded-lg border p-5">
        <h2 className="font-semibold">Organizer profile</h2>
        {profile._count.events === 0 && profile._count.venues === 0 ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">This profile has no events or venues and can be removed without affecting event records.</p>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              disabled={leaving}
              onClick={async () => {
                if (!window.confirm('Remove this empty organizer profile and return to a customer account?')) return;
                setLeaving(true);
                try {
                  await leaveOrganizerProfile();
                  window.location.reload();
                } catch (err) {
                  setJoinError(err instanceof Error ? err.message : 'Could not remove organizer profile.');
                  setLeaving(false);
                }
              }}
            >
              {leaving ? 'Removing…' : 'Leave organizer account'}
            </Button>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">This profile has {profile._count.events} event(s) and {profile._count.venues} venue(s). Organizer access cannot be removed while those records exist.</p>
        )}
        {joinError && <p role="alert" className="mt-3 text-sm text-destructive">{joinError}</p>}
      </section>

      {profile.isVerified && profile.applicationStatus === 'APPROVED' && (
        <>
          {stats && (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Revenue (confirmed)" value={formatPrice(stats.revenue)} icon={<IndianRupee className="h-3.5 w-3.5" />} />
              <StatCard label="Confirmed bookings" value={String(stats.confirmedBookings)} icon={<CalendarDays className="h-3.5 w-3.5" />} />
              <StatCard label="Tickets issued" value={String(stats.ticketsIssued)} icon={<Ticket className="h-3.5 w-3.5" />} />
              <StatCard label="Checked in" value={`${stats.checkedIn}/${stats.ticketsIssued}`} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
            </div>
          )}

          <h2 className="mt-10 text-xl font-semibold">Your events</h2>
          {!events || events.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No events yet — create your first event to start selling.
            </p>
          ) : (
            <div className="mt-3 divide-y rounded-lg border">
              {events.map((event) => (
                <div key={event.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{event.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {event.category.name} · {event.venue.name}, {event.venue.city} ·{' '}
                      {formatEventDate(event.startDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[event.status] ?? 'bg-muted text-muted-foreground'}`}
                    >
                      {event.status}
                    </span>
                    <Link
                      href={`/dashboard/scan?event=${event.id}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Door scan
                    </Link>
                    <Link href={`/organizer/events/${encodeURIComponent(event.id)}`} className="text-sm font-medium text-primary hover:underline">Manage</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
