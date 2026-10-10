import { OrganizerGate } from '@/components/organizer/organizer-gate';
import { OrganizerEventsList } from '@/components/organizer/events-list';

export default function OrganizerEventsPage() {
  return <OrganizerGate><OrganizerEventsList /></OrganizerGate>;
}
