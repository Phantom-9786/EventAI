'use client';
import { ArrowRight, Users, CalendarDays, Ticket, Briefcase } from 'lucide-react';
import type { AdminStats, AdminCategory } from '@/lib/admin';
import { formatPrice } from '@/lib/api';
import { PreviewPanel, PreviewStat } from './ui';
import { DashboardChart } from './dashboard-chart';
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
        <PreviewPanel title="Events by status">
          <DashboardChart
            data={['Draft', 'Published', 'Cancelled', 'Completed', 'Sold out'].map(
              (label, i) => ({ label, value: values[i] }),
            )}
            label="Platform event counts by current status"
            xLabel="Current event status"
            note="Current platform snapshot · each event is counted once by its current status."
          />
        </PreviewPanel>
        <PreviewPanel title="Published events by category">
          <DashboardChart
            horizontal
            data={[...categories]
              .sort((a, b) => b.eventCount - a.eventCount)
              .map((c) => ({ label: c.name, value: c.eventCount }))}
            label="Published event counts across all available categories"
            xLabel="Category"
            note="Published events in active categories, ranked by count. Percentages show each category’s share of this total."
          />
        </PreviewPanel>
      </div>
      <section className="section">
        <PreviewPanel title="Platform totals">
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
