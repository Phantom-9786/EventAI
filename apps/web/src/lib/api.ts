// ═══════════════════════════════════════════════════
// API client for the EventAI Express backend.
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
  coverImage?: string | null;
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
  aiFilters?: string;
  venueId?: string;
  query?: string;
  category?: string;
  city?: string;
  sortBy?: 'date' | 'price' | 'popularity' | 'createdAt';
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

async function getJson<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (typeof window !== 'undefined') {
    try {
      let token = window.localStorage.getItem('eventai_access_token');
      if (!token && typeof document !== 'undefined') {
        const match = document.cookie.match(
          /(?:^|;\s*)(?:eventai_access_token|accessToken|access_token)=([^;]+)/,
        );
        if (match) token = decodeURIComponent(match[1]);
      }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch {
      // localStorage unavailable
    }
  } else {
    try {
      const { cookies, headers: getIncomingHeaders } = await import('next/headers');
      const incomingHeaders = getIncomingHeaders();
      const authHeader = incomingHeaders.get('authorization');
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
      const cookieStore = cookies();
      const token =
        cookieStore.get('eventai_access_token')?.value ||
        cookieStore.get('accessToken')?.value ||
        cookieStore.get('access_token')?.value;
      if (token && !headers['Authorization']) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const rawCookie = incomingHeaders.get('cookie');
      if (rawCookie) {
        headers['Cookie'] = rawCookie;
      }
    } catch {
      // outside request context or static generation
    }
  }

  const res = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    headers,
    ...(typeof window !== 'undefined' ? { credentials: 'include' as const } : {}),
  });
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`API request failed: ${res.status} ${path}${errorBody ? ` - ${errorBody}` : ''}`);
  }
  return res.json() as Promise<T>;
}

export async function searchEvents(
  filters: EventSearchFilters = {},
): Promise<EventsSearchResult> {
  const params = new URLSearchParams();
  if (filters.venueId) params.set('venueId', filters.venueId);
  if (filters.query) params.set('query', filters.query);
  if (filters.category) params.set('category', filters.category);
  if (filters.city) params.set('city', filters.city);
  if (filters.aiFilters) params.set('aiFilters', filters.aiFilters);
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

export async function getSimilarEvents(slug: string, limit = 4): Promise<EventSummary[]> {
  const { events } = await getJson<{ events: EventSummary[] }>(
    `/events/${encodeURIComponent(slug)}/similar?limit=${limit}`,
  );
  return events;
}

export async function getCategories(): Promise<Category[]> {
  const { categories } = await getJson<{ categories: Category[] }>('/categories');
  return categories;
}

export interface VenueSummary {
  id: string;
  name: string;
  city: string;
  state: string;
  address: string;
  capacity: number;
  images: string[];
  amenities: string[];
  _count: { events: number };
}

export interface VenueSearchResult extends Paginated {
  venues: VenueSummary[];
}

export interface VenueDetail extends VenueSummary {
  description: string | null;
  zipCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  organizer: { id: string; organizationName: string; isVerified: boolean };
  seatSections: {
    id: string;
    name: string;
    rows: number;
    seatsPerRow: number;
    totalSeats: number;
  }[];
}

export async function getVenues(
  filters: { city?: string; query?: string; page?: number; limit?: number } = {},
): Promise<VenueSearchResult> {
  const params = new URLSearchParams();
  if (filters.city) params.set('city', filters.city);
  if (filters.query) params.set('query', filters.query);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return getJson<VenueSearchResult>(`/venues${qs ? `?${qs}` : ''}`);
}

export async function getVenue(id: string): Promise<VenueDetail> {
  const { venue } = await getJson<{ venue: VenueDetail }>(`/venues/${encodeURIComponent(id)}`);
  return venue;
}

/** Formats a paise integer as an INR display string (₹). */
export function formatPrice(paise: number | null | undefined): string {
  if (typeof paise !== 'number' || !Number.isFinite(paise) || Number.isNaN(paise)) {
    return '₹0';
  }
  return `₹${Math.round(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function formatPriceRange(min: number | null | undefined, max: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return 'Price TBD';
  if (max !== null && max !== undefined && Number.isFinite(max) && max !== min) {
    return `${formatPrice(min)} – ${formatPrice(max)}`;
  }
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
