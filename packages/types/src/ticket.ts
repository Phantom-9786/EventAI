// ── Ticket types ───────────────────────────────────

export interface TicketType {
  id: string;
  eventId: string;
  name: string;
  description?: string;
  price: number; // in paise (INR smallest unit)
  currency: string;
  totalQuantity: number;
  availableQuantity: number;
  maxPerBooking: number;
  saleStartDate?: string;
  saleEndDate?: string;
  sectionId?: string; // linked to a seat section if applicable
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTicketTypeRequest {
  name: string;
  description?: string;
  price: number;
  totalQuantity: number;
  maxPerBooking?: number;
  saleStartDate?: string;
  saleEndDate?: string;
  sectionId?: string;
}

export interface UpdateTicketTypeRequest extends Partial<CreateTicketTypeRequest> {
  isActive?: boolean;
}

/** Digital ticket issued after booking confirmation */
export interface Ticket {
  id: string;
  bookingId: string;
  bookingItemId: string;
  ticketTypeId: string;
  eventId: string;
  userId: string;
  ticketCode: string; // unique code for QR
  qrData: string; // QR code data
  seatLabel?: string;
  holderName: string;
  status: TicketStatus;
  validatedAt?: string;
  validatedBy?: string;
  createdAt: string;
}

export enum TicketStatus {
  VALID = 'VALID',
  USED = 'USED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

/** Ticket validation result */
export interface TicketValidationResult {
  isValid: boolean;
  ticket?: Ticket;
  event?: { id: string; title: string; startDate: string };
  message: string;
}
