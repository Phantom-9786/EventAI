'use client';
import { ArrowRight, Users, CalendarDays, Ticket, Briefcase } from 'lucide-react';
import type { AdminStats, AdminCategory } from '@/lib/admin';
import { formatPrice } from '@/lib/api';
import { PreviewPanel, PreviewStat } from './ui';
import { PreviewTrend } from './organizer-overview';
export function AdminOverview({
  stats,
  categories,
  onSelect,
}: {
  stats: AdminStats;
  categories: AdminCategory[];
  onSelect: (tab: 'users' | 'events' | 'bookings') => void;
}) {
  const states = ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED', 'SOLDOUT'] as const;
  const values = states.map((s) => stats.events[s] ?? 0);
  const total = categories.reduce((n, c) => n + c.eventCount, 0);
  return (
    <>
      <div className="stats">
        <PreviewStat
          label="Total users"
          onClick={(e) => {
            e.preventDefault();
            onSelect('users');
          }}
          value={String(stats.users)}
          href="/admin?tab=users"
          icon={<Users className="icon" />}
        />
        <PreviewStat
          label="Published events"
          onClick={(e) => {
            e.preventDefault();
            onSelect('events');
          }}
          value={String(stats.events.PUBLISHED ?? stats.events.total)}
          href="/admin?tab=events"
          icon={<CalendarDays className="icon" />}
        />
        <PreviewStat
          label="Bookings"
          onClick={(e) => {
            e.preventDefault();
            onSelect('bookings');
          }}
          value={String(Object.values(stats.bookings).reduce((a, b) => a + b, 0))}
          href="/admin?tab=bookings"
          icon={<Ticket className="icon" />}
        />
        <PreviewStat
          label="Gross revenue"
          onClick={(e) => {
            e.preventDefault();
            onSelect('bookings');
          }}
          value={formatPrice(stats.revenue.gross ?? stats.revenue.net)}
          href="/admin?tab=bookings"
          icon={<Briefcase className="icon" />}
        />
      </div>
      <div className="workspace-grid">
        <PreviewPanel title="Activity over time">
          <PreviewTrend
            values={values}
            labels={['Draft', 'Published', 'Cancelled', 'Completed', 'Sold out']}
            label="Actual event totals by status"
          />
          <p className="ep-health-note">Current event status distribution.</p>
        </PreviewPanel>
        <PreviewPanel title="Event categories">
          <div className="bar-list">
            {categories.slice(0, 5).map((c) => (
              <div key={c.id}>
                <div className="bar-label">
                  <span>{c.name}</span>
                  <span>{total ? Math.round((c.eventCount / total) * 100) : 0}%</span>
                </div>
                <div className="bar-track">
                  <span
                    style={{ width: total ? (c.eventCount / total) * 100 + '%' : '0%' }}
                  />
                </div>
              </div>
            ))}
          </div>
          {!categories.length && (
            <p className="help">Event categories will appear here as they are created.</p>
          )}
        </PreviewPanel>
      </div>
      <section className="section">
        <PreviewPanel title="Recent platform activity">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Platform records</th>
                  <th>Total</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Users', stats.users, 'users'],
                  ['Events', stats.events.total, 'events'],
                  ['Confirmed bookings', stats.bookings.CONFIRMED ?? 0, 'bookings'],
                ].map(([label, count, tab]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>{count}</td>
                    <td>
                      <button
                        className="btn outline small"
                        onClick={() => onSelect(tab as 'users' | 'events' | 'bookings')}
                      >
                        View details
                        <ArrowRight className="icon" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PreviewPanel>
      </section>
    </>
  );
}
