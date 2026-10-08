// ── Common types used across the platform ──────────

/** Standard API response wrapper */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: ApiError;
  meta?: PaginationMeta;
}

/** API error structure */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}

/** Pagination metadata */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/** Pagination query parameters */
export interface PaginationQuery {
  page?: number;
  limit?: number;
}

/** Sort direction */
export type SortDirection = 'asc' | 'desc';

/** Date range filter */
export interface DateRange {
  from?: string;
  to?: string;
}

/** Price range filter */
export interface PriceRange {
  min?: number;
  max?: number;
}

/** Coordinates */
export interface Coordinates {
  latitude: number;
  longitude: number;
}
