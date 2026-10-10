'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  createOrganizerEvent,
  createOrganizerVenue,
  getOrganizerCategories,
  getOrganizerVenues,
  updateOrganizerEvent,
  type OrganizerCategory,
  type OrganizerEventDetail,
  type OrganizerEventInput,
  type OrganizerVenue,
} from '@/lib/organizer';

type EventFormValues = {
  title: string;
  description: string;
  shortDescription: string;
  categoryId: string;
  venueId: string;
  startDate: string;
  endDate: string;
  tags: string;
  policies: string;
  cancellationPolicy: string;
};

const emptyValues: EventFormValues = {
  title: '', description: '', shortDescription: '', categoryId: '', venueId: '',
  startDate: '', endDate: '', tags: '', policies: '', cancellationPolicy: '',
};

function toLocalDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function EventForm({
  event,
  onSaved,
}: {
  event?: OrganizerEventDetail;
  onSaved?: (event: OrganizerEventDetail) => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<EventFormValues>(emptyValues);
  const [categories, setCategories] = useState<OrganizerCategory[]>([]);
  const [venues, setVenues] = useState<OrganizerVenue[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showVenueForm, setShowVenueForm] = useState(false);
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [venueCity, setVenueCity] = useState('');
  const [venueState, setVenueState] = useState('');
  const [venueCapacity, setVenueCapacity] = useState('');
  const [savingVenue, setSavingVenue] = useState(false);
  const [venueError, setVenueError] = useState<string | null>(null);

  useEffect(() => {
    setValues(event ? {
      title: event.title,
      description: event.description,
      shortDescription: event.shortDescription ?? '',
      categoryId: event.categoryId,
      venueId: event.venueId,
      startDate: toLocalDateTime(event.startDate),
      endDate: toLocalDateTime(event.endDate),
      tags: event.tags.join(', '),
      policies: event.policies ?? '',
      cancellationPolicy: event.cancellationPolicy ?? '',
    } : emptyValues);
  }, [event]);

  useEffect(() => {
    let active = true;
    Promise.all([getOrganizerCategories(), getOrganizerVenues()])
      .then(([nextCategories, nextVenues]) => {
        if (!active) return;
        setCategories(nextCategories);
        setVenues(nextVenues);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load categories and venues.');
      })
      .finally(() => {
        if (active) setLoadingOptions(false);
      });
    return () => { active = false; };
  }, []);

  const setField = (name: keyof EventFormValues, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    setError(null);
    setNotice(null);
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const start = new Date(values.startDate);
    const end = new Date(values.endDate);
    if (Number.isNaN(start.getTime()) || (!event && start.getTime() <= Date.now())) {
      setError('Choose a valid start date and time in the future.');
      return;
    }
    if (Number.isNaN(end.getTime()) || end <= start) {
      setError('The end date and time must be after the start.');
      return;
    }
    const tags = values.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
    if (tags.length > 10 || tags.some((tag) => tag.length > 50)) {
      setError('Use at most 10 tags, each no longer than 50 characters.');
      return;
    }

    const input: OrganizerEventInput = {
      title: values.title.trim(),
      description: values.description.trim(),
      shortDescription: values.shortDescription.trim() || undefined,
      categoryId: values.categoryId,
      venueId: values.venueId,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      tags,
      policies: values.policies.trim() || undefined,
      cancellationPolicy: values.cancellationPolicy.trim() || undefined,
    };

    setSubmitting(true);
    try {
      const saved = event
        ? await updateOrganizerEvent(event.id, input)
        : await createOrganizerEvent(input);
      if (event) {
        onSaved?.(saved);
        setNotice('Event details saved.');
      } else {
        router.push(`/organizer/events/${encodeURIComponent(saved.id)}?created=1`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the event.');
    } finally {
      setSubmitting(false);
    }
  }

  async function saveVenue() {
    setVenueError(null);
    const capacity = Number(venueCapacity);
    if (venueName.trim().length < 2 || venueAddress.trim().length < 5 || venueCity.trim().length < 2 || venueState.trim().length < 2 || !Number.isInteger(capacity) || capacity < 1 || capacity > 100000) {
      setVenueError('Enter a venue name, address, city, state, and capacity (1–100,000).');
      return;
    }
    setSavingVenue(true);
    try {
      const venue = await createOrganizerVenue({
        name: venueName.trim(),
        address: venueAddress.trim(),
        city: venueCity.trim(),
        state: venueState.trim(),
        capacity,
      });
      setVenues((current) => [...current, venue]);
      setField('venueId', venue.id);
      setVenueName(''); setVenueAddress(''); setVenueCity(''); setVenueState(''); setVenueCapacity('');
      setShowVenueForm(false);
      setNotice('Venue created and selected.');
    } catch (err) {
      setVenueError(err instanceof Error ? err.message : 'Could not create the venue.');
    } finally {
      setSavingVenue(false);
    }
  }

  const inputClass = 'mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const textareaClass = 'mt-1 min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  if (loadingOptions) return <p className="animate-pulse text-sm text-muted-foreground" role="status">Loading your categories and venues…</p>;

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-5">
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-md border border-green-600/30 bg-green-600/10 px-3 py-2 text-sm">{notice}</p>}
      <div className="rounded-md border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Event venue</p>
          <Button type="button" variant="outline" size="sm" onClick={() => { setShowVenueForm((open) => !open); setVenueError(null); }}>
            {showVenueForm ? 'Close venue form' : 'Add a venue'}
          </Button>
        </div>
        {showVenueForm && <div className="mt-4 space-y-3">
          {venueError && <p role="alert" className="text-sm text-destructive">{venueError}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Name<input value={venueName} onChange={(e) => setVenueName(e.target.value)} maxLength={200} className={inputClass} /></label>
            <label className="text-sm">Address<input value={venueAddress} onChange={(e) => setVenueAddress(e.target.value)} maxLength={500} className={inputClass} /></label>
            <label className="text-sm">City<input value={venueCity} onChange={(e) => setVenueCity(e.target.value)} maxLength={100} className={inputClass} /></label>
            <label className="text-sm">State<input value={venueState} onChange={(e) => setVenueState(e.target.value)} maxLength={100} className={inputClass} /></label>
            <label className="text-sm">Capacity<input type="number" min="1" max="100000" step="1" value={venueCapacity} onChange={(e) => setVenueCapacity(e.target.value)} className={inputClass} /></label>
          </div>
          <Button type="button" disabled={savingVenue} onClick={() => void saveVenue()}>{savingVenue ? 'Saving venue…' : 'Save and select venue'}</Button>
        </div>}
      </div>
      <label className="block text-sm font-medium">Event title<input required minLength={3} maxLength={200} value={values.title} onChange={(e) => setField('title', e.target.value)} className={inputClass} /></label>
      <label className="block text-sm font-medium">Description<textarea required minLength={20} maxLength={10000} value={values.description} onChange={(e) => setField('description', e.target.value)} className={textareaClass} /></label>
      <label className="block text-sm font-medium">Short description (optional)<input maxLength={300} value={values.shortDescription} onChange={(e) => setField('shortDescription', e.target.value)} className={inputClass} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Category
          <select required value={values.categoryId} onChange={(e) => setField('categoryId', e.target.value)} className={inputClass}>
            <option value="">Choose a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">Venue
          <select required value={values.venueId} onChange={(e) => setField('venueId', e.target.value)} className={inputClass}>
            <option value="">Choose one of your venues</option>{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name} · {venue.city}</option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Starts<input required type="datetime-local" value={values.startDate} onChange={(e) => setField('startDate', e.target.value)} className={inputClass} /></label>
        <label className="block text-sm font-medium">Ends<input required type="datetime-local" value={values.endDate} onChange={(e) => setField('endDate', e.target.value)} className={inputClass} /></label>
      </div>
      <label className="block text-sm font-medium">Tags (comma separated, up to 10)<input value={values.tags} onChange={(e) => setField('tags', e.target.value)} className={inputClass} /></label>
      <label className="block text-sm font-medium">Event policies (optional)<textarea maxLength={5000} value={values.policies} onChange={(e) => setField('policies', e.target.value)} className={textareaClass} /></label>
      <label className="block text-sm font-medium">Cancellation policy (optional)<textarea maxLength={2000} value={values.cancellationPolicy} onChange={(e) => setField('cancellationPolicy', e.target.value)} className={textareaClass} /></label>
      <Button type="submit" disabled={submitting || venues.length === 0}>
        {submitting ? 'Saving…' : event ? 'Save changes' : 'Create draft event'}
      </Button>
    </form>
  );
}
