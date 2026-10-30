'use client';
import { RefreshButton } from '@/components/ui/refresh-button';

import * as React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Link from '@/components/ui/app-link';
import { useRouter } from 'next/navigation';
import {
  Search,
  SlidersHorizontal,
  UserCheck,
  ArrowRight,
  Loader2,
  RefreshCw,
  LayoutGrid,
  List,
  Heart,
  Ticket as TicketIcon,
} from 'lucide-react';
import { EventCard } from '@/components/events/event-card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/auth/auth-provider';
import { useFavorites } from '@/lib/favorites';
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
  initialLoadFailed?: boolean;
  currentFilters: {
    aiFilters?: string;
    q?: string;
    category?: string;
    city?: string;
    sort?: string;
    filter?: string;
    page: string;
  };
}

export function EventsContainer({
  categories,
  initialResult,
  initialMaintenanceBlocked,
  initialMaintenanceMessage,
  initialLoadFailed = false,
  currentFilters,
}: EventsContainerProps) {
  const router = useRouter();
  const { user, loading: authLoading, completeSignIn } = useAuth();
  const { isFavorite, count: favoriteCount } = useFavorites();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [result, setResult] = useState<EventsSearchResult>(initialResult);
  const [isMaintenanceBlocked, setIsMaintenanceBlocked] = useState(
    initialMaintenanceBlocked,
  );
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(
    initialMaintenanceMessage,
  );
  const [isReFetching, setIsReFetching] = useState(false);
  const [testers, setTesters] = useState<MaintenanceTester[]>([]);
  const [switchingTester, setSwitchingTester] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // A refresh or filter navigation supplies a new server result without remounting.
  useEffect(() => {
    setResult(initialResult);
    setIsMaintenanceBlocked(initialMaintenanceBlocked);
    setMaintenanceMessage(initialMaintenanceMessage);
  }, [initialResult, initialMaintenanceBlocked, initialMaintenanceMessage]);

  const query = currentFilters.q;
  const category = currentFilters.category;
  const city = currentFilters.city;
  const sort = currentFilters.sort ?? 'date:asc';
  const [searchDraft, setSearchDraft] = useState(query ?? '');
  const [cityDraft, setCityDraft] = useState(city ?? '');
  const [sortDraft, setSortDraft] = useState(sort);
  useEffect(() => {
    setSearchDraft(query ?? '');
    setCityDraft(city ?? '');
    setSortDraft(sort);
  }, [query, city, sort]);
  const page = Math.max(1, Number.parseInt(currentFilters.page, 10) || 1);

  const isAdmin = user?.role === 'ADMIN';
  const isAuthorizedTester = Boolean(user?.isMaintenanceTester);

  const isSavedFilterActive = currentFilters.filter === 'saved';
  const displayedEvents = isSavedFilterActive
    ? result.events.filter((event) => isFavorite(event.id))
    : result.events;

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
      if (currentFilters.aiFilters) params.set('aiFilters', currentFilters.aiFilters);
      if (query) params.set('query', query);
      if (category) params.set('category', category);
      if (city) params.set('city', city);
      if (sortBy) params.set('sortBy', sortBy);
      if (sortDir) params.set('sortDir', sortDir);
      params.set('page', String(page));
      params.set('limit', '12');

      const res = await fetch(`${apiBase}/events?${params.toString()}`, {
        signal: AbortSignal.timeout(20_000),
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
  }, [category, city, page, query, sort, currentFilters.aiFilters]);

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
  }, [
    authLoading,
    isMaintenanceBlocked,
    isAdmin,
    isAuthorizedTester,
    fetchEventsWithAuth,
  ]);

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
      <div
        className="category-strip ep-discovery-categories"
        aria-label="Event categories"
      >
        <Link
          href={
            '/events' +
            buildQuery(currentFilters, {
              category: undefined,
              filter: undefined,
              page: undefined,
            })
          }
          className={'category ' + (!category && !currentFilters.filter ? 'active' : '')}
        >
          <span className="cat-symbol">
            <LayoutGrid className="icon" />
          </span>
          All experiences
        </Link>
        <Link
          href={
            '/events' +
            buildQuery(currentFilters, {
              filter: isSavedFilterActive ? undefined : 'saved',
              page: undefined,
            })
          }
          className={'category ' + (isSavedFilterActive ? 'active' : '')}
        >
          <span className="cat-symbol">
            <Heart className="icon" />
          </span>
          Saved ({favoriteCount})
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            href={
              '/events' +
              buildQuery(currentFilters, {
                category: c.slug,
                filter: undefined,
                page: undefined,
              })
            }
            className={'category ' + (category === c.slug ? 'active' : '')}
          >
            <span className="cat-symbol">
              <TicketIcon className="icon" />
            </span>
            {c.name}
          </Link>
        ))}
      </div>
      <form action="/events" method="get" className="filter-bar" onSubmit={event => {
        event.preventDefault();
        const params = new URLSearchParams();
        new FormData(event.currentTarget).forEach((value, key) => {
          if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
        });
        router.push('/events' + (params.size ? '?' + params.toString() : ''));
      }}>
        <label>
          <Search className="icon" />
          <input
            name="q"
            type="search"
            value={searchDraft}
            onChange={event => setSearchDraft(event.target.value)}
            aria-label="Search events"
            placeholder="Search events, artists or experiences…"
          />
        </label>
        <input
          name="city"
          type="text"
          value={cityDraft}
          onChange={event => setCityDraft(event.target.value)}
          aria-label="Filter by city"
          placeholder="All cities"
          className="ep-city-filter"
        />
        <select name="sort" value={sortDraft} onChange={event => setSortDraft(event.target.value)} aria-label="Sort events">
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {category && <input type="hidden" name="category" value={category} />}
        {currentFilters.aiFilters && <input type="hidden" name="aiFilters" value={currentFilters.aiFilters} />}
        <button className="btn">
          Search
          <ArrowRight className="icon" />
        </button>
      </form>
      {currentFilters.aiFilters && (
        <p className="ep-ai-filter-note">Showing matches for your AI search. <Link href="/ai">Back to conversation →</Link></p>
      )}
      <div className="result-line">
        <span>
          {!initialLoadFailed && !isMaintenanceBlocked && (
            <strong>
              {isSavedFilterActive
                ? displayedEvents.length + ' saved events'
                : result.total + ' experiences'}
            </strong>
          )}{' '}
          to make your next plan
        </span>
        <div className="ep-actions ep-discovery-view-actions">
          <button
            type="button"
            aria-label="Grid view"
            onClick={() => setViewMode('grid')}
          >
            <LayoutGrid className="icon" />
          </button>
          <button
            type="button"
            aria-label="List view"
            onClick={() => setViewMode('list')}
          >
            <List className="icon" />
          </button>
          <Link className="ep-clear-filters" href="/events" onClick={() => {
            setSearchDraft(''); setCityDraft(''); setSortDraft('date:asc');
          }}>Clear filters</Link>
        </div>
      </div>
      {/* Admin Attendee Testing Banner & Switcher */}
      {isAdmin && (
        <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-primary shrink-0" />
            <div>
              <span className="font-semibold text-foreground">Admin Testing Access:</span>{' '}
              <span className="text-muted-foreground">
                You are viewing the attendee experience with platform admin privileges (
                {user?.email}).
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
              Signed in as <strong className="text-foreground">{user?.email}</strong>{' '}
              (Authorized Maintenance Tester —{' '}
              {user?.role === 'ORGANIZER' ? 'Organizer' : 'Attendee'})
            </span>
          </div>
          <RefreshButton
            type="button"
            onClick={() => fetchEventsWithAuth()}
            disabled={isReFetching}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'h-8 text-xs gap-1',
            )}
            refreshing={Boolean(isReFetching)}
          />
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
                    className={cn(
                      buttonVariants(),
                      'h-9 px-4 text-xs font-semibold gap-1.5',
                    )}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Load Events
                  </button>
                )}
                <Link
                  href="/"
                  className={cn(
                    buttonVariants({ variant: 'outline' }),
                    'h-9 px-4 text-xs',
                  )}
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
      ) : isReFetching ? (
        <div
          className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          role="status"
        >
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="flex flex-col rounded-2xl border border-border/60 bg-card p-4 shadow-sm animate-pulse"
            >
              <div className="h-44 w-full rounded-xl bg-muted" />
              <div className="mt-4 h-5 w-3/4 rounded bg-muted" />
              <div className="mt-2 h-4 w-1/2 rounded bg-muted" />
              <div className="mt-6 flex justify-between pt-3 border-t">
                <div className="h-4 w-1/3 rounded bg-muted" />
                <div className="h-4 w-1/4 rounded bg-muted" />
              </div>
            </div>
          ))}
          <span className="sr-only">Loading events…</span>
        </div>
      ) : initialLoadFailed ? (
        <div
          className="mx-auto my-12 max-w-lg rounded-2xl border bg-card p-8 text-center"
          role="alert"
        >
          <RefreshCw className="mx-auto mb-4 h-7 w-7 text-primary" aria-hidden />
          <h2 className="text-xl font-semibold">Events are temporarily unavailable</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            We couldn&apos;t connect to the event service. Please try again shortly.
          </p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className={cn(buttonVariants({ variant: 'outline' }), 'mt-5')}
          >
            Try again
          </button>
        </div>
      ) : displayedEvents.length === 0 ? (
        <div className="mt-14 rounded-3xl border border-dashed border-border/80 bg-card/40 p-12 text-center max-w-lg mx-auto shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 mb-4">
            {isSavedFilterActive ? (
              <Heart className="h-7 w-7 text-rose-500" />
            ) : (
              <Search className="h-7 w-7" />
            )}
          </div>
          <h3 className="text-lg font-bold tracking-tight text-foreground">
            {isSavedFilterActive ? 'No saved events yet' : 'No events found'}
          </h3>
          <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
            {isSavedFilterActive
              ? "You haven't bookmarked any events yet. Tap the heart icon on any event to save it here."
              : "We couldn't find any events matching your current filters. Try searching for something else or reset your criteria."}
          </p>
          <div className="mt-6">
            <Link
              href="/events"
              className={cn(
                buttonVariants({
                  variant: isSavedFilterActive ? 'gradient' : 'outline',
                  size: 'sm',
                }),
                'rounded-xl',
              )}
            >
              {isSavedFilterActive ? 'Explore Events' : 'Clear All Filters'}
            </Link>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            'mt-8',
            viewMode === 'grid' ? 'ep-grid' : 'flex flex-col gap-4 max-w-4xl mx-auto',
          )}
        >
          {displayedEvents.map((event: EventSummary) => (
            <EventCard
              key={event.id}
              event={event}
              showDescription={viewMode === 'list'}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!isMaintenanceBlocked && result.pages > 1 && (
        <nav
          className="mt-10 flex items-center justify-center gap-2"
          aria-label="Pagination"
        >
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
