'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CalendarDays,
  FileText,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  createOrganizerEvent,
  createOrganizerVenue,
  getOrganizerCategories,
  getOrganizerVenues,
  updateOrganizerEvent,
  uploadOrganizerMedia,
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
  coverImage: string;
  images: string;
};

const emptyValues: EventFormValues = {
  title: '',
  description: '',
  shortDescription: '',
  categoryId: '',
  venueId: '',
  startDate: '',
  endDate: '',
  tags: '',
  policies: '',
  cancellationPolicy: '',
  coverImage: '',
  images: '',
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
  const [categoryLoadError, setCategoryLoadError] = useState<string | null>(null);
  const [venues, setVenues] = useState<OrganizerVenue[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Inline venue creation
  const [showVenueForm, setShowVenueForm] = useState(false);
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [venueCity, setVenueCity] = useState('');
  const [venueState, setVenueState] = useState('');
  const [venueCapacity, setVenueCapacity] = useState('');
  const [venueLatitude, setVenueLatitude] = useState('');
  const [venueLongitude, setVenueLongitude] = useState('');
  const [savingVenue, setSavingVenue] = useState(false);
  const [venueError, setVenueError] = useState<string | null>(null);

  const [step, setStep] = useState(0);
  const steps = [
    { label: 'Basics', icon: FileText },
    { label: 'Venue & category', icon: MapPin },
    { label: 'Schedule', icon: CalendarDays },
    { label: 'Media & policies', icon: ImageIcon },
  ];

  useEffect(() => {
    setValues(
      event
        ? {
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
            coverImage: event.coverImage ?? '',
            images: event.images?.join('\n') ?? '',
          }
        : emptyValues,
    );
  }, [event]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([getOrganizerCategories(), getOrganizerVenues()])
      .then(([categoryResult, venueResult]) => {
        if (!active) return;
        if (categoryResult.status === 'fulfilled') {
          setCategories(categoryResult.value);
        } else {
          setCategoryLoadError(
            categoryResult.reason instanceof Error
              ? categoryResult.reason.message
              : 'Could not load event categories.',
          );
        }
        if (venueResult.status === 'fulfilled') {
          setVenues(venueResult.value);
        } else {
          setError(
            venueResult.reason instanceof Error
              ? venueResult.reason.message
              : 'Could not load your venues.',
          );
        }
      })
      .finally(() => {
        if (active) setLoadingOptions(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const setField = (name: keyof EventFormValues, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    setError(null);
    setNotice(null);
  };

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    setError(null);
    try {
      const url = await uploadOrganizerMedia(file, event?.id);
      setField('coverImage', url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload cover image');
    } finally {
      setUploadingCover(false);
      e.target.value = '';
    }
  }

  async function handleGalleryUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingGallery(true);
    setError(null);
    try {
      const url = await uploadOrganizerMedia(file, event?.id);
      const existing = values.images
        .split('\n')
        .map((img) => img.trim())
        .filter(Boolean);
      setField('images', [...existing, url].join('\n'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload gallery image');
    } finally {
      setUploadingGallery(false);
      e.target.value = '';
    }
  }

  async function saveVenue() {
    setVenueError(null);
    const capacity = Number(venueCapacity);
    const latitude = venueLatitude.trim() ? Number(venueLatitude) : undefined;
    const longitude = venueLongitude.trim() ? Number(venueLongitude) : undefined;
    if (
      venueName.trim().length < 2 ||
      venueAddress.trim().length < 5 ||
      venueCity.trim().length < 2 ||
      venueState.trim().length < 2 ||
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 100000
    ) {
      setVenueError('Enter a valid venue name, address, city, state, and capacity (1–100,000).');
      return;
    }
    if (
      (latitude === undefined) !== (longitude === undefined) ||
      (latitude !== undefined && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
      (longitude !== undefined && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))
    ) {
      setVenueError('Enter both valid latitude and longitude coordinates, or leave both blank.');
      return;
    }
    setSavingVenue(true);
    try {
      const created = await createOrganizerVenue({
        name: venueName.trim(),
        address: venueAddress.trim(),
        city: venueCity.trim(),
        state: venueState.trim(),
        capacity,
        latitude,
        longitude,
      });
      setVenues((current) => [...current, created]);
      setField('venueId', created.id);
      setVenueName('');
      setVenueAddress('');
      setVenueCity('');
      setVenueState('');
      setVenueCapacity('');
      setVenueLatitude('');
      setVenueLongitude('');
      setShowVenueForm(false);
      setNotice('Venue created and selected.');
    } catch (err) {
      setVenueError(err instanceof Error ? err.message : 'Could not create the venue.');
    } finally {
      setSavingVenue(false);
    }
  }

  function continueToNextStep() {
    if (step === 0) {
      if (values.title.trim().length < 3 || values.description.trim().length < 20) {
        setError('Enter an event title and a description of at least 20 characters before continuing.');
        return;
      }
    }
    if (step === 1) {
      if (!values.categoryId || !values.venueId) {
        setError('Choose an event category and venue before continuing.');
        return;
      }
    }
    if (step === 2) {
      const start = new Date(values.startDate);
      const end = new Date(values.endDate);
      if (
        Number.isNaN(start.getTime()) ||
        (!event && start.getTime() <= Date.now()) ||
        Number.isNaN(end.getTime()) ||
        end <= start
      ) {
        setError('Choose a valid schedule; the end must be after a future start.');
        return;
      }
    }
    setError(null);
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  function backToPreviousStep() {
    setError(null);
    setStep((current) => Math.max(current - 1, 0));
  }

  async function retryCategoryLoad() {
    setCategoryLoadError(null);
    try {
      setCategories(await getOrganizerCategories());
    } catch (err) {
      setCategoryLoadError(
        err instanceof Error ? err.message : 'Could not load event categories.',
      );
    }
  }

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

    const tags = values.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (tags.length > 10 || tags.some((tag) => tag.length > 50)) {
      setError('Use at most 10 tags, each no longer than 50 characters.');
      return;
    }

    const coverImage = values.coverImage.trim();
    const images = values.images
      .split('\n')
      .map((image) => image.trim())
      .filter(Boolean);
    if (coverImage && !images.includes(coverImage)) {
      images.unshift(coverImage);
    }
    if (images.length > 10) {
      setError('Use at most 10 event image URLs, including the cover image.');
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
      coverImage: event ? coverImage || null : coverImage || undefined,
      images,
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

  const galleryList = values.images
    .split('\n')
    .map((img) => img.trim())
    .filter(Boolean);

  const inputClass =
    'mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const textareaClass =
    'mt-1 min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  if (loadingOptions) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading your categories and venues…</span>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-5">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-green-600/30 bg-green-600/10 px-4 py-3 text-sm text-green-700 dark:text-green-300"
        >
          {notice}
        </div>
      )}
      {categoryLoadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <span>Could not load event categories: {categoryLoadError}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void retryCategoryLoad()}>
            Retry categories
          </Button>
        </div>
      )}

      {/* Stepper Navigation */}
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Event setup steps">
        {steps.map((s, index) => (
          <li
            key={s.label}
            aria-current={step === index ? 'step' : undefined}
            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
              step === index
                ? 'border-primary bg-primary/5 font-medium text-primary'
                : 'text-muted-foreground'
            }`}
          >
            <span className="mr-2">{index + 1}.</span>
            {s.label}
          </li>
        ))}
      </ol>

      {/* Step 0: Basics */}
      {step === 0 && (
        <section className="space-y-4" aria-label="Event basics">
          <div>
            <label htmlFor="event-title" className="block text-sm font-medium">
              Event title
            </label>
            <input
              id="event-title"
              required
              minLength={3}
              maxLength={200}
              placeholder="e.g. Mumbai Music Night"
              value={values.title}
              onChange={(e) => setField('title', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="event-description" className="block text-sm font-medium">
              Description
            </label>
            <textarea
              id="event-description"
              required
              minLength={20}
              maxLength={10000}
              placeholder="A live music evening featuring independent artists in Mumbai."
              value={values.description}
              onChange={(e) => setField('description', e.target.value)}
              className={textareaClass}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              {values.description.length}/10,000 characters (minimum 20 characters required)
            </span>
          </div>
          <div>
            <label htmlFor="event-short-desc" className="block text-sm font-medium">
              Short description (optional)
            </label>
            <input
              id="event-short-desc"
              maxLength={300}
              placeholder="Brief summary for discovery cards"
              value={values.shortDescription}
              onChange={(e) => setField('shortDescription', e.target.value)}
              className={inputClass}
            />
          </div>
        </section>
      )}

      {/* Step 1: Venue and category */}
      {step === 1 && (
        <section className="space-y-4" aria-label="Event category and venue">
          <div className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Event venue</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowVenueForm((open) => !open);
                  setVenueError(null);
                }}
              >
                {showVenueForm ? 'Close venue form' : 'Add a venue'}
              </Button>
            </div>
            {showVenueForm && (
              <div className="mt-4 space-y-3">
                {venueError && (
                  <p role="alert" className="text-xs text-destructive">
                    {venueError}
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium">
                    Name
                    <input
                      value={venueName}
                      onChange={(e) => setVenueName(e.target.value)}
                      maxLength={200}
                      className={inputClass}
                    />
                  </label>
                  <label className="text-xs font-medium">
                    Address
                    <input
                      value={venueAddress}
                      onChange={(e) => setVenueAddress(e.target.value)}
                      maxLength={500}
                      className={inputClass}
                    />
                  </label>
                  <label className="text-xs font-medium">
                    City
                    <input
                      value={venueCity}
                      onChange={(e) => setVenueCity(e.target.value)}
                      maxLength={100}
                      className={inputClass}
                    />
                  </label>
                  <label className="text-xs font-medium">
                    State
                    <input
                      value={venueState}
                      onChange={(e) => setVenueState(e.target.value)}
                      maxLength={100}
                      className={inputClass}
                    />
                  </label>
                  <label className="text-xs font-medium">
                    Capacity
                    <input
                      type="number"
                      min="1"
                      max="100000"
                      step="1"
                      value={venueCapacity}
                      onChange={(e) => setVenueCapacity(e.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs font-medium">
                      Latitude
                      <input
                        type="number"
                        min="-90"
                        max="90"
                        step="any"
                        value={venueLatitude}
                        onChange={(e) => setVenueLatitude(e.target.value)}
                        className={inputClass}
                      />
                    </label>
                    <label className="text-xs font-medium">
                      Longitude
                      <input
                        type="number"
                        min="-180"
                        max="180"
                        step="any"
                        value={venueLongitude}
                        onChange={(e) => setVenueLongitude(e.target.value)}
                        className={inputClass}
                      />
                    </label>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={savingVenue}
                  onClick={() => void saveVenue()}
                >
                  {savingVenue ? 'Saving venue…' : 'Save and select venue'}
                </Button>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="event-category" className="block text-sm font-medium">
                Category
              </label>
              <select
                id="event-category"
                aria-label="Category"
                required
                value={values.categoryId}
                onChange={(e) => setField('categoryId', e.target.value)}
                className={inputClass}
              >
                <option value="">Choose a category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="event-venue" className="block text-sm font-medium">
                Venue
              </label>
              <select
                id="event-venue"
                aria-label="Venue"
                required
                value={values.venueId}
                onChange={(e) => setField('venueId', e.target.value)}
                className={inputClass}
              >
                <option value="">Choose one of your venues</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name} · {venue.city}
                    {venue.capacity ? ` (Capacity: ${venue.capacity.toLocaleString('en-IN')})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {venues.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Create a venue above before continuing.
            </p>
          )}
        </section>
      )}

      {/* Step 2: Schedule */}
      {step === 2 && (
        <section className="space-y-4" aria-label="Event schedule">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="event-starts" className="block text-sm font-medium">
                Starts
              </label>
              <input
                id="event-starts"
                required
                type="datetime-local"
                value={values.startDate}
                onChange={(e) => setField('startDate', e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="event-ends" className="block text-sm font-medium">
                Ends
              </label>
              <input
                id="event-ends"
                required
                type="datetime-local"
                value={values.endDate}
                onChange={(e) => setField('endDate', e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <label className="block text-sm font-medium">
            Tags (comma separated, up to 10)
            <input
              placeholder="e.g. concert, indie, live music"
              value={values.tags}
              onChange={(e) => setField('tags', e.target.value)}
              className={inputClass}
            />
          </label>
        </section>
      )}

      {/* Step 3: Media and policies */}
      {step === 3 && (
        <section className="space-y-4" aria-label="Event media and policies">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="cover-url" className="block text-sm font-medium">
                Cover image URL (optional)
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">
                <Upload className="h-3.5 w-3.5" />
                {uploadingCover ? 'Uploading…' : 'Upload cover'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={uploadingCover}
                  onChange={(e) => void handleCoverUpload(e)}
                />
              </label>
            </div>
            <input
              id="cover-url"
              type="url"
              maxLength={2048}
              value={values.coverImage}
              onChange={(e) => setField('coverImage', e.target.value)}
              className={inputClass}
              placeholder="https://example.com/event-cover.jpg"
            />
            {values.coverImage && (
              <div className="relative mt-2 h-36 w-full max-w-sm overflow-hidden rounded-md border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={values.coverImage}
                  alt="Cover preview"
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setField('coverImage', '')}
                  className="absolute right-1.5 top-1.5 rounded-full bg-background/80 p-1 text-foreground hover:bg-background"
                  aria-label="Remove cover image"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="gallery-urls" className="block text-sm font-medium">
                Additional image URLs (one per line, up to 10 total)
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">
                <Upload className="h-3.5 w-3.5" />
                {uploadingGallery ? 'Uploading…' : 'Upload image'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={uploadingGallery}
                  onChange={(e) => void handleGalleryUpload(e)}
                />
              </label>
            </div>
            <textarea
              id="gallery-urls"
              maxLength={20480}
              value={values.images}
              onChange={(e) => setField('images', e.target.value)}
              className={textareaClass}
              placeholder="https://example.com/event-gallery.jpg"
            />
            {galleryList.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {galleryList.map((url, i) => (
                  <div key={url + i} className="group relative h-20 overflow-hidden rounded-md border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Gallery ${i + 1}`} className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="block text-sm font-medium">
            Event policies (optional)
            <textarea
              maxLength={5000}
              value={values.policies}
              onChange={(e) => setField('policies', e.target.value)}
              className={textareaClass}
              placeholder="e.g. Valid government photo ID required at door."
            />
          </label>
          <label className="block text-sm font-medium">
            Cancellation policy (optional)
            <textarea
              maxLength={2000}
              value={values.cancellationPolicy}
              onChange={(e) => setField('cancellationPolicy', e.target.value)}
              className={textareaClass}
              placeholder="e.g. Full refund upon organizer cancellation."
            />
          </label>
        </section>
      )}

      {/* Stepper Footer Controls */}
      <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={backToPreviousStep}
          disabled={step === 0 || submitting}
        >
          Back
        </Button>
        {step < steps.length - 1 ? (
          <Button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              continueToNextStep();
            }}
            disabled={step === 1 && categories.length === 0}
          >
            Continue
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={submitting || venues.length === 0 || categories.length === 0}
          >
            {submitting
              ? 'Saving…'
              : event
                ? 'Save draft changes'
                : 'Create draft event'}
          </Button>
        )}
      </div>
    </form>
  );
}
