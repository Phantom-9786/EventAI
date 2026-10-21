'use client';
import Link from 'next/link';
import { EventImage } from './event-image';
import { useState } from 'react';
import { ArrowRight, CalendarDays, Ticket, Users, Briefcase } from 'lucide-react';
import type {
  OrganizerEventRow,
  OrganizerProfile,
  OrganizerStats,
} from '@/lib/organizer';
import { formatEventDate, formatPrice } from '@/lib/api';
import { PreviewHeading, PreviewPanel, PreviewStat, PreviewBadge } from './ui';
import type { ReactNode } from 'react';
import { DashboardChart } from './dashboard-chart';
export function OrganizerOverview({
  stats,
  events,
  profile: _profile,
  settings,
  error,
}: {
  stats: OrganizerStats | null;
  events: OrganizerEventRow[];
  profile: OrganizerProfile;
  settings: ReactNode;
  error?: string | null;
}) {
  const [query, setQuery] = useState('');
  const month = new Date();
  month.setDate(1);
  const months = Array.from(
    { length: 6 },
    (_, i) => new Date(month.getFullYear(), month.getMonth() + i, 1),
  );
  const values = months.map(
    (m) =>
      events.filter((e) => {
        const d = new Date(e.startDate);
        return d.getMonth() === m.getMonth() && d.getFullYear() === m.getFullYear();
      }).length,
  );
  const groups = new Map<string, number>();
  events.forEach((e) =>
    groups.set(
      e.category?.name || 'Other',
      (groups.get(e.category?.name || 'Other') || 0) + 1,
    ),
  );
  return (
    <>
      <PreviewHeading
        eyebrow="Organizer workspace"
        title="Bring good people together."
        sub="Your events, your community, and what comes next."
        action={
          <Link href="/organizer/events/new" className="btn">
            Create event
            <ArrowRight className="icon" />
          </Link>
        }
      />
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <div className="stats">
        <PreviewStat
          label="Your events"
          note="All your events"
          value={String(stats?.events.total ?? events.length)}
          href="/organizer/events"
          icon={<CalendarDays className="icon" />}
        />
        <PreviewStat
          label="Confirmed bookings"
          note="Confirmed reservations"
          value={String(stats?.confirmedBookings ?? 0)}
          href="/organizer/attendees"
          icon={<Users className="icon" />}
        />
        <PreviewStat
          label="Revenue"
          note="Before platform fees"
          value={formatPrice(stats?.revenue ?? 0)}
          href="/organizer/analytics"
          icon={<Ticket className="icon" />}
        />
        <PreviewStat
          label="Checked in"
          note="Validated tickets"
          value={String(stats?.checkedIn ?? 0)}
          href="/dashboard/scan"
          icon={<Briefcase className="icon" />}
        />
      </div>
      <div className="ep-analytics-entry">
        <div>
          <span className="small-label">Performance at a glance</span>
          <h2>Understand your events.</h2>
        </div>
        <Link className="btn outline" href="/organizer/analytics">
          View analytics <ArrowRight className="icon" />
        </Link>
      </div>
      <div className="workspace-grid ep-dashboard-charts">
        <PreviewPanel title="Events scheduled by month">
          <DashboardChart
            data={months.map((month, i) => ({
              label: month.toLocaleDateString('en-IN', { month: 'short' }),
              detailLabel: month.toLocaleDateString('en-IN', {
                month: 'long',
                year: 'numeric',
              }),
              value: values[i],
            }))}
            label="Your scheduled event counts for the next six months"
            xLabel="Event start month"
            note={
              'Current month and next five months · based on your latest ' +
              events.length +
              ' events, across all statuses.'
            }
          />
        </PreviewPanel>
        <PreviewPanel title="Your events by category">
          <DashboardChart
            horizontal
            data={Array.from(groups)
              .sort((a, b) => b[1] - a[1])
              .map(([label, value]) => ({ label, value }))}
            label="Category distribution of your events"
            xLabel="Category"
            note={
              'Counts and share of your latest ' +
              events.length +
              ' events, across all statuses.'
            }
          />
        </PreviewPanel>
      </div>
      <section className="section">
        <PreviewPanel title="Your recent events">
          <div className="toolbar">
            <input
              type="search"
              aria-label="Search recent events"
              placeholder="Search this table…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Link href="/organizer/events" className="text-link">
              Manage Events <ArrowRight className="icon" />
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {['Event', 'Status', 'Date', 'Actions'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events
                  .filter((e) => e.title.toLowerCase().includes(query.toLowerCase()))
                  .slice(0, 4)
                  .map((e) => (
                    <tr key={e.id}>
                      <td>
                        <EventImage
                          className="row-thumb"
                          src={e.coverImage || e.images?.[0]}
                          fallbacks={e.images}
                          alt=""
                        />
                        <strong>{e.title}</strong>
                        <div className="sub">{e.venue?.city}</div>
                      </td>
                      <td>
                        <PreviewBadge status={e.status} />
                      </td>
                      <td>{formatEventDate(e.startDate)}</td>
                      <td>
                        <Link
                          className="btn outline small"
                          href={'/organizer/events/' + e.id}
                        >
                          Manage <ArrowRight className="icon" />
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!events.length && (
              <div className="empty">
                <p>No events yet.</p>
                <Link href="/organizer/events/new" className="btn">
                  Create your first event
                </Link>
              </div>
            )}
          </div>
        </PreviewPanel>
      </section>
      <details className="ep-organizer-settings">
        <summary>Organizer profile settings</summary>
        {settings}
      </details>
    </>
  );
}
