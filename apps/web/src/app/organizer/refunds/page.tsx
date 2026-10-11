import { OrganizerGate } from '@/components/organizer/organizer-gate';
import { OrganizerRefundRequests } from '@/components/organizer/refund-requests';

export default function OrganizerRefundRequestsPage() {
  return (
    <OrganizerGate>
      <OrganizerRefundRequests />
    </OrganizerGate>
  );
}
