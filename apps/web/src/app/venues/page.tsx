import Link from '@/components/ui/app-link';
import type { Metadata } from 'next';
import { MapPin, Search, Users } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { getVenues } from '@/lib/api';
import { cn } from '@/lib/utils';

interface VenuesPageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Venues',
  description: 'Browse venues — halls, stadiums and arenas hosting upcoming events.',
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function VenuesPage({ searchParams }: VenuesPageProps) {
  const query = first(searchParams.q);
  const city = first(searchParams.city);
  const page = Math.max(1, Number.parseInt(first(searchParams.page) ?? '1', 10) || 1);

  const result = await getVenues({ query, city, page, limit: 12 }).catch(() => ({
    venues: [],
    total: 0,
    page: 1,
    pages: 1,
    limit: 12,
  }));

  const pageLink = (nextPage: number) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (city) params.set('city', city);
    params.set('page', String(nextPage));
    return `/venues?${params.toString()}`;
  };

  return (
    <div className="container py-10">
      <h1 className="text-3xl font-bold tracking-tight">Venues</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {result.total} venue{result.total === 1 ? '' : 's'} found
      </p>

      <form action="/venues" method="get" className="mt-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search venues…"
            aria-label="Search venues"
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
        <button type="submit" className={cn(buttonVariants(), 'h-10 shrink-0')}>
          Search
        </button>
      </form>

      {result.venues.length === 0 ? (
        <div className="mt-16 rounded-lg border border-dashed p-12 text-center">
          <p className="text-lg font-medium">No venues found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try a different search term or clear your filters.
          </p>
          <Link href="/venues" className={cn(buttonVariants({ variant: 'outline' }), 'mt-4')}>
            Clear filters
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {result.venues.map((venue) => (
            <Link
              key={venue.id}
              href={`/venues/${venue.id}`}
              className="group flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex h-36 items-center justify-center overflow-hidden bg-muted">
                {venue.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={venue.images[0]}
                    alt={venue.name}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <MapPin className="h-10 w-10 text-muted-foreground/40" aria-hidden />
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-4">
                <h2 className="font-semibold leading-snug group-hover:text-primary">
                  {venue.name}
                </h2>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {venue.city}, {venue.state}
                  </span>
                </p>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  Capacity {venue.capacity.toLocaleString('en-IN')}
                </p>
                <p className="mt-auto border-t pt-3 text-sm text-muted-foreground">
                  {venue._count.events} upcoming event{venue._count.events === 1 ? '' : 's'}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {result.pages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Pagination">
          {page > 1 && (
            <Link
              href={pageLink(page - 1)}
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
              href={pageLink(page + 1)}
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
