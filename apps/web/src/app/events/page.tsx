import Link from 'next/link';
import type { Metadata } from 'next';
import { Search, SlidersHorizontal } from 'lucide-react';
import { EventCard } from '@/components/events/event-card';
import { buttonVariants } from '@/components/ui/button';
import { getCategories, searchEvents } from '@/lib/api';
import { cn } from '@/lib/utils';

interface EventsPageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

export const metadata: Metadata = {
  title: 'Discover Events',
  description: 'Browse and search upcoming events — concerts, conferences, sports and more.',
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

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

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const query = first(searchParams.q);
  const category = first(searchParams.category);
  const city = first(searchParams.city);
  const sort = first(searchParams.sort) ?? 'date:asc';
  const [sortBy, sortDir] = sort.split(':') as [string, string];
  const page = Math.max(1, Number.parseInt(first(searchParams.page) ?? '1', 10) || 1);

  const currentFilters = { q: query, category, city, sort, page: String(page) };

  const [categories, result] = await Promise.all([
    getCategories(),
    searchEvents({
      query,
      category,
      city,
      sortBy: sortBy as 'date' | 'price' | 'popularity' | 'createdAt',
      sortDir: sortDir as 'asc' | 'desc',
      page,
      limit: 12,
    }).catch(() => ({ events: [], total: 0, page: 1, pages: 1, limit: 12 })),
  ]);

  return (
    <div className="container py-10">
      <h1 className="text-3xl font-bold tracking-tight">Discover Events</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {result.total} event{result.total === 1 ? '' : 's'} found
      </p>

      {/* Filters */}
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
        <button
          type="submit"
          className={cn(buttonVariants(), 'h-10 shrink-0')}
        >
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

      {/* Results */}
      {result.events.length === 0 ? (
        <div className="mt-16 rounded-lg border border-dashed p-12 text-center">
          <p className="text-lg font-medium">No events found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try different search terms or clear your filters.
          </p>
          <Link
            href="/events"
            className={cn(buttonVariants({ variant: 'outline' }), 'mt-4')}
          >
            Clear filters
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {result.events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {result.pages > 1 && (
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
