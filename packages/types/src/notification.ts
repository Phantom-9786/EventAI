// ── Notification types ─────────────────────────────

export enum NotificationType {
  BOOKING_CONFIRMED = 'BOOKING_CONFIRMED',
  PAYMENT_SUCCESS = 'PAYMENT_SUCCESS',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  TICKET_GENERATED = 'TICKET_GENERATED',
  EVENT_REMINDER = 'EVENT_REMINDER',
  BOOKING_CANCELLED = 'BOOKING_CANCELLED',
  REFUND_PROCESSED = 'REFUND_PROCESSED',
  TICKET_VALIDATED = 'TICKET_VALIDATED',
  EVENT_UPDATED = 'EVENT_UPDATED',
  EVENT_CANCELLED = 'EVENT_CANCELLED',
  SYSTEM = 'SYSTEM',
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  readAt?: string;
  createdAt: string;
}

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
  types: Partial<Record<NotificationType, boolean>>;
}
