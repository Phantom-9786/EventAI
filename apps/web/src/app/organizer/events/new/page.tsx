'use client';

import Link from 'next/link';
import { Wrench, ArrowLeft, ShieldAlert } from 'lucide-react';
import { EventForm } from '@/components/organizer/event-form';
import { OrganizerGate } from '@/components/organizer/organizer-gate';
import { useSystemControls } from '@/components/layout/maintenance-guard';

export default function NewOrganizerEventPage() {
  const { controls } = useSystemControls();
  const isMaintenance = Boolean(controls?.eventCreationMaintenance);
  const message =
    controls?.eventCreationMaintenanceMessage ||
    'New event creation is temporarily unavailable. Existing events remain accessible.';

  return (
    <OrganizerGate>
      <div>
        <Link href="/organizer/events" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> My events
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Create an event</h1>
        <p className="mb-6 mt-1 text-sm text-muted-foreground">
          This creates a draft. You can add ticket types and publish it from the management page.
        </p>

        {isMaintenance ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 sm:p-8 text-center max-w-xl mx-auto my-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400 mb-4">
              <Wrench className="h-7 w-7" />
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400 mb-3">
              <ShieldAlert className="h-3.5 w-3.5" />
              Event Creation Paused
            </span>
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              New Event Creation Unavailable
            </h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              {message}
            </p>
            <div className="mt-6">
              <Link
                href="/organizer/events"
                className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-all"
              >
                Return to My Events
              </Link>
            </div>
          </div>
        ) : (
          <EventForm />
        )}
      </div>
    </OrganizerGate>
  );
}
