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

export async function getAdminStats(): Promise<AdminStats> {
  const res = await authFetch('/admin/stats');
  if (!res.ok) throw new Error(`Failed to load platform stats (${res.status})`);
  return res.json();
}

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
