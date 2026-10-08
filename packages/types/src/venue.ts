// ── Venue types ────────────────────────────────────

import type { Coordinates } from './common';

export interface Venue {
  id: string;
  name: string;
  description?: string;
  address: string;
  city: string;
  state: string;
  zipCode?: string;
  country: string;
  coordinates?: Coordinates;
  capacity: number;
  images: string[];
  amenities: string[];
  organizerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVenueRequest {
  name: string;
  description?: string;
  address: string;
  city: string;
  state: string;
  zipCode?: string;
  country: string;
  latitude?: number;
  longitude?: number;
  capacity: number;
  amenities?: string[];
}

export interface UpdateVenueRequest extends Partial<CreateVenueRequest> {}

/** Seat section within a venue (e.g., "VIP", "Balcony", "Floor") */
export interface SeatSection {
  id: string;
  venueId: string;
  name: string;
  rows: number;
  seatsPerRow: number;
  totalSeats: number;
}

/** Individual seat */
export interface Seat {
  id: string;
  sectionId: string;
  row: string;
  number: number;
  label: string; // e.g., "A1", "B12"
  status: SeatStatus;
}

export enum SeatStatus {
  AVAILABLE = 'AVAILABLE',
  HELD = 'HELD',
  BOOKED = 'BOOKED',
  BLOCKED = 'BLOCKED',
}
