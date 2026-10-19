'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from './auth';

export interface AdminStats {
  users: number;
  organizers: { total: number; verified: number };
  events: {
    total: number;
    DRAFT: number;
    PUBLISHED: number;
    CANCELLED: number;
    COMPLETED: number;
    SOLDOUT: number;
  };
  bookings: Record<string, number>;
  revenue: { gross: number; refunded: number; net: number };
  tickets: {
    VALID: number;
    USED: number;
    CANCELLED: number;
    EXPIRED: number;
    issued: number;
    checkedIn: number;
  };
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
  payment: {
    status: string;
    amount: number;
    refundAmount: number | null;
    updatedAt: string;
  } | null;
}

export interface AdminBookingDetail extends AdminBookingRow {
  updatedAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  items: {
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    ticketType: { name: string };
  }[];
  payment:
    | (NonNullable<AdminBookingRow['payment']> & {
        currency: string;
        method: string | null;
        refundId: string | null;
        refundRequestStatus?: string | null;
        refundRequestReason?: string | null;
        refundRequestedAt?: string | null;
        failureReason: string | null;
        createdAt: string;
      })
    | null;
  ticketCounts: Record<string, number>;
}

export async function listAdminBookings(
  params: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
    signal?: AbortSignal;
  } = {},
) {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('limit', String(params.limit ?? 20));
  if (params.search) qs.set('search', params.search);
  if (params.status) qs.set('status', params.status);
  const res = await authFetch(`/admin/bookings?${qs.toString()}`, {
    signal: params.signal,
  });
  if (!res.ok) throw new Error(`Failed to load bookings (${res.status})`);
  return res.json() as Promise<{
    bookings: AdminBookingRow[];
    total: number;
    page: number;
    pages: number;
  }>;
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
  const res = await authFetch(`/admin/bookings/${bookingId}/refund/reconcile`, {
    method: 'POST',
  });
  const body = (await res.json().catch(() => ({}))) as {
    bookingId?: string;
    refundId?: string;
    status?: string;
    outcome?: 'processed' | 'failed' | 'unknown' | 'provider_unavailable' | 'not_pending';
    message?: string | string[];
  };
  if (!res.ok) {
    throw new Error(
      Array.isArray(body.message)
        ? body.message.join(', ')
        : (body.message ?? `Refund reconciliation failed (${res.status})`),
    );
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
  const res = await authFetch(`/admin/bookings/${bookingId}/refund/recover`, {
    method: 'POST',
  });
  const body = (await res.json().catch(() => ({}))) as {
    bookingId?: string;
    status?: string;
    outcome?: string;
    message?: string | string[];
    booking?: { id: string; status: string };
  };
  if (!res.ok) {
    throw new Error(
      Array.isArray(body.message)
        ? body.message.join(', ')
        : (body.message ?? `Refund recovery failed (${res.status})`),
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
  isDeleted?: boolean;
  lifecycleStatus?: 'ACTIVE' | 'DEACTIVATED' | 'DELETED' | 'UNVERIFIED';
}

export async function listAdminUsers(
  params: {
    search?: string;
    role?: string;
    isActive?: string;
    status?: string;
    page?: number;
    limit?: number;
  } = {},
): Promise<{ users: AdminUser[]; total: number; page: number; pages: number }> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('limit', String(params.limit ?? 20));
  if (params.search) qs.set('search', params.search);
  if (params.role) qs.set('role', params.role);
  if (params.isActive) qs.set('isActive', params.isActive);
  if (params.status) qs.set('status', params.status);
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

export interface AdminEventDetail extends AdminEventRow {
  faqs?: { id: string; question: string; answer: string }[];
  description: string;
  shortDescription: string | null;
  endDate: string;
  coverImage: string | null;
  images: string[];
  tags: string[];
  policies: string | null;
  cancellationPolicy: string | null;
  category: {
    id: string;
    name: string;
    slug?: string;
    color?: string | null;
    icon?: string | null;
  };
  venue: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    capacity?: number;
  } | null;
  ticketTypes: {
    id: string;
    name: string;
    description: string | null;
    price: number;
    currency: string;
    totalQuantity: number;
    availableQuantity: number;
    maxPerBooking: number;
    isActive: boolean;
  }[];
  organizer: {
    id: string;
    organizationName: string;
    description: string | null;
    phone: string | null;
    website: string | null;
    isVerified?: boolean;
    user: { id: string; email: string; firstName: string; lastName: string };
  };
}

export async function listAdminEvents(
  params: { search?: string; status?: string; page?: number; limit?: number } = {},
): Promise<{ events: AdminEventRow[]; total: number; page: number; pages: number }> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('limit', String(params.limit ?? 20));
  if (params.search) qs.set('search', params.search);
  if (params.status) qs.set('status', params.status);
  const res = await authFetch(`/admin/events?${qs.toString()}`);
  if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
  return res.json();
}

export async function getAdminEventDetail(id: string): Promise<AdminEventDetail> {
  const res = await authFetch(`/admin/events/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to load event details (${res.status})`);
  const data = (await res.json()) as { event: AdminEventDetail };
  return data.event;
}

export const moderateAdminEvent = (id: string, reason?: string) =>
  adminMutation(`/admin/events/${id}/moderate`, 'POST', {
    action: 'CANCEL',
    ...(reason && { reason }),
  });

export const reviewAdminEvent = (
  id: string,
  action: 'APPROVE' | 'REJECT',
  reason?: string,
) =>
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
  params: { search?: string; isVerified?: string; page?: number; limit?: number } = {},
): Promise<{
  organizers: AdminOrganizerRow[];
  total: number;
  page: number;
  pages: number;
}> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('limit', String(params.limit ?? 20));
  if (params.search) qs.set('search', params.search);
  if (params.isVerified) qs.set('isVerified', params.isVerified);
  const res = await authFetch(`/admin/organizers?${qs.toString()}`);
  if (!res.ok) throw new Error(`Failed to load organizers (${res.status})`);
  return res.json();
}

export const setAdminOrganizerVerification = (id: string, isVerified: boolean) =>
  adminMutation(`/admin/organizers/${id}/verification`, 'PATCH', { isVerified });

export interface OrganizerApplication {
  id: string;
  userId: string;
  organizationName: string;
  description: string | null;
  phone: string | null;
  website: string | null;
  logo: string | null;
  isVerified: boolean;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedAt?: string;
  reviewedBy?: string;
}

export async function listPendingOrganizerApplications(): Promise<{
  applications: OrganizerApplication[];
}> {
  const res = await authFetch('/admin/organizers/applications/pending');
  if (!res.ok)
    throw new Error(`Failed to load pending organizer applications (${res.status})`);
  return res.json();
}

export const approveOrganizerApplication = (id: string) =>
  adminMutation(`/admin/organizers/${id}/approve`, 'POST');

export const rejectOrganizerApplication = (id: string, reason: string) =>
  adminMutation(`/admin/organizers/${id}/reject`, 'POST', { reason });

export async function listAdminCategories(): Promise<AdminCategory[]> {
  const res = await authFetch('/categories');
  if (!res.ok) throw new Error(`Failed to load categories (${res.status})`);
  const body = (await res.json()) as {
    categories: {
      id: string;
      name: string;
      slug: string;
      description: string | null;
      icon: string | null;
      color: string | null;
      _count: { events: number };
    }[];
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
      Array.isArray(err.message)
        ? err.message.join(', ')
        : (err.message ?? `Failed (${res.status})`),
    );
  }
}

export const createAdminCategory = (input: {
  name: string;
  description?: string;
  color?: string;
}) => adminMutation('/categories', 'POST', input);

export const deactivateAdminCategory = (id: string) =>
  adminMutation(`/categories/${id}`, 'DELETE');

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
  qs.set('page', String(params.page ?? 1));
  qs.set('limit', String(params.limit ?? 20));
  if (params.search) qs.set('search', params.search);
  if (params.entity) qs.set('entity', params.entity);
  if (params.action) qs.set('action', params.action);
  const res = await authFetch(`/admin/audit-logs?${qs.toString()}`, {
    signal: params.signal,
  });
  if (!res.ok) throw new Error(`Failed to load audit logs (${res.status})`);
  return res.json();
}

// ── System Controls & Maintenance ──────────────────

export interface SystemControlsSettings {
  websiteMaintenance: boolean;
  websiteMaintenanceMessage: string;
  aiMaintenance: boolean;
  aiMaintenanceMessage: string;
  eventCreationMaintenance: boolean;
  eventCreationMaintenanceMessage: string;
}

export async function getAdminSystemControls(): Promise<SystemControlsSettings> {
  const res = await authFetch('/admin/system-controls');
  if (!res.ok) throw new Error(`Failed to load system controls (${res.status})`);
  return res.json();
}

export async function updateAdminSystemControls(
  updates: Partial<SystemControlsSettings>,
): Promise<SystemControlsSettings> {
  const res = await authFetch('/admin/system-controls', {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update system controls (${res.status})`);
  return res.json();
}

export async function getPublicSystemControls(): Promise<SystemControlsSettings> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
  const res = await fetch(`${apiBase}/system-controls`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch system controls (${res.status})`);
  return res.json();
}

// ── Team & Access Management ──────────────────────

export type AdminRoleType = 'OWNER' | 'ADMIN';
export type AdminInvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

export interface AdminTeamMember {
  id: string;
  email: string;
  fullName: string;
  adminRole: AdminRoleType;
  createdAt: string;
  isCurrentUser: boolean;
  isOwner: boolean;
}

export interface AdminInvitationSummary {
  id: string;
  email: string;
  role: AdminRoleType;
  status: AdminInvitationStatus;
  expiresAt: string;
  createdAt: string;
  invitedBy: { email: string; fullName: string };
  acceptedAt: string | null;
  acceptedBy: { email: string; fullName: string } | null;
  emailDeliveryFailed?: boolean;
}

export interface AdminTeamResponse {
  currentUser: { id: string; email: string; isOwner: boolean; role: AdminRoleType };
  members: AdminTeamMember[];
  invitations: AdminInvitationSummary[];
  pendingInvitations?: AdminInvitationSummary[];
  acceptedInvitations?: AdminInvitationSummary[];
  historicalInvitations?: AdminInvitationSummary[];
}

export async function listAdminTeam(): Promise<AdminTeamResponse> {
  const res = await authFetch('/admin/team');
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to load admin team (${res.status})`);
  }
  return res.json();
}

export async function inviteAdminMember(data: {
  email: string;
  role: AdminRoleType;
}): Promise<{
  success: boolean;
  emailDeliveryFailed?: boolean;
  message?: string;
  invitation: AdminInvitationSummary;
}> {
  const res = await authFetch('/admin/team/invitations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to send invitation (${res.status})`);
  }
  return res.json();
}

export async function resendAdminInvitation(
  id: string,
): Promise<{ success: boolean; emailDeliveryFailed?: boolean; message?: string }> {
  const res = await authFetch(`/admin/team/invitations/${id}/resend`, {
    method: 'POST',
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to resend invitation (${res.status})`);
  }
  return res.json();
}

export async function revokeAdminInvitation(id: string): Promise<{ success: boolean }> {
  const res = await authFetch(`/admin/team/invitations/${id}/revoke`, {
    method: 'POST',
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to revoke invitation (${res.status})`);
  }
  return res.json();
}

export async function revokeAdminMemberAccess(id: string): Promise<{ success: boolean }> {
  const res = await authFetch(`/admin/team/members/${id}/revoke`, {
    method: 'POST',
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to revoke admin access (${res.status})`);
  }
  return res.json();
}

export async function acceptAdminInvitation(token: string): Promise<{
  success: boolean;
  role: AdminRoleType;
  message?: string;
}> {
  const res = await authFetch('/admin/team/invitations/accept', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to accept invitation (${res.status})`);
  }
  return res.json();
}

export async function deleteAdminInvitationHistory(
  id: string,
): Promise<{ success: boolean }> {
  const res = await authFetch(`/admin/team/invitations/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(
      errorBody.message || `Failed to clear invitation record (${res.status})`,
    );
  }
  return res.json();
}

export async function clearAcceptedAdminInvitations(): Promise<{
  success: boolean;
  clearedCount: number;
}> {
  const res = await authFetch('/admin/team/invitations/clear-accepted', {
    method: 'POST',
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(
      errorBody.message || `Failed to clear accepted invitations (${res.status})`,
    );
  }
  return res.json();
}

export interface MaintenanceTester {
  adminId: string;
  adminEmail: string;
  testEmail: string;
  testUserId: string;
  allowedRoles: ('CUSTOMER' | 'ORGANIZER')[];
  createdAt: string;
}

export async function getMaintenanceTesters(): Promise<MaintenanceTester[]> {
  const res = await authFetch('/admin/maintenance-testers');
  if (!res.ok) throw new Error(`Failed to load maintenance testers (${res.status})`);
  return res.json();
}

export const setAdminEventPaused = (
  id: string,
  action: 'PAUSE' | 'RESUME',
  reason?: string,
) =>
  adminMutation('/admin/events/' + id + '/moderate', 'POST', {
    action,
    ...(reason ? { reason } : {}),
  });
