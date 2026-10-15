'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from './auth';

export interface AdminStats {
  users: number;
  organizers: { total: number; verified: number };
  events: { total: number; DRAFT: number; PUBLISHED: number; CANCELLED: number; COMPLETED: number; SOLDOUT: number };
  bookings: Record<string, number>;
  revenue: { gross: number; refunded: number; net: number };
  tickets: { VALID: number; USED: number; CANCELLED: number; EXPIRED: number; issued: number; checkedIn: number };
}

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  eventCount: number;
}

export interface AdminBookingRow {
  id: string;
  status: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
  user: { id: string; email: string; firstName: string; lastName: string };
  event: { id: string; title: string; startDate: string };
  payment: { status: string; amount: number; refundAmount: number | null; updatedAt: string } | null;
}

export interface AdminBookingDetail extends AdminBookingRow {
  updatedAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  items: { quantity: number; unitPrice: number; totalPrice: number; ticketType: { name: string } }[];
  payment: (NonNullable<AdminBookingRow['payment']> & {
    currency: string;
    method: string | null;
    refundId: string | null;
    refundRequestStatus?: string | null;
    refundRequestReason?: string | null;
    refundRequestedAt?: string | null;
    failureReason: string | null;
    createdAt: string;
  }) | null;
  ticketCounts: Record<string, number>;
}

export async function listAdminBookings(params: { search?: string; status?: string; page?: number; signal?: AbortSignal } = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.status) qs.set('status', params.status);
  if (params.page) qs.set('page', String(params.page));
  const res = await authFetch(`/admin/bookings?${qs.toString()}`, { signal: params.signal });
  if (!res.ok) throw new Error(`Failed to load bookings (${res.status})`);
  return res.json() as Promise<{ bookings: AdminBookingRow[]; total: number; page: number; pages: number }>;
}

export async function getAdminBooking(id: string): Promise<AdminBookingDetail> {
  const res = await authFetch(`/admin/bookings/${id}`);
  if (!res.ok) throw new Error(`Failed to load booking details (${res.status})`);
  const body = (await res.json()) as { booking: AdminBookingDetail };
  return body.booking;
}

export async function reconcileAdminRefund(bookingId: string): Promise<{
  bookingId: string;
  refundId?: string;
  status: string;
  outcome: 'processed' | 'failed' | 'unknown' | 'provider_unavailable' | 'not_pending';
}> {
  const res = await authFetch(`/admin/bookings/${bookingId}/refund/reconcile`, { method: 'POST' });
  const body = (await res.json().catch(() => ({}))) as {
    bookingId?: string;
    refundId?: string;
    status?: string;
    outcome?: 'processed' | 'failed' | 'unknown' | 'provider_unavailable' | 'not_pending';
    message?: string | string[];
  };
  if (!res.ok) {
    throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? `Refund reconciliation failed (${res.status})`);
  }
  return {
    bookingId: body.bookingId ?? bookingId,
    status: body.status ?? 'REFUND_PENDING',
    outcome: body.outcome ?? 'unknown',
    ...(body.refundId ? { refundId: body.refundId } : {}),
  };
}

export async function recoverAdminRefund(bookingId: string): Promise<{
  bookingId: string;
  status: string;
  outcome?: string;
  message?: string;
}> {
  const res = await authFetch(`/admin/bookings/${bookingId}/refund/recover`, { method: 'POST' });
  const body = (await res.json().catch(() => ({}))) as {
    bookingId?: string;
    status?: string;
    outcome?: string;
    message?: string | string[];
    booking?: { id: string; status: string };
  };
  if (!res.ok) {
    throw new Error(
      Array.isArray(body.message) ? body.message.join(', ') : body.message ?? `Refund recovery failed (${res.status})`,
    );
  }
  return {
    bookingId: body.bookingId ?? body.booking?.id ?? bookingId,
    status: body.status ?? body.booking?.status ?? 'REFUND_PENDING',
    outcome: body.outcome,
    message: typeof body.message === 'string' ? body.message : undefined,
  };
}

export async function getAdminStats(): Promise<AdminStats> {
  const res = await authFetch('/admin/stats');
  if (!res.ok) throw new Error(`Failed to load platform stats (${res.status})`);
  return res.json();
}

// ── User management ───────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  isEmailVerified: boolean;
  createdAt: string;
  bookingCount: number;
}

export async function listAdminUsers(
  params: { search?: string; role?: string; isActive?: string; page?: number } = {},
): Promise<{ users: AdminUser[]; total: number; page: number; pages: number }> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.role) qs.set('role', params.role);
  if (params.isActive) qs.set('isActive', params.isActive);
  if (params.page) qs.set('page', String(params.page));
  const res = await authFetch(`/admin/users?${qs.toString()}`);
  if (!res.ok) throw new Error(`Failed to load users (${res.status})`);
  return res.json();
}

export const setAdminUserStatus = (id: string, isActive: boolean) =>
  adminMutation(`/admin/users/${id}/status`, 'PATCH', { isActive });

// ── Event moderation ──────────────────────────────

export interface AdminEventRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  startDate: string;
  organizerEmail: string;
  venue: { name: string; city: string } | null;
  bookingCount: number;
  moderation?: {
    status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
    rejectionReason?: string;
    reviewedAt?: string;
    reviewedBy?: string;
    submittedAt?: string;
  };
}

export async function listAdminEvents(
  params: { search?: string; status?: string; page?: number } = {},
): Promise<{ events: AdminEventRow[]; total: number; page: number; pages: number }> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.status) qs.set('status', params.status);
  if (params.page) qs.set('page', String(params.page));
  const res = await authFetch(`/admin/events?${qs.toString()}`);
  if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
  return res.json();
}

export const moderateAdminEvent = (id: string, reason?: string) =>
  adminMutation(`/admin/events/${id}/moderate`, 'POST', {
    action: 'CANCEL',
    ...(reason && { reason }),
  });

export const reviewAdminEvent = (id: string, action: 'APPROVE' | 'REJECT', reason?: string) =>
  adminMutation(`/admin/events/${id}/review`, 'POST', {
    action,
    ...(reason && { reason }),
  });

// ── Organizer management ──────────────────────────

export interface AdminOrganizerRow {
  id: string;
  organizationName: string;
  isVerified: boolean;
  createdAt: string;
  user: { id: string; email: string; isActive: boolean };
  eventCount: number;
  venueCount: number;
}

export async function listAdminOrganizers(
  params: { search?: string; isVerified?: string; page?: number } = {},
): Promise<{ organizers: AdminOrganizerRow[]; total: number; page: number; pages: number }> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.isVerified) qs.set('isVerified', params.isVerified);
  if (params.page) qs.set('page', String(params.page));
  const res = await authFetch(`/admin/organizers?${qs.toString()}`);
  if (!res.ok) throw new Error(`Failed to load organizers (${res.status})`);
  return res.json();
}

export const setAdminOrganizerVerification = (id: string, isVerified: boolean) =>
  adminMutation(`/admin/organizers/${id}/verification`, 'PATCH', { isVerified });

export async function listAdminCategories(): Promise<AdminCategory[]> {
  const res = await authFetch('/categories');
  if (!res.ok) throw new Error(`Failed to load categories (${res.status})`);
  const body = (await res.json()) as {
    categories: { id: string; name: string; slug: string; description: string | null; icon: string | null; color: string | null; _count: { events: number } }[];
  };
  return body.categories.map((c) => ({ ...c, eventCount: c._count.events }));
}

async function adminMutation(url: string, method: string, body?: unknown): Promise<void> {
  const res = await authFetch(url, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(
      Array.isArray(err.message) ? err.message.join(', ') : (err.message ?? `Failed (${res.status})`),
    );
  }
}

export const createAdminCategory = (input: { name: string; description?: string; color?: string }) =>
  adminMutation('/categories', 'POST', input);

export const deactivateAdminCategory = (id: string) => adminMutation(`/categories/${id}`, 'DELETE');

export function useAdminData(enabled: boolean) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [categories, setCategories] = useState<AdminCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const [s, c] = await Promise.all([getAdminStats(), listAdminCategories()]);
      setStats(s);
      setCategories(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  return { stats, categories, error, loading, reload: load };
}

// ── Audit logs ────────────────────────────────────

export interface AdminAuditLogRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; email: string; firstName: string; lastName: string } | null;
}

export async function listAdminAuditLogs(
  params: {
    search?: string;
    entity?: string;
    action?: string;
    page?: number;
    limit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ logs: AdminAuditLogRow[]; total: number; page: number; pages: number }> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.entity) qs.set('entity', params.entity);
  if (params.action) qs.set('action', params.action);
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  const res = await authFetch(`/admin/audit-logs?${qs.toString()}`, { signal: params.signal });
  if (!res.ok) throw new Error(`Failed to load audit logs (${res.status})`);
  return res.json();
}

