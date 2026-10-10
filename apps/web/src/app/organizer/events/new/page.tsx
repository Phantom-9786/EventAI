import Link from 'next/link';
import { EventForm } from '@/components/organizer/event-form';
import { OrganizerGate } from '@/components/organizer/organizer-gate';

export default function NewOrganizerEventPage() {
  return (
    <OrganizerGate>
      <div>
        <Link href="/organizer/events" className="text-sm text-primary hover:underline">← My events</Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Create an event</h1>
        <p className="mb-6 mt-1 text-sm text-muted-foreground">This creates a draft. You can add ticket types and publish it from the management page.</p>
        <EventForm />
      </div>
    </OrganizerGate>
  );
}
