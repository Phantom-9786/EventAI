import type { Metadata } from 'next';
import {
  getCategories,
  searchEvents,
  type Category,
  type EventsSearchResult,
} from '@/lib/api';
import { EventsContainer } from '@/components/events/events-container';

interface EventsPageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Discover Events',
  description:
    'Browse and search upcoming events — concerts, conferences, sports and more.',
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const aiFilters = first(searchParams.aiFilters);
  const query = first(searchParams.q);
  const category = first(searchParams.category);
  const city = first(searchParams.city);
  const sort = first(searchParams.sort) ?? 'date:asc';
  const [sortBy, sortDir] = sort.split(':') as [string, string];
  const page = Math.max(1, Number.parseInt(first(searchParams.page) ?? '1', 10) || 1);

  const filter = first(searchParams.filter);
  const currentFilters = { q: query, category, city, sort, filter, aiFilters, page: String(page) };

  let categories: Category[] = [];
  let result: EventsSearchResult = { events: [], total: 0, page: 1, pages: 1 };
  let isMaintenanceBlocked = false;
  let maintenanceMessage: string | null = null;
  let loadFailed = false;

  try {
    const [fetchedCategories, fetchedResult] = await Promise.all([
      getCategories().catch(() => []),
      searchEvents({
        aiFilters,
        query,
        category,
        city,
        sortBy: sortBy as 'date' | 'price' | 'popularity' | 'createdAt',
        sortDir: sortDir as 'asc' | 'desc',
        page,
        limit: 12,
      }),
    ]);
    categories = fetchedCategories;
    result = fetchedResult;
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    if (errMessage.includes('503') || errMessage.toLowerCase().includes('maintenance')) {
      isMaintenanceBlocked = true;
      try {
        const jsonMatch = errMessage.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.message) maintenanceMessage = parsed.message;
        }
      } catch {
        maintenanceMessage = null;
      }
    } else {
      loadFailed = true;
    }
  }

  return (
    <div className="wrap ep-discovery-page">
      <div className="discover-banner">
        <div className="circle-art" aria-hidden="true" />
        <p className="small-label">Find your kind of moment</p>
        <h1>Discover something good.</h1>
        <p>New experiences. Familiar favourites. All in one place.</p>
      </div>
      <EventsContainer
        categories={categories}
        initialResult={result}
        initialMaintenanceBlocked={isMaintenanceBlocked}
        initialMaintenanceMessage={maintenanceMessage}
        initialLoadFailed={loadFailed}
        currentFilters={currentFilters}
      />
    </div>
  );
}
