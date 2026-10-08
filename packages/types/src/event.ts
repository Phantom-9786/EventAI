// ── Event types ────────────────────────────────────

import type { PaginationQuery, DateRange, PriceRange, SortDirection } from './common';

export enum EventStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
  SOLDOUT = 'SOLDOUT',
}

export interface Event {
  id: string;
  title: string;
  slug: string;
  description: string;
  shortDescription?: string;
  categoryId: string;
  organizerId: string;
  venueId: string;
  images: string[];
  coverImage?: string;
  startDate: string;
  endDate: string;
  status: EventStatus;
  isFeatured: boolean;
  tags: string[];
  policies?: string;
  faqs?: EventFAQ[];
  cancellationPolicy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventFAQ {
  id: string;
  eventId: string;
  question: string;
  answer: string;
  order: number;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  color?: string;
  eventCount?: number;
}

export interface CreateEventRequest {
  title: string;
  description: string;
  shortDescription?: string;
  categoryId: string;
  venueId: string;
  startDate: string;
  endDate: string;
  tags?: string[];
  policies?: string;
  cancellationPolicy?: string;
}

export interface UpdateEventRequest extends Partial<CreateEventRequest> {
  status?: EventStatus;
}

export interface EventSearchQuery extends PaginationQuery {
  query?: string;
  categoryId?: string;
  city?: string;
  date?: DateRange;
  price?: PriceRange;
  status?: EventStatus;
  sortBy?: 'date' | 'price' | 'popularity' | 'createdAt';
  sortDir?: SortDirection;
  isFeatured?: boolean;
}

export interface EventSummary {
  id: string;
  title: string;
  slug: string;
  shortDescription?: string;
  coverImage?: string;
  startDate: string;
  endDate: string;
  status: EventStatus;
  category: { id: string; name: string; slug: string };
  venue: { id: string; name: string; city: string };
  organizer: { id: string; name: string };
  minPrice: number;
  maxPrice: number;
  isFeatured: boolean;
}
