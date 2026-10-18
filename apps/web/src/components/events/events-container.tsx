'use client';

import * as React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, SlidersHorizontal, UserCheck, ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import { EventCard } from '@/components/events/event-card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/auth/auth-provider';
import { getAccessToken, setAccessToken, switchTesterSession } from '@/lib/auth';
import { getMaintenanceTesters, type MaintenanceTester } from '@/lib/admin';
import type { Category, EventsSearchResult, EventSummary } from '@/lib/api';

const sortOptions = [
  { value: 'date:asc', label: 'Soonest first' },
  { value: 'date:desc', label: 'Latest first' },
  { value: 'price:asc', label: 'Price: low to high' },
  { value: 'price:desc', label: 'Price: high to low' },
  { value: 'popularity:desc', label: 'Most popular' },
] as const;

function buildQuery(
  base: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  const merged = { ...base, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export interface EventsContainerProps {
  categories: Category[];
  initialResult: EventsSearchResult;
  initialMaintenanceBlocked: boolean;
  initialMaintenanceMessage: string | null;
  currentFilters: {
    q?: string;
    category?: string;
    city?: string;
    sort?: string;
    page: string;
  };
}

export function EventsContainer({
  categories,
  initialResult,
  initialMaintenanceBlocked,
  initialMaintenanceMessage,
  currentFilters,
}: EventsContainerProps) {
  const router = useRouter();
  const { user, loading: authLoading, completeSignIn } = useAuth();

  const [result, setResult] = useState<EventsSearchResult>(initialResult);
  const [isMaintenanceBlocked, setIsMaintenanceBlocked] = useState(initialMaintenanceBlocked);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(initialMaintenanceMessage);
  const [isReFetching, setIsReFetching] = useState(false);
  const [testers, setTesters] = useState<MaintenanceTester[]>([]);
  const [switchingTester, setSwitchingTester] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = currentFilters.q;
  const category = currentFilters.category;
  const city = currentFilters.city;
  const sort = currentFilters.sort ?? 'date:asc';
  const page = Math.max(1, Number.parseInt(currentFilters.page, 10) || 1);

  const isAdmin = user?.role === 'ADMIN';
  const isAuthorizedTester = Boolean(user?.isMaintenanceTester);

  // Client-side fetch of events with explicit Bearer token
  const fetchEventsWithAuth = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return false;

    // Ensure cookie is in sync with localStorage token
    setAccessToken(token);

    setIsReFetching(true);
    setActionError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
      const [sortBy, sortDir] = sort.split(':') as [string, string];
      const params = new URLSearchParams();
      if (query) params.set('query', query);
      if (category) params.set('category', category);
      if (city) params.set('city', city);
      if (sortBy) params.set('sortBy', sortBy);
      if (sortDir) params.set('sortDir', sortDir);
      params.set('page', String(page));
      params.set('limit', '12');

      const res = await fetch(`${apiBase}/events?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      });

      if (res.ok) {
        const data = (await res.json()) as EventsSearchResult;
        setResult(data);
        setIsMaintenanceBlocked(false);
        return true;
      } else if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        setIsMaintenanceBlocked(true);
        setMaintenanceMessage(body.message || 'Website maintenance is active.');
        return false;
      }
    } catch {
      // Network failure
    } finally {
      setIsReFetching(false);
    }
    return false;
  }, [category, city, page, query, sort]);

  // Load linked testers if user is an administrator
  useEffect(() => {
    if (!authLoading && isAdmin) {
      getMaintenanceTesters()
        .then((list) => {
          setTesters(list);
        })
        .catch(() => {
          // Non-blocking
        });
    }
  }, [authLoading, isAdmin]);

  // If SSR was maintenance-blocked, but the browser has an authenticated admin or authorized tester session,
  // automatically re-fetch the published events using the client's Bearer token.
  useEffect(() => {
    if (!authLoading && isMaintenanceBlocked && (isAdmin || isAuthorizedTester)) {
      void fetchEventsWithAuth();
    }
  }, [authLoading, isMaintenanceBlocked, isAdmin, isAuthorizedTester, fetchEventsWithAuth]);

  // Switch session to linked attendee testing account without re-entering credentials
  const handleSwitchToTester = async (targetEmail: string) => {
    setSwitchingTester(true);
    setActionError(null);
    try {
      const switchedUser = await switchTesterSession(targetEmail);
      completeSignIn(switchedUser);
      // Re-fetch events under the new session
      await fetchEventsWithAuth();
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to switch to test account';
      setActionError(msg);
    } finally {
      setSwitchingTester(false);
    }
  };

  return (
    <div>
      {/* Search and Filters */}
      <form action="/events" method="get" className="mt-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search events…"
            aria-label="Search events"
            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <input
          type="text"
          name="city"
          defaultValue={city}
          placeholder="City"
          aria-label="Filter by city"
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-44"
        />
        <select
          name="sort"
          defaultValue={sort}
          aria-label="Sort events"
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-52"
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {category && <input type="hidden" name="category" value={category} />}
        <button type="submit" className={cn(buttonVariants(), 'h-10 shrink-0')}>
          <SlidersHorizontal className="mr-1 h-4 w-4" />
          Apply
        </button>
      </form>

      {/* Category chips */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/events${buildQuery(currentFilters, { category: undefined, page: undefined })}`}
          className={cn(
            buttonVariants({ variant: category ? 'outline' : 'default', size: 'sm' }),
            'rounded-full',
          )}
        >
          All
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/events${buildQuery(currentFilters, { category: c.slug, page: undefined })}`}
            className={cn(
              buttonVariants({
                variant: category === c.slug ? 'default' : 'outline',
                size: 'sm',
              }),
              'rounded-full',
            )}
          >
            {c.name}
          </Link>
        ))}
      </div>

      {/* Admin Attendee Testing Banner & Switcher */}
      {isAdmin && (
        <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-primary shrink-0" />
            <div>
              <span className="font-semibold text-foreground">Admin Testing Access:</span>{' '}
              <span className="text-muted-foreground">
                You are viewing the attendee experience with platform admin privileges ({user?.email}).
              </span>
            </div>
          </div>
          {testers.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground">Linked Tester:</span>
              <button
                type="button"
                onClick={() => void handleSwitchToTester(testers[0].testEmail)}
                disabled={switchingTester}
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'h-8 text-xs font-semibold gap-1.5',
                )}
              >
                {switchingTester ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowRight className="h-3.5 w-3.5" />
                )}
                Switch to {testers[0].testEmail}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Authorized Tester Banner */}
      {!isAdmin && isAuthorizedTester && (
        <div className="mt-6 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="text-muted-foreground">
              Signed in as <strong className="text-foreground">{user?.email}</strong> (Authorized Maintenance Tester — {user?.role === 'ORGANIZER' ? 'Organizer' : 'Attendee'})
            </span>
          </div>
          <button
            type="button"
            onClick={() => void fetchEventsWithAuth()}
            disabled={isReFetching}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-8 text-xs gap-1')}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isReFetching && 'animate-spin')} />
            Refresh
          </button>
        </div>
      )}

      {actionError && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {actionError}
        </div>
      )}

      {/* Results View */}
      {isMaintenanceBlocked ? (
        <div className="mt-16 rounded-xl border border-amber-500/30 bg-amber-500/5 p-10 text-center max-w-xl mx-auto shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 mb-4 animate-pulse">
            <SlidersHorizontal className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Website Maintenance Active
          </h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {maintenanceMessage ||
              'Public event browsing is temporarily unavailable while website maintenance is active.'}
          </p>

          {isReFetching ? (
            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400" />
              <span>Verifying authenticated maintenance session...</span>
            </div>
          ) : user ? (
            // User is already signed in, so DO NOT tell them to "Sign In as Tester"!
            <div className="mt-6 flex flex-col items-center gap-3">
              <p className="text-xs text-muted-foreground max-w-sm">
                {isAdmin || isAuthorizedTester
                  ? 'Your account is authorized. Click below to refresh your attendee testing session.'
                  : `Signed in as ${user.email} (${user.role}). This account is not an authorized maintenance tester.`}
              </p>
              <div className="flex gap-3">
                {(isAdmin || isAuthorizedTester) && (
                  <button
                    type="button"
                    onClick={() => void fetchEventsWithAuth()}
                    className={cn(buttonVariants(), 'h-9 px-4 text-xs font-semibold gap-1.5')}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Load Events
                  </button>
                )}
                <Link
                  href="/"
                  className={cn(buttonVariants({ variant: 'outline' }), 'h-9 px-4 text-xs')}
                >
                  Return Home
                </Link>
              </div>
            </div>
          ) : (
            // Public unauthenticated visitor
            <div className="mt-6 flex justify-center gap-3">
              <Link
                href="/signin?redirect=/events"
                className={cn(buttonVariants(), 'h-9 px-4 text-xs font-semibold')}
              >
                Sign In as Tester
              </Link>
              <button
                type="button"
                onClick={() => void fetchEventsWithAuth()}
                className={cn(buttonVariants({ variant: 'outline' }), 'h-9 px-4 text-xs')}
              >
                Check Again
              </button>
            </div>
          )}
        </div>
      ) : result.events.length === 0 ? (
        <div className="mt-16 rounded-lg border border-dashed p-12 text-center">
          <p className="text-lg font-medium">No events found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try different search terms or clear your filters.
          </p>
          <Link href="/events" className={cn(buttonVariants({ variant: 'outline' }), 'mt-4')}>
            Clear filters
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {result.events.map((event: EventSummary) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!isMaintenanceBlocked && result.pages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Pagination">
          {page > 1 && (
            <Link
              href={`/events${buildQuery(currentFilters, { page: String(page - 1) })}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Previous
            </Link>
          )}
          <span className="px-3 text-sm text-muted-foreground">
            Page {result.page} of {result.pages}
          </span>
          {page < result.pages && (
            <Link
              href={`/events${buildQuery(currentFilters, { page: String(page + 1) })}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
