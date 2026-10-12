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
  slug: string;
  title: string;
  status: string;
  startDate: string;
  venue: { id: string; name: string; city: string };
  category: { id: string; name: string; slug: string };
}

export interface OrganizerEventDetail extends OrganizerEventRow {
  description: string;
  shortDescription: string | null;
  categoryId: string;
  venueId: string;
  endDate: string;
  tags: string[];
  policies: string | null;
  cancellationPolicy: string | null;
  coverImage: string | null;
  images: string[];
  category: { id: string; name: string; slug: string; icon?: string | null; color?: string | null };
  venue: { id: string; name: string; address: string; city: string; state: string };
  ticketTypes: OrganizerTicketType[];
}

export interface OrganizerTicketType {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  totalQuantity: number;
  availableQuantity: number;
  maxPerBooking: number;
  saleStartDate: string | null;
  saleEndDate: string | null;
  isActive: boolean;
  section: { id: string; name: string } | null;
}

export interface OrganizerCategory {
  id: string;
  name: string;
  slug: string;
}

export interface OrganizerVenue {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface OrganizerVenueInput {
  name: string;
  description?: string;
  address: string;
  city: string;
  state: string;
  capacity: number;
  latitude?: number;
  longitude?: number;
}

export interface OrganizerEventInput {
  title: string;
  description: string;
  shortDescription?: string;
  categoryId: string;
  venueId: string;
  startDate: string;
  endDate: string;
  tags?: string[];
  policies?: string;
  cancellationPolicy?: string;
  coverImage?: string | null;
  images?: string[];
}

export interface CancelledOrganizerEvent {
  event: OrganizerEventDetail;
  refundRequestsQueued: number;
  bookingsCancelled: number;
}

export interface OrganizerTicketTypeInput {
  name: string;
  description?: string;
  price: number;
  totalQuantity: number;
  maxPerBooking: number;
  saleStartDate?: string;
  saleEndDate?: string;
}

async function readApiError(res: Response, fallback: string): Promise<Error> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (typeof body.message === 'string') return new Error(body.message);
    if (Array.isArray(body.message)) return new Error(body.message.join(', '));
  } catch {
    // Use the fallback when the response has no JSON error body.
  }
  return new Error(`${fallback} (${res.status})`);
}

export async function getOrganizerStats(): Promise<OrganizerStats> {
  const res = await authFetch('/organizers/me/stats');
  if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
  return res.json();
}

export async function getOrganizerEvents(): Promise<OrganizerEventRow[]> {
  const body = await listOrganizerEventPage(1, 50);
  return body.events;
}

export async function listOrganizerEventPage(
  page = 1,
  limit = 20,
): Promise<{ events: OrganizerEventRow[]; total: number; page: number; pages: number }> {
  const res = await authFetch(`/organizers/me/events?page=${page}&limit=${limit}`);
  if (!res.ok) throw await readApiError(res, 'Failed to load events');
  return res.json();
}

export async function getOrganizerCategories(): Promise<OrganizerCategory[]> {
  const res = await authFetch('/categories');
  if (!res.ok) throw await readApiError(res, 'Failed to load categories');
  const body = (await res.json()) as { categories: OrganizerCategory[] };
  return body.categories;
}

export async function getOrganizerVenues(): Promise<OrganizerVenue[]> {
  const res = await authFetch('/organizers/venues');
  if (!res.ok) throw await readApiError(res, 'Failed to load your venues');
  const body = (await res.json()) as { venues: OrganizerVenue[] };
  return body.venues;
}

export async function createOrganizerVenue(input: OrganizerVenueInput): Promise<OrganizerVenue> {
  const res = await authFetch('/organizers/venues', { method: 'POST', body: JSON.stringify(input) });
  if (!res.ok) throw await readApiError(res, 'Failed to create venue');
  const body = (await res.json()) as { venue: OrganizerVenue };
  return body.venue;
}

export async function getOrganizerEvent(idOrSlug: string): Promise<OrganizerEventDetail> {
  const res = await authFetch(`/events/${encodeURIComponent(idOrSlug)}/manage`);
  if (!res.ok) throw await readApiError(res, 'Failed to load event');
  const body = (await res.json()) as { event: OrganizerEventDetail };
  return body.event;
}

export async function createOrganizerEvent(input: OrganizerEventInput): Promise<OrganizerEventDetail> {
  const res = await authFetch('/events', { method: 'POST', body: JSON.stringify(input) });
  if (!res.ok) throw await readApiError(res, 'Failed to create event');
  const body = (await res.json()) as { event: OrganizerEventDetail };
  return body.event;
}

export async function updateOrganizerEvent(
  idOrSlug: string,
  input: Partial<OrganizerEventInput>,
): Promise<OrganizerEventDetail> {
  const res = await authFetch(`/events/${encodeURIComponent(idOrSlug)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readApiError(res, 'Failed to save event');
  const body = (await res.json()) as { event: OrganizerEventDetail };
  return body.event;
}

export async function publishOrganizerEvent(idOrSlug: string): Promise<OrganizerEventDetail> {
  const res = await authFetch(`/events/${encodeURIComponent(idOrSlug)}/publish`, { method: 'POST' });
  if (!res.ok) throw await readApiError(res, 'Failed to publish event');
  const body = (await res.json()) as { event: OrganizerEventDetail };
  return body.event;
}

export async function cancelOrganizerEvent(idOrSlug: string): Promise<CancelledOrganizerEvent> {
  const res = await authFetch(`/events/${encodeURIComponent(idOrSlug)}/cancel`, { method: 'POST' });
  if (!res.ok) throw await readApiError(res, 'Failed to cancel event');
  return res.json();
}

export async function createOrganizerTicketType(
  idOrSlug: string,
  input: OrganizerTicketTypeInput,
): Promise<OrganizerTicketType> {
  const res = await authFetch(`/events/${encodeURIComponent(idOrSlug)}/tickets`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readApiError(res, 'Failed to create ticket type');
  const body = (await res.json()) as { ticketType: OrganizerTicketType };
  return body.ticketType;
}

export async function updateOrganizerTicketType(
  id: string,
  input: Partial<OrganizerTicketTypeInput> & { isActive?: boolean },
): Promise<OrganizerTicketType> {
  const res = await authFetch(`/ticket-types/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readApiError(res, 'Failed to update ticket type');
  const body = (await res.json()) as { ticketType: OrganizerTicketType };
  return body.ticketType;
}

export async function deleteOrganizerTicketType(id: string): Promise<void> {
  const res = await authFetch(`/ticket-types/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw await readApiError(res, 'Failed to delete ticket type');
}

export async function becomeOrganizer(input: {
  organizationName: string;
  phone?: string;
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

export interface OrganizerRefundRequest {
  bookingId: string;
  amount: number;
  currency: string;
  refundRequestReason: string | null;
  refundRequestedAt: string | null;
  booking: {
    totalAmount: number;
    createdAt: string;
    user: { id: string; firstName: string | null; lastName: string | null; email: string };
    event: { id: string; title: string; slug: string; startDate: string };
    items: { quantity: number; ticketType: { name: string } }[];
  };
}

export async function getOrganizerRefundRequests(): Promise<OrganizerRefundRequest[]> {
  const res = await authFetch('/organizers/refund-requests');
  if (!res.ok) throw new Error(`Failed to load refund requests (${res.status})`);
  const body = (await res.json()) as { refundRequests: OrganizerRefundRequest[] };
  return body.refundRequests;
}

async function decideOrganizerRefund(
  bookingId: string,
  decision: 'approve' | 'reject',
): Promise<{ bookingId?: string; status?: string; refundStatus?: string }> {
  const res = await authFetch(`/organizers/refund-requests/${bookingId}/${decision}`, {
    method: 'POST',
  });
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] } & {
    bookingId?: string;
    status?: string;
    refundStatus?: string;
  };
  if (!res.ok) {
    throw new Error(
      Array.isArray(body.message)
        ? body.message.join(', ')
        : (body.message ?? `Failed to ${decision} refund request (${res.status})`),
    );
  }
  return body;
}

export function approveOrganizerRefund(bookingId: string) {
  return decideOrganizerRefund(bookingId, 'approve');
}

export function rejectOrganizerRefund(bookingId: string) {
  return decideOrganizerRefund(bookingId, 'reject');
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
export interface OrganizerProfile {
  id: string;
  organizationName: string;
  phone: string | null;
  _count: { events: number; venues: number };
}

export async function getOrganizerProfile(): Promise<OrganizerProfile | null> {
  const res = await authFetch('/organizers/me');
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load profile (${res.status})`);
  const body = (await res.json()) as { organizer: OrganizerProfile };
  return body.organizer;
}

export async function leaveOrganizerProfile(): Promise<void> {
  const res = await authFetch('/organizers/me', { method: 'DELETE' });
  if (!res.ok) throw await readApiError(res, 'Failed to remove organizer profile');
}

export function useOrganizerDashboard(enabled: boolean) {
  const [stats, setStats] = useState<OrganizerStats | null>(null);
  const [events, setEvents] = useState<OrganizerEventRow[] | null>(null);
  const [profile, setProfile] = useState<OrganizerProfile | null>(null);
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
