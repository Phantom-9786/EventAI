'use client';
import { RefreshButton } from '@/components/ui/refresh-button';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { OrganizerGate } from '@/components/organizer/organizer-gate';
import { Button } from '@/components/ui/button';
import {
  getOrganizerEvents,
  getEventAttendees,
  type OrganizerEventRow,
  type AttendeeBooking,
} from '@/lib/organizer';

function AttendeeRoster() {
  const [events, setEvents] = useState<OrganizerEventRow[]>([]);
  const [eventId, setEventId] = useState('');
  const [rows, setRows] = useState<AttendeeBooking[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    getOrganizerEvents()
      .then((data) => {
        if (live) {
          setEvents(data);
          setEventId(data[0]?.id || '');
        }
      })
      .catch(() => {
        if (live) setError('Unable to load your events.');
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!eventId) return;
    let live = true;
    setBusy(true);
    setError('');
    setRows([]);
    getEventAttendees(eventId, page, 20)
      .then((data) => {
        if (live) {
          setRows(data.bookings);
          setPages(data.pages);
        }
      })
      .catch(() => {
        if (live) setError('Unable to load attendees. Please retry.');
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [eventId, page, refresh]);
  const visible = rows.filter((row) =>
    (row.user.email + ' ' + row.user.firstName + ' ' + row.user.lastName + ' ' + row.id)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const exportCsv = () => {
    const cell = (v: string) =>
      '"' + (/^[=+@\-\t\r]/.test(v) ? "'" : '') + v.replace(/"/g, '""') + '"';
    const csv = [
      ['Booking ID', 'Name', 'Email', 'Status', 'Tickets'],
      ...visible.map((r) => [
        r.id,
        [r.user.firstName, r.user.lastName].filter(Boolean).join(' '),
        r.user.email,
        r.status,
        String(r.tickets.length),
      ]),
    ]
      .map((r) => r.map(cell).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'eventpoint-attendees-page-' + page + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="container py-6">
      <p className="text-sm text-primary">Organizer workspace</p>
      <h1 className="mt-2 text-3xl font-bold">Attendee management</h1>
      <p className="mt-3 text-muted-foreground">
        Bookings and ticket status for your events.
      </p>
      <div className="my-6 flex flex-wrap gap-3">
        <select
          aria-label="Select event"
          value={eventId}
          onChange={(e) => {
            setEventId(e.target.value);
            setPage(1);
          }}
          className="max-w-full rounded-xl border bg-card p-3"
        >
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
        <input
          aria-label="Search this page"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search this page by name, email or booking"
          className="min-w-0 flex-1 rounded-xl border bg-card px-3 py-2"
        />
        <RefreshButton
          variant="outline"
          disabled={busy}
          onClick={() => setRefresh((n) => n + 1)}
          refreshing={Boolean(busy)}
        />
        <Button disabled={busy || !visible.length} onClick={exportCsv}>
          Export this page
        </Button>
      </div>
      {error && (
        <p role="alert" className="py-4 text-destructive">
          {error}
        </p>
      )}
      {busy ? (
        <p role="status">Loading attendees…</p>
      ) : (
        <div className="overflow-auto rounded-2xl border bg-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {['Attendee', 'Booking', 'Tickets', 'Status', 'Check-in'].map((h) => (
                  <th key={h} className="p-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-4">
                    <strong>
                      {[r.user.firstName, r.user.lastName].filter(Boolean).join(' ') ||
                        r.user.email}
                    </strong>
                    <p className="text-muted-foreground">{r.user.email}</p>
                  </td>
                  <td className="p-4">{r.id}</td>
                  <td className="p-4">{r.tickets.length}</td>
                  <td className="p-4">{r.status}</td>
                  <td className="p-4">
                    {r.tickets.filter((t) => t.status === 'USED').length} checked in ·{' '}
                    <Link href="/dashboard/scan" className="text-primary">
                      Validate ticket
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && (
            <p className="p-8 text-muted-foreground">
              {events.length
                ? 'No attendees found on this page.'
                : 'Create an event to start welcoming attendees.'}
            </p>
          )}
        </div>
      )}
      <div className="mt-5 flex items-center gap-4">
        <Button
          variant="outline"
          disabled={page === 1 || busy}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        <span className="text-sm">
          Page {page} of {Math.max(1, pages)}
        </span>
        <Button
          variant="outline"
          disabled={page >= pages || busy}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
export default function AttendeesPage() {
  return (
    <OrganizerGate>
      <AttendeeRoster />
    </OrganizerGate>
  );
}
