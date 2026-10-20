'use client';
import { RefreshButton } from '@/components/ui/refresh-button';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Check, CheckCheck, ExternalLink, Trash2 } from 'lucide-react';
import {
  clearAllNotifications,
  clearReadNotifications,
  clearNotification,
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type InAppNotification,
} from '@/lib/notifications';
import { useAuth } from '@/components/auth/auth-provider';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';

function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function NotificationBell({ inline = false }: { inline?: boolean } = {}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(inline);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [refreshing, setRefreshing] = useState(false);
  const requestInFlight = useRef(false);
  const fetchItems = useCallback(async () => {
    if (!user || requestInFlight.current) return;
    requestInFlight.current = true;
    setRefreshing(true);
    try {
      const data = await getNotifications();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
      setActionError(null);
    } catch {
      setActionError('Unable to refresh notifications. Please try again.');
    } finally {
      requestInFlight.current = false;
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    void fetchItems();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchItems();
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchItems]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (!user) return null;

  const handleMarkAsRead = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await markNotificationAsRead(id);
      setNotifications((curr) =>
        curr.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      );
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch {
      // ignore
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsAsRead();
      setNotifications((curr) => curr.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  };

  const handleClearAll = async () => {
    setIsClearing(true);
    setActionError(null);
    try {
      await clearAllNotifications();
      setNotifications([]);
      setUnreadCount(0);
      setClearDialogOpen(false);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to clear notifications',
      );
    } finally {
      setIsClearing(false);
    }
  };

  const handleClearSingle = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setClearingId(id);
    setActionError(null);
    try {
      await clearNotification(id);
      const target = notifications.find((n) => n.id === id);
      setNotifications((curr) => curr.filter((n) => n.id !== id));
      if (target && !target.isRead) {
        setUnreadCount((count) => Math.max(0, count - 1));
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to clear notification');
    } finally {
      setClearingId(null);
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      {!inline && (
        <button
          type="button"
          onClick={() => {
            setOpen((prev) => !prev);
            if (!open) void fetchItems();
          }}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="Notifications"
          aria-expanded={open}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground shadow">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      )}

      {(inline || open) && (
        <div
          className={
            inline
              ? 'ep-notification-center panel'
              : 'absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border bg-card p-0 shadow-lg ring-1 ring-black/5 z-50 animate-in fade-in-50 zoom-in-95'
          }
        >
          <div className="ep-notification-toolbar flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">Notifications</span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="ep-notification-actions flex flex-wrap items-center gap-3">
              <RefreshButton
                type="button"
                aria-label="Refresh notifications"
                disabled={refreshing}
                onClick={() => fetchItems()}
                className="text-sm text-muted-foreground disabled:opacity-50"
                refreshing={Boolean(refreshing)}
                iconOnly
              />
              {notifications.some((n) => n.isRead) && (
                <button
                  type="button"
                  disabled={isClearing}
                  className="text-xs text-muted-foreground"
                  onClick={async () => {
                    setIsClearing(true);
                    try {
                      await clearReadNotifications();
                      await fetchItems();
                    } catch {
                      setActionError('Unable to clear read notifications.');
                    } finally {
                      setIsClearing(false);
                    }
                  }}
                >
                  Clear read
                </button>
              )}
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void handleMarkAllRead()}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium transition-colors"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={() => setClearDialogOpen(true)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive font-medium transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear notifications
                </button>
              )}
            </div>
          </div>

          {actionError && (
            <div className="bg-destructive/10 text-destructive border-b border-destructive/20 px-4 py-2 text-xs flex items-center justify-between">
              <span>{actionError}</span>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="ml-2 font-semibold hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="max-h-[380px] overflow-y-auto divide-y divide-border/50">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <Bell className="mx-auto mb-2 h-7 w-7 opacity-30" />
                <p className="font-medium text-foreground">No notifications yet</p>
                <p className="text-xs mt-1">
                  Updates on your bookings, tickets, and refunds will appear here.
                </p>
              </div>
            ) : (
              notifications.map((n) => {
                const targetLink =
                  n.data?.link ??
                  (user.role === 'ADMIN'
                    ? '/admin'
                    : user.role === 'ORGANIZER'
                      ? '/organizer/events'
                      : '/tickets');
                return (
                  <div
                    key={n.id}
                    className={cn(
                      'p-3.5 text-xs transition-colors hover:bg-muted/40 relative flex gap-3',
                      !n.isRead && 'bg-primary/5',
                    )}
                  >
                    {!n.isRead && (
                      <span className="absolute left-1.5 top-4.5 h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                    <div className="flex-1 space-y-1 pl-1">
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={cn(
                            'font-semibold text-xs text-foreground',
                            !n.isRead && 'text-primary',
                          )}
                        >
                          {n.title}
                        </p>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {timeAgo(n.createdAt)}
                        </span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">{n.message}</p>
                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-3">
                          <Link
                            href={targetLink}
                            onClick={() => {
                              if (!n.isRead) void handleMarkAsRead(n.id);
                              setOpen(false);
                            }}
                            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline text-[11px]"
                          >
                            View details <ExternalLink className="h-3 w-3" />
                          </Link>
                          {!n.isRead && (
                            <button
                              type="button"
                              onClick={(e) => void handleMarkAsRead(n.id, e)}
                              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              <Check className="h-3 w-3" /> Mark read
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => void handleClearSingle(n.id, e)}
                          disabled={clearingId === n.id}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                          title="Clear notification"
                          aria-label={`Clear notification ${n.title}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      <Modal
        isOpen={clearDialogOpen}
        onClose={() => !isClearing && setClearDialogOpen(false)}
        title="Clear all notifications?"
        description={
          unreadCount > 0
            ? `You have ${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}. Clearing all will permanently remove all notifications from your panel.`
            : 'This will permanently remove all notifications from your panel. This action cannot be undone.'
        }
        confirmLabel={isClearing ? 'Clearing…' : 'Clear all'}
        confirmVariant="destructive"
        isLoading={isClearing}
        onConfirm={handleClearAll}
      />
    </div>
  );
}
