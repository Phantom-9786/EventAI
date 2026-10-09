// ═══════════════════════════════════════════════════
// Server-side API client for the EventAI NestJS backend.
// All prices are integers in paise (INR).
// ═══════════════════════════════════════════════════

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  color: string | null;
  _count?: { events: number };
}

export interface EventSummary {
  id: string;
  title: string;
  slug: string;
  shortDescription: string | null;
  startDate: string;
  endDate: string;
  images: string[];
  isFeatured: boolean;
  minPrice: number | null;
  maxPrice: number | null;
  category: { id: string; name: string; slug: string };
  venue: { id: string; name: string; city: string };
  organizer: { id: string; organizationName: string };
}

export interface TicketTypeView {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  totalQuantity: number;
  availableQuantity: number;
  maxPerBooking: number;
  saleStartDate: string | null;
  saleEndDate: string | null;
  section: { id: string; name: string } | null;
}

export interface EventDetail extends EventSummary {
  description: string;
  tags: string[];
  policies: string | null;
  cancellationPolicy: string | null;
  category: { id: string; name: string; slug: string; icon: string | null; color: string | null };
  venue: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    country: string;
    latitude: number | null;
    longitude: number | null;
  };
  organizer: {
    id: string;
    organizationName: string;
    logo: string | null;
    isVerified: boolean;
  };
  ticketTypes: TicketTypeView[];
  faqs: { id: string; question: string; answer: string; order: number }[];
}

export interface Paginated {
  total: number;
  page: number;
  pages: number;
}

export interface EventsSearchResult extends Paginated {
  events: EventSummary[];
}

export interface EventSearchFilters {
  query?: string;
  category?: string;
  city?: string;
  sortBy?: 'date' | 'price' | 'popularity' | 'createdAt';
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${path}`);
  }
  return res.json() as Promise<T>;
}

export async function searchEvents(
  filters: EventSearchFilters = {},
): Promise<EventsSearchResult> {
  const params = new URLSearchParams();
  if (filters.query) params.set('query', filters.query);
  if (filters.category) params.set('category', filters.category);
  if (filters.city) params.set('city', filters.city);
  if (filters.sortBy) params.set('sortBy', filters.sortBy);
  if (filters.sortDir) params.set('sortDir', filters.sortDir);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return getJson<EventsSearchResult>(`/events${qs ? `?${qs}` : ''}`);
}

export async function getEvent(slug: string): Promise<EventDetail> {
  const { event } = await getJson<{ event: EventDetail }>(`/events/${encodeURIComponent(slug)}`);
  return event;
}

export async function getCategories(): Promise<Category[]> {
  const { categories } = await getJson<{ categories: Category[] }>('/categories');
  return categories;
}

/** Formats a paise integer as an INR display string (₹). */
export function formatPrice(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function formatPriceRange(min: number | null, max: number | null): string {
  if (min === null) return 'Price TBD';
  if (max !== null && max !== min) return `${formatPrice(min)} – ${formatPrice(max)}`;
  return formatPrice(min);
}

export function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
