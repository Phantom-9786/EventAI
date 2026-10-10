import { OrganizerEventEditor } from '@/components/organizer/event-editor';
import { OrganizerGate } from '@/components/organizer/organizer-gate';

export default function OrganizerEventManagePage({ params }: { params: { id: string } }) {
  return <OrganizerGate><OrganizerEventEditor id={params.id} /></OrganizerGate>;
}
