'use client';
import { RefreshButton } from '@/components/ui/refresh-button';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { OrganizerGate } from '@/components/organizer/organizer-gate';
import { Button } from '@/components/ui/button';
import {
  getOrganizerVenues,
  createOrganizerVenue,
  type OrganizerVenue,
} from '@/lib/organizer';
function Venues() {
  const [venues, setVenues] = useState<OrganizerVenue[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadingVenues, setLoadingVenues] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setLoadingVenues(true);
    getOrganizerVenues()
      .then((data) => {
        if (live) setVenues(data);
      })
      .catch(() => {
        if (live) setError('Unable to load your venues.');
      })
      .finally(() => {
        if (live) setLoadingVenues(false);
      });
    return () => {
      live = false;
    };
  }, [revision]);
  return (
    <div>
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-sm text-primary">Organizer workspace</p>
          <h1 className="mt-2 text-3xl font-bold">Give your event a place to belong.</h1>
          <p className="mt-3 text-muted-foreground">
            Manage your venues and create a location for your next event.
          </p>
        </div>
        <RefreshButton
          variant="outline"
          disabled={loadingVenues}
          refreshing={loadingVenues}
          onClick={() => setRevision((n) => n + 1)}
        />
      </div>
      {error && (
        <p role="alert" className="my-5 text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="my-5 text-emerald-600">
          {notice}
        </p>
      )}
      <div className="my-7 grid gap-4 sm:grid-cols-2">
        {venues.map((v) => (
          <Link
            href={'/venues/' + v.id}
            key={v.id}
            className="rounded-2xl border bg-card p-6 hover:border-primary"
          >
            <h2 className="text-lg font-semibold">{v.name}</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {v.address}, {v.city}, {v.state}
            </p>
            <p className="mt-3 text-sm">Capacity: {v.capacity ?? 'Not specified'}</p>
            <span className="mt-4 block text-sm text-primary">View venue →</span>
          </Link>
        ))}
      </div>
      <section className="rounded-2xl border bg-card p-6">
        <h2 className="text-xl font-semibold">Create a venue</h2>
        <form
          className="mt-5 grid gap-5 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            setBusy(true);
            setError('');
            setNotice('');
            try {
              await createOrganizerVenue({
                name: String(f.get('name')),
                address: String(f.get('address')),
                city: String(f.get('city')),
                state: String(f.get('state')),
                capacity: Number(f.get('capacity')),
              });
              form.reset();
              setRevision((n) => n + 1);
              setNotice('Venue created successfully.');
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Unable to create venue.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {[
            ['Venue name', 'name'],
            ['Address', 'address'],
            ['City', 'city'],
            ['State', 'state'],
          ].map(([label, name]) => (
            <label key={name} className="text-sm font-medium">
              {label}
              <input
                name={name}
                required
                maxLength={250}
                className="mt-2 block w-full rounded-xl border bg-background p-3"
              />
            </label>
          ))}
          <label className="text-sm font-medium">
            Capacity
            <input
              name="capacity"
              type="number"
              min="1"
              step="1"
              max="1000000"
              required
              className="mt-2 block w-full rounded-xl border bg-background p-3"
            />
          </label>
          <div className="self-end">
            <Button disabled={busy} type="submit">
              {busy ? 'Saving…' : 'Create venue'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
export default function Page() {
  return (
    <OrganizerGate>
      <Venues />
    </OrganizerGate>
  );
}
