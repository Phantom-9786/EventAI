'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { authFetch } from '@/lib/auth';
import { pollWhileActive } from '@/lib/active-poll';

type Counts = { organizers: number; events: number; emails: number; invitations: number };
const Context = createContext<{ counts: Counts | null; reload: () => void }>({ counts: null, reload: () => {} });

export function AdminPendingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const enabled = user?.role === 'ADMIN';
  useEffect(() => {
    if (!enabled) { setCounts(null); return; }
    const controller = new AbortController();
    authFetch('/admin/pending-counts', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const result = await response.json() as Counts;
        if (!controller.signal.aborted && ['organizers', 'events', 'emails', 'invitations']
          .every(key => Number.isInteger(result[key as keyof Counts]) && result[key as keyof Counts] >= 0)) setCounts(result);
      }).catch(() => { /* Keep the last successful counts while temporarily offline. */ });
    return () => controller.abort();
  }, [enabled, user?.id, revision]);
  useEffect(() => {
    if (!enabled) return;
    const stopPolling = pollWhileActive(reload, 60_000);
    window.addEventListener('eventpoint:admin-queues-changed', reload);
    return () => {
      stopPolling();
      window.removeEventListener('eventpoint:admin-queues-changed', reload);
    };
  }, [enabled, reload]);
  return <Context.Provider value={{ counts: enabled ? counts : null, reload }}>{children}</Context.Provider>;
}

export const useAdminPending = () => useContext(Context);

export function PendingBadge({ count, label }: { count?: number | null; label: string }) {
  if (!count || count < 0) return null;
  return <span className="ep-pending-badge" aria-label={`${count} ${label}`} title={`${count} ${label}`}>
    {count > 99 ? '99+' : count}
  </span>;
}

export function AdminQueueBadge({ section = 'overview' }: { section?: string }) {
  const { counts } = useAdminPending();
  if (!counts) return null;
  const key = { organizers: 'organizers', events: 'events', users: 'emails', team: 'invitations' }[section] as keyof Counts | undefined;
  const count = section === 'overview' ? Object.values(counts).reduce((sum, value) => sum + value, 0) : key ? counts[key] : 0;
  return <PendingBadge count={count} label="pending items" />;
}
