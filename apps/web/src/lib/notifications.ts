'use client';

import { authFetch } from './auth';

export interface InAppNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  data?: {
    link?: string;
    bookingId?: string;
    eventId?: string;
    [key: string]: unknown;
  } | null;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  notifications: InAppNotification[];
  unreadCount: number;
}

export async function getNotifications(limit = 30): Promise<NotificationsResponse> {
  const res = await authFetch(`/notifications?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to load notifications (${res.status})`);
  return res.json();
}

export async function markNotificationAsRead(id: string): Promise<void> {
  const res = await authFetch(`/notifications/${id}/read`, { method: 'PATCH' });
  if (!res.ok) throw new Error(`Failed to mark notification as read (${res.status})`);
}

export async function markAllNotificationsAsRead(): Promise<void> {
  const res = await authFetch('/notifications/read-all', { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to mark all notifications as read (${res.status})`);
}

export async function clearAllNotifications(): Promise<void> {
  const res = await authFetch('/notifications', { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to clear notifications (${res.status})`);
}

export async function clearNotification(id: string): Promise<void> {
  const res = await authFetch(`/notifications/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to clear notification (${res.status})`);
}


export async function clearReadNotifications(): Promise<void> {
  const res = await authFetch('/notifications/read', { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to clear read notifications (' + res.status + ')');
}
