import {
  Bell,
  CalendarDays,
  Compass,
  Heart,
  LayoutDashboard,
  MapPin,
  QrCode,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
} from 'lucide-react';

export const attendee = [
  ['/overview', 'My Dashboard', LayoutDashboard],
  ['/events', 'Discover events', Compass],
  ['/bookings', 'My bookings', CalendarDays],
  ['/tickets', 'Digital tickets', Ticket],
  ['/calendar', 'My calendar', CalendarDays],
  ['/overview?view=saved', 'Saved events', Heart],
  ['/venues', 'Venues', MapPin],
  ['/ai', 'AI assistant', Sparkles],
  ['/notifications', 'Notifications', Bell],
  ['/account', 'Profile & settings', Settings],
] as const;
export const organizer = [
  ['/dashboard', 'Overview', LayoutDashboard],
  ['/organizer/analytics', 'Analytics', LayoutDashboard],
  ['/organizer/events', 'My events', CalendarDays],
  ['/organizer/events/new', 'Create event', CalendarDays],
  ['/organizer/venues', 'My venues', MapPin],
  ['/organizer/attendees', 'Attendees', Users],
  ['/dashboard/scan', 'Ticket validation', QrCode],
  ['/organizer/refunds', 'Refund requests', RotateCcw],

  ['/organizer/settings', 'Organization settings', Settings],
] as const;
export const admin = [
  ['/admin?tab=overview', 'Admin Dashboard', LayoutDashboard],
  ['/admin?tab=users', 'Users', Users],
  ['/admin?tab=events', 'Event moderation', CalendarDays],
  ['/admin?tab=organizers', 'Organizers & applications', ShieldCheck],
  ['/admin?tab=bookings', 'Bookings & payments', Ticket],
  ['/admin?tab=system-controls', 'System controls', Settings],
  ['/admin?tab=team', 'Team & access', Users],
  ['/admin?tab=audit-logs', 'Audit logs', LayoutDashboard],
] as const;

