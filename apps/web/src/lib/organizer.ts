'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from './auth';

export interface OrganizerStats {
  events: { total: number; DRAFT: number; PUBLISHED: number; CANCELLED: number; COMPLETED: number; SOLDOUT?: number };
  revenue: number;
  confirmedBookings: number;
  refundedBookings: number;
  ticketsIssued: number;
  checkedIn: number;
}

export interface OrganizerEventRow {
  id: string;
  title: string;
  status: string;
  startDate: string;
  venue: { name: string; city: string };
  category: { name: string };
}

export async function getOrganizerStats(): Promise<OrganizerStats> {
  const res = await authFetch('/organizers/me/stats');
  if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
  return res.json();
}

export async function getOrganizerEvents(): Promise<OrganizerEventRow[]> {
  const res = await authFetch('/organizers/me/events?page=1&limit=50');
  if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
  const body = (await res.json()) as { events: OrganizerEventRow[] };
  return body.events;
}

export async function becomeOrganizer(input: {
  organizationName: string;
}): Promise<void> {
  const res = await authFetch('/organizers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(
      Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? `Failed (${res.status})`),
    );
  }
}

export interface TicketStats {
  VALID: number;
  USED: number;
  CANCELLED: number;
  EXPIRED: number;
  total: number;
  checkedIn: number;
}

export interface AttendeeBooking {
  id: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  user: { id: string; firstName: string | null; lastName: string | null; email: string };
  items: { quantity: number; unitPrice: number; ticketType: { id: string; name: string } }[];
  tickets: { id: string; ticketCode: string; status: string; holderName: string; ticketType: { id: string; name: string } }[];
}

export async function getEventTicketStats(eventId: string): Promise<TicketStats> {
  const res = await authFetch(`/organizers/events/${eventId}/tickets/stats`);
  if (!res.ok) throw new Error(`Failed to load ticket stats (${res.status})`);
  return res.json();
}

export async function getEventAttendees(
  eventId: string,
  page = 1,
  limit = 20,
): Promise<{ bookings: AttendeeBooking[]; total: number; page: number; pages: number }> {
  const res = await authFetch(`/organizers/events/${eventId}/bookings?page=${page}&limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to load attendees (${res.status})`);
  return res.json();
}

export interface ValidateResult {
  ticket: {
    id: string;
    ticketCode: string;
    holderName: string;
    status: string;
    validatedAt: string | null;
    ticketType: { id: string; name: string };
  };
  holder: { id: string; firstName: string | null; lastName: string | null; email: string };
}

/** Validates (checks in) a ticket code; throws an Error with the API reason on refusal. */
export async function validateTicketCode(eventId: string, ticketCode: string): Promise<ValidateResult> {
  const res = await authFetch(`/organizers/events/${eventId}/tickets/validate`, {
    method: 'POST',
    body: JSON.stringify({ ticketCode: ticketCode.trim() }),
  });
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (!res.ok) {
    throw new Error(
      Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? `Failed (${res.status})`),
    );
  }
  return body as unknown as ValidateResult;
}

/** Returns the organizer profile or null when the user has none yet. */
export async function getOrganizerProfile(): Promise<{ id: string; organizationName: string } | null> {
  const res = await authFetch('/organizers/me');
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load profile (${res.status})`);
  const body = (await res.json()) as { organizer: { id: string; organizationName: string } };
  return body.organizer;
}

export function useOrganizerDashboard(enabled: boolean) {
  const [stats, setStats] = useState<OrganizerStats | null>(null);
  const [events, setEvents] = useState<OrganizerEventRow[] | null>(null);
  const [profile, setProfile] = useState<{ id: string; organizationName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const prof = await getOrganizerProfile();
      setProfile(prof);
      if (prof) {
        const [s, e] = await Promise.all([getOrganizerStats(), getOrganizerEvents()]);
        setStats(s);
        setEvents(e);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  return { stats, events, profile, error, loading, reload: load };
}
