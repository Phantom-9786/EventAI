'use client';
import { RefreshButton } from '@/components/ui/refresh-button';
import { useEffect, useState } from 'react';
import Link from '@/components/ui/app-link';
import { OrganizerGate } from '@/components/organizer/organizer-gate';
import { getOrganizerStats, type OrganizerStats } from '@/lib/organizer';
import { formatPrice } from '@/lib/api';
function OrganizerAnalytics() {
  const [stats, setStats] = useState<OrganizerStats | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setBusy(true);
    getOrganizerStats()
      .then((data) => {
        if (live) {
          setStats(data);
          setError('');
        }
      })
      .catch(() => {
        if (live) setError('Unable to load analytics. Please retry.');
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [revision]);
  return (
    <div>
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <p className="text-sm text-primary">Organizer workspace</p>
          <h1 className="mt-2 text-3xl font-bold">Your events, in perspective.</h1>
          <p className="mt-3 text-muted-foreground">
            Actual totals across your events. Revenue is shown before platform settlement.
          </p>
        </div>
        <RefreshButton
          variant="outline"
          disabled={busy}
          onClick={() => setRevision((n) => n + 1)}
          refreshing={Boolean(busy)}
        />
      </div>
      {error && (
        <p role="alert" className="mt-6 text-destructive">
          {error}
        </p>
      )}
      {busy && !stats ? (
        <p role="status" className="py-8">
          Loading analytics…
        </p>
      ) : (
        stats && (
          <>
            <div className="my-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Revenue', formatPrice(stats.revenue), '/organizer/events'],
                [
                  'Confirmed bookings',
                  String(stats.confirmedBookings),
                  '/organizer/attendees',
                ],
                ['Tickets issued', String(stats.ticketsIssued), '/organizer/attendees'],
                ['Checked in', String(stats.checkedIn), '/dashboard/scan'],
              ].map(([label, value, href]) => (
                <Link
                  key={label}
                  href={href}
                  className="rounded-2xl border bg-card p-6 hover:border-primary"
                >
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <strong className="mt-3 block text-3xl">{value}</strong>
                  <span className="mt-5 block text-sm text-primary">View details →</span>
                </Link>
              ))}
            </div>
            <section className="rounded-2xl border bg-card p-6">
              <h2 className="text-xl font-semibold">Event status distribution</h2>
              {Object.entries(stats.events)
                .filter(([name]) => name !== 'total')
                .map(([name, value]) => (
                  <div key={name} className="mt-5">
                    <div className="mb-2 flex justify-between text-sm">
                      <span>{name}</span>
                      <span>{value}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: stats.events.total
                            ? (value / stats.events.total) * 100 + '%'
                            : '0%',
                        }}
                      />
                    </div>
                  </div>
                ))}
              <p className="mt-6 text-sm text-muted-foreground">
                Check-in rate:{' '}
                {stats.ticketsIssued
                  ? Math.round((stats.checkedIn / stats.ticketsIssued) * 100)
                  : 0}
                % · {stats.events.total} events
              </p>
            </section>
          </>
        )
      )}
    </div>
  );
}
export default function Page() {
  return (
    <OrganizerGate>
      <OrganizerAnalytics />
    </OrganizerGate>
  );
}
