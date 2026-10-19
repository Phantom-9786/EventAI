'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  IndianRupee,
  Loader2,
  Plus,
  RotateCcw,
  ScanLine,
  Ticket,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useAuth } from '@/components/auth/auth-provider';
import { becomeOrganizer, leaveOrganizerProfile, useOrganizerDashboard } from '@/lib/organizer';
import { formatEventDate, formatPrice } from '@/lib/api';
import { cn } from '@/lib/utils';
import { OrganizerOverview } from '@/components/approved/organizer-overview';

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground border-border',
  PUBLISHED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  CANCELLED: 'bg-destructive/10 text-destructive border-destructive/20',
  COMPLETED: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  SOLDOUT: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
};

function StatCard({
  label,
  value,
  subtext,
  icon,
}: {
  label: string;
  value: string;
  subtext?: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={label.toLowerCase().includes('revenue') ? '/organizer/analytics' : label.toLowerCase().includes('booking') || label.toLowerCase().includes('issued') ? '/organizer/attendees' : '/dashboard/scan'} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary relative overflow-hidden rounded-2xl border border-border/80 bg-card/80 p-5 shadow-sm backdrop-blur-sm transition-all hover:border-primary/40 hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {icon}
          {label}
        </p>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{value}</p>
      {subtext && <p className="mt-1 text-xs text-muted-foreground">{subtext}</p>}
    </Link>
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
      <div className="container flex flex-col items-center justify-center gap-3 py-32 text-muted-foreground" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm font-medium">Checking credentials…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container flex max-w-md flex-col items-center py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Building2 className="h-8 w-8" />
        </div>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Sign in to your Organizer Hub</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Access your sales analytics, ticket inventory, and door admission scanner.
        </p>
        <Link href="/signin?returnUrl=/dashboard" className={cn(buttonVariants({ size: 'lg' }), 'mt-6 w-full')}>
          Sign In
        </Link>
      </div>
    );
  }

  if (loading && !stats) {
    return (
      <div className="container flex flex-col items-center justify-center gap-3 py-32 text-muted-foreground" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm font-medium">Loading Organizer Hub…</p>
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div className="container max-w-md py-16 text-center">
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6">
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
    // Inline onboarding for prospective organizers
    return (
      <div className="container max-w-md py-16">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-4">
          <Building2 className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Become an event organizer</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Host concerts, festivals, or private workshops with real-time ticket sales and door check-in.
        </p>
        <form
          className="mt-6 flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-6 shadow-sm"
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
            <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {joinError}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="orgName" className="text-sm font-medium">Organization or Host name</label>
            <input
              id="orgName"
              required
              minLength={2}
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="e.g. Apex Music Collective"
              className="h-10 rounded-xl border border-border/80 bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
              className="h-10 rounded-xl border border-border/80 bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <Button type="submit" disabled={joining} className="mt-2 font-semibold">
            {joining && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Register Organizer Account
          </Button>
        </form>
      </div>
    );
  }

  if (profile.isVerified && profile.applicationStatus === 'APPROVED') return <OrganizerOverview stats={stats} events={events??[]} profile={profile} error={error} settings={<>
      <section className="mt-10 rounded-2xl border border-border/80 bg-card/60 p-5 backdrop-blur-sm">
        <h2 className="text-sm font-semibold text-foreground">Organizer Profile Configuration</h2>
        {profile._count.events === 0 && profile._count.venues === 0 ? (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              This profile has no active events or venues and can be removed to return to a standard customer account.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 text-xs text-destructive hover:bg-destructive/10"
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
          <p className="mt-1 text-xs text-muted-foreground">
            This profile has {profile._count.events} event(s) and {profile._count.venues} venue(s). Active records are securely maintained in accordance with auditing regulations.
          </p>
        )}
        {joinError && <p role="alert" className="mt-3 text-xs text-destructive">{joinError}</p>}
      </section></>}/>;

  const checkInRate =
    stats && stats.ticketsIssued > 0
      ? Math.round((stats.checkedIn / stats.ticketsIssued) * 100)
      : 0;

  return (
    <div className="container py-8 sm:py-10 max-w-6xl">
      {/* Header Hub Card */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card p-6 shadow-sm backdrop-blur-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  {profile.organizationName}
                </h1>
                {profile.isVerified && profile.applicationStatus === 'APPROVED' && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    <BadgeCheck className="h-3.5 w-3.5" /> Verified Organizer
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Organizer Dashboard · {events?.length ?? 0} total events hosted
                {profile.phone && ` · Contact: ${profile.phone}`}
              </p>
            </div>
          </div>

          {profile.isVerified && profile.applicationStatus === 'APPROVED' && (
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/organizer/events/new"
                className={cn(buttonVariants({ size: 'sm' }), 'gap-1.5 font-semibold shadow-sm')}
              >
                <Plus className="h-4 w-4" /> Create Event
              </Link>
              <Link
                href="/organizer/events"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
              >
                Manage Events
              </Link>
              <Link
                href="/dashboard/scan"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
              >
                <ScanLine className="h-3.5 w-3.5 text-primary" /> Door Scanner
              </Link>
            </div>
          )}
        </div>
      </div>

      {profile.applicationStatus === 'PENDING' && (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-800 dark:text-amber-300" role="status">
          <p className="font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4" /> Organizer Application Under Review
          </p>
          <p className="mt-1 text-xs opacity-90">
            Your verification request is currently being reviewed by platform administrators. You will be able to publish live events once approved.
          </p>
        </div>
      )}

      {profile.applicationStatus === 'REJECTED' && (
        <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive" role="alert">
          <p className="font-semibold">Organizer Application Rejected</p>
          <p className="mt-1 text-xs">Reason: {profile.rejectionReason ?? 'Application was not approved by administration.'}</p>
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
              className="h-9 w-60 rounded-lg border border-border/80 bg-background px-3 text-xs"
            />
            <input
              type="tel"
              defaultValue={profile.phone ?? ''}
              onChange={(e) => setOrgPhone(e.target.value)}
              placeholder="Contact phone"
              aria-label="Updated contact phone"
              className="h-9 w-40 rounded-lg border border-border/80 bg-background px-3 text-xs"
            />
            <Button size="sm" type="submit" disabled={joining}>
              {joining ? 'Submitting…' : 'Reapply for review'}
            </Button>
          </form>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {profile.isVerified && profile.applicationStatus === 'APPROVED' && (
        <>
          {/* KPI Analytics Strip */}
          {stats && (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Confirmed Revenue"
                value={formatPrice(stats.revenue)}
                subtext="Gross settlement before platform fees"
                icon={<IndianRupee className="h-4 w-4 text-emerald-500" />}
              />
              <StatCard
                label="Bookings"
                value={String(stats.confirmedBookings)}
                subtext="Completed checkout transactions"
                icon={<CalendarDays className="h-4 w-4 text-primary" />}
              />
              <StatCard
                label="Tickets Issued"
                value={String(stats.ticketsIssued)}
                subtext="Valid QR admission passes generated"
                icon={<Ticket className="h-4 w-4 text-indigo-500" />}
              />
              <StatCard
                label="Check-in Attendance"
                value={`${stats.checkedIn} / ${stats.ticketsIssued}`}
                subtext={`${checkInRate}% admitted via door scanner`}
                icon={<CheckCircle2 className="h-4 w-4 text-teal-500" />}
              />
            </div>
          )}

          {/* Quick Action Navigation Tiles */}
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Link
              href="/dashboard/scan"
              className="group flex items-center justify-between rounded-2xl border border-border/80 bg-card/60 p-4 shadow-sm backdrop-blur-sm transition-all hover:border-primary/50 hover:bg-card hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ScanLine className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    Door Scanner
                  </h3>
                  <p className="text-xs text-muted-foreground">Scan tickets at venue gate</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/60 transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>

            <Link
              href="/organizer/events/new"
              className="group flex items-center justify-between rounded-2xl border border-border/80 bg-card/60 p-4 shadow-sm backdrop-blur-sm transition-all hover:border-primary/50 hover:bg-card hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                  <Plus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    Publish New Event
                  </h3>
                  <p className="text-xs text-muted-foreground">Set dates, tiers & seating</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/60 transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>

            <Link
              href="/organizer/events"
              className="group flex items-center justify-between rounded-2xl border border-border/80 bg-card/60 p-4 shadow-sm backdrop-blur-sm transition-all hover:border-primary/50 hover:bg-card hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
                  <RotateCcw className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    Manage Inventory
                  </h3>
                  <p className="text-xs text-muted-foreground">Rosters, pricing & refunds</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/60 transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
          </div>

          {/* Your Events Roster Section */}
          <div className="mt-10">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-foreground">Your Events</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Live inventory, status, and door admission links.
                </p>
              </div>
              <Link
                href="/organizer/events/new"
                className="text-xs font-semibold text-primary hover:underline"
              >
                + New Event
              </Link>
            </div>

            {!events || events.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-border/80 p-10 text-center bg-card/40">
                <CalendarDays className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-3 text-base font-semibold">No events yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Create your first event to start ticketing and checking in guests.
                </p>
                <Link
                  href="/organizer/events/new"
                  className={cn(buttonVariants({ size: 'sm' }), 'mt-4 font-semibold')}
                >
                  Create Event
                </Link>
              </div>
            ) : (
              <div className="mt-4 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm divide-y divide-border/80">
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between transition-colors hover:bg-muted/30"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/events/${event.slug}`}
                          className="font-semibold text-foreground hover:text-primary transition-colors line-clamp-1"
                        >
                          {event.title}
                        </Link>
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                            STATUS_STYLES[event.status] ?? 'bg-muted text-muted-foreground',
                          )}
                        >
                          {event.status}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {event.category.name} · {event.venue.name}, {event.venue.city} ·{' '}
                        {formatEventDate(event.startDate)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      <Link
                        href={`/dashboard/scan?event=${event.id}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                      >
                        <ScanLine className="h-3.5 w-3.5 text-primary" /> Door Scan
                      </Link>
                      <Link
                        href={`/organizer/events/${encodeURIComponent(event.id)}`}
                        className="inline-flex h-8 items-center rounded-lg border border-border/80 bg-background px-3 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                      >
                        Manage
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Profile Management Box */}
      <section className="mt-10 rounded-2xl border border-border/80 bg-card/60 p-5 backdrop-blur-sm">
        <h2 className="text-sm font-semibold text-foreground">Organizer Profile Configuration</h2>
        {profile._count.events === 0 && profile._count.venues === 0 ? (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              This profile has no active events or venues and can be removed to return to a standard customer account.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 text-xs text-destructive hover:bg-destructive/10"
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
          <p className="mt-1 text-xs text-muted-foreground">
            This profile has {profile._count.events} event(s) and {profile._count.venues} venue(s). Active records are securely maintained in accordance with auditing regulations.
          </p>
        )}
        {joinError && <p role="alert" className="mt-3 text-xs text-destructive">{joinError}</p>}
      </section>
    </div>
  );
}
