'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Plus,
  Ticket,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { formatEventDate, formatPrice } from '@/lib/api';
import {
  createOrganizerEvent,
  createOrganizerTicketType,
  createOrganizerVenue,
  deleteOrganizerTicketType,
  getOrganizerCategories,
  getOrganizerVenues,
  getUploadConfig,
  publishOrganizerEvent,
  submitOrganizerEventForReview,
  updateOrganizerEvent,
  updateOrganizerTicketType,
  uploadOrganizerMedia,
  deleteOrganizerMedia,
  type OrganizerCategory,
  type OrganizerEventDetail,
  type OrganizerEventInput,
  type OrganizerTicketType,
  type OrganizerTicketTypeInput,
  type OrganizerVenue,
  type UploadConfig,
} from '@/lib/organizer';
import { cn } from '@/lib/utils';

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

function TicketInlineForm({
  ticket,
  onSave,
  onCancel,
}: {
  ticket?: OrganizerTicketType;
  onSave: (input: OrganizerTicketTypeInput & { isActive?: boolean }) => Promise<void>;
  onCancel?: () => void;
}) {
  const sold = ticket ? ticket.totalQuantity - ticket.availableQuantity : 0;
  const [name, setName] = useState(ticket?.name ?? '');
  const [description, setDescription] = useState(ticket?.description ?? '');
  const [price, setPrice] = useState(ticket ? (ticket.price / 100).toFixed(2) : '0');
  const [quantity, setQuantity] = useState(String(ticket?.totalQuantity ?? 50));
  const [maxPerBooking, setMaxPerBooking] = useState(String(ticket?.maxPerBooking ?? 5));
  const [saleStart, setSaleStart] = useState(toLocalDateTime(ticket?.saleStartDate ?? null));
  const [saleEnd, setSaleEnd] = useState(toLocalDateTime(ticket?.saleEndDate ?? null));
  const [isActive, setIsActive] = useState(ticket?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const numericPrice = Number(price);
    const numericQuantity = Number(quantity);
    const numericMax = Number(maxPerBooking);

    if (!name.trim()) {
      setError('Ticket name is required.');
      return;
    }
    if (!Number.isFinite(numericPrice) || numericPrice < 0 || numericPrice * 100 > Number.MAX_SAFE_INTEGER) {
      setError('Enter a valid non-negative price in rupees.');
      return;
    }
    if (!Number.isInteger(numericQuantity) || numericQuantity < Math.max(1, sold)) {
      setError(`Inventory must be a whole number of at least ${Math.max(1, sold)} (already booked: ${sold}).`);
      return;
    }
    if (!Number.isInteger(numericMax) || numericMax < 1 || numericMax > 10) {
      setError('Maximum tickets per booking must be between 1 and 10.');
      return;
    }

    const start = saleStart ? new Date(saleStart) : null;
    const end = saleEnd ? new Date(saleEnd) : null;
    if (start && end && end <= start) {
      setError('Sale end date must be after sale start date.');
      return;
    }

    const input: OrganizerTicketTypeInput & { isActive?: boolean } = {
      name: name.trim(),
      description: description.trim() || undefined,
      price: Math.round(numericPrice * 100),
      totalQuantity: numericQuantity,
      maxPerBooking: numericMax,
      saleStartDate: start?.toISOString(),
      saleEndDate: end?.toISOString(),
      ...(ticket ? { isActive } : {}),
    };

    setSaving(true);
    try {
      await onSave(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the ticket type.');
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm';
  return (
    <form onSubmit={submit} className="ep-surface-inset space-y-3 rounded-lg border bg-muted/20 p-4">
      {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium">
          Ticket name <span className="text-destructive">*</span>
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. General Admission" />
        </label>
        <label className="text-xs font-medium">
          Price (INR) <span className="text-destructive">*</span>
          <input required type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} placeholder="0 for free" />
        </label>
        <label className="text-xs font-medium">
          Total inventory <span className="text-destructive">*</span>
          <input required type="number" min={Math.max(1, sold)} step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium">
          Max per booking (1–10) <span className="text-destructive">*</span>
          <input required type="number" min="1" max="10" step="1" value={maxPerBooking} onChange={(e) => setMaxPerBooking(e.target.value)} className={inputClass} />
        </label>
        <div className="col-span-full grid gap-3 sm:grid-cols-2">
          <DateTimePicker
            label="Sale window start (optional)"
            value={saleStart}
            onChange={setSaleStart}
            showQuickChips={false}
          />
          <DateTimePicker
            label="Sale window end (optional)"
            value={saleEnd}
            onChange={setSaleEnd}
            showQuickChips={false}
          />
        </div>
      </div>
      <label className="block text-xs font-medium">
        Description (optional)
        <textarea maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 min-h-16 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs" placeholder="What is included with this ticket?" />
      </label>
      {ticket && (
        <label className="flex items-center gap-2 text-xs font-medium">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded" />
          Available for sale
        </label>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : ticket ? 'Save changes' : 'Add ticket type'}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function EventForm({
  event,
  onSaved,
}: {
  event?: OrganizerEventDetail;
  onSaved?: (event: OrganizerEventDetail) => void;
}) {
  const [eventState, setEventState] = useState<OrganizerEventDetail | undefined>(event);
  const [values, setValues] = useState<EventFormValues>(() =>
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

  const [categories, setCategories] = useState<OrganizerCategory[]>([]);
  const [venues, setVenues] = useState<OrganizerVenue[]>([]);
  const [tickets, setTickets] = useState<OrganizerTicketType[]>(event?.ticketTypes ?? []);
  const [galleryImages, setGalleryImages] = useState<string[]>(() => {
    if (!event?.images) return [];
    return event.images.filter((img) => img !== event.coverImage);
  });
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submittingForReview, setSubmittingForReview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadConfig, setUploadConfig] = useState<UploadConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [categoryLoadError, setCategoryLoadError] = useState<string | null>(null);

  // Inline venue creation
  const [showVenueForm, setShowVenueForm] = useState(false);
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [venueCity, setVenueCity] = useState('');
  const [venueState, setVenueState] = useState('');
  const [venueCapacity, setVenueCapacity] = useState('');
  const [savingVenue, setSavingVenue] = useState(false);
  const [venueError, setVenueError] = useState<string | null>(null);

  // Inline ticket type editing in Step 4
  const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
  const [showAddTicketForm, setShowAddTicketForm] = useState(false);

  const [step, setStep] = useState(0);
  const steps = [
    { label: 'Basics', icon: FileText },
    { label: 'Venue & Category', icon: MapPin },
    { label: 'Schedule', icon: CalendarDays },
    { label: 'Media & Policies', icon: ImageIcon },
    { label: 'Tickets & Inventory', icon: Ticket },
    { label: 'Review & Submit', icon: CheckCircle2 },
  ];

  useEffect(() => {
    if (event) {
      setEventState(event);
      setTickets(event.ticketTypes ?? []);
      setGalleryImages(event.images ? event.images.filter((img) => img !== event.coverImage) : []);
    }
  }, [event]);

  const reloadCategories = async () => {
    setCategoryLoadError(null);
    try {
      const cats = await getOrganizerCategories();
      setCategories(cats);
    } catch (err) {
      setCategoryLoadError(err instanceof Error ? err.message : 'Could not load categories');
    }
  };

  useEffect(() => {
    let active = true;
    Promise.allSettled([getOrganizerCategories(), getOrganizerVenues(), getUploadConfig()])
      .then(([categoryResult, venueResult, uploadConfigResult]) => {
        if (!active) return;
        if (categoryResult.status === 'fulfilled') {
          setCategories(categoryResult.status === 'fulfilled' ? categoryResult.value : []);
        } else {
          setCategoryLoadError(
            categoryResult.reason instanceof Error
              ? categoryResult.reason.message
              : 'Could not load categories',
          );
        }
        if (venueResult.status === 'fulfilled') {
          setVenues(venueResult.value);
        }
        if (uploadConfigResult.status === 'fulfilled') {
          setUploadConfig(uploadConfigResult.value);
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

  const getPayload = (): OrganizerEventInput => {
    const start = new Date(values.startDate);
    const end = new Date(values.endDate);
    const tags = values.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const coverImage = values.coverImage.trim();
    const images = Array.from(new Set([coverImage, ...galleryImages].filter(Boolean)));
    return {
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
      coverImage: coverImage || (eventState ? null : undefined),
      images,
    };
  };

  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  function validateImageFile(file: File): string | null {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return `File "${file.name}" is not supported. Please upload a JPEG, PNG, or WebP image.`;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return `File "${file.name}" exceeds the 5 MB maximum limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`;
    }
    return null;
  }

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (uploadConfig !== null && !uploadConfig.configured) {
      setError('Cloudinary media storage is not configured on this server.');
      e.target.value = '';
      return;
    }
    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      e.target.value = '';
      return;
    }
    setUploadingCover(true);
    setError(null);
    try {
      const url = await uploadOrganizerMedia(file, eventState?.id);
      setField('coverImage', url);
      setNotice('Cover image uploaded successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cover upload failed.');
    } finally {
      setUploadingCover(false);
      e.target.value = '';
    }
  }

  async function handleGalleryUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    if (uploadConfig !== null && !uploadConfig.configured) {
      setError('Cloudinary media storage is not configured on this server.');
      e.target.value = '';
      return;
    }
    for (const file of files) {
      const validationError = validateImageFile(file);
      if (validationError) {
        setError(validationError);
        e.target.value = '';
        return;
      }
    }
    setUploadingGallery(true);
    setError(null);
    try {
      const uploadedUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setUploadProgress(`Uploading ${i + 1} of ${files.length} images…`);
        const url = await uploadOrganizerMedia(files[i], eventState?.id);
        uploadedUrls.push(url);
      }
      setGalleryImages((prev) => [...prev, ...uploadedUrls]);
      setNotice(`${uploadedUrls.length} gallery image${uploadedUrls.length === 1 ? '' : 's'} added.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gallery upload failed.');
    } finally {
      setUploadingGallery(false);
      setUploadProgress(null);
      e.target.value = '';
    }
  }

  function removeGalleryImage(index: number) {
    const removedUrl = galleryImages[index];
    setGalleryImages((prev) => prev.filter((_, i) => i !== index));
    if (eventState?.id && removedUrl) {
      void deleteOrganizerMedia(eventState.id, removedUrl).catch(() => undefined);
    }
  }

  function moveGalleryImage(index: number, direction: 'left' | 'right') {
    setGalleryImages((prev) => {
      const target = direction === 'left' ? index - 1 : index + 1;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[target];
      copy[target] = temp;
      return copy;
    });
  }

  async function saveVenue() {
    const capacity = Number(venueCapacity);
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
    setSavingVenue(true);
    try {
      const created = await createOrganizerVenue({
        name: venueName.trim(),
        address: venueAddress.trim(),
        city: venueCity.trim(),
        state: venueState.trim(),
        capacity,
      });
      setVenues((current) => {
        const exists = current.some((v) => v.id === created.id);
        return exists ? current : [...current, created];
      });
      setField('venueId', created.id);
      setVenueName('');
      setVenueAddress('');
      setVenueCity('');
      setVenueState('');
      setVenueCapacity('');
      setShowVenueForm(false);
      setNotice('Venue selected.');
    } catch (err) {
      setVenueError(err instanceof Error ? err.message : 'Could not save venue.');
    } finally {
      setSavingVenue(false);
    }
  }

  async function saveDraftEvent(): Promise<OrganizerEventDetail | null> {
    if (uploadingCover || uploadingGallery) {
      setError('Please wait for media uploads to finish before saving.');
      return null;
    }
    const start = new Date(values.startDate);
    const end = new Date(values.endDate);
    if (!values.title.trim() || values.title.trim().length < 3) {
      setError('Event title must be at least 3 characters.');
      return null;
    }
    if (!values.description.trim() || values.description.trim().length < 20) {
      setError('Description must be at least 20 characters.');
      return null;
    }
    if (!values.categoryId || !values.venueId) {
      setError('Select a category and venue.');
      return null;
    }
    if (Number.isNaN(start.getTime()) || (!eventState && start.getTime() <= Date.now())) {
      setError('Start date must be in the future.');
      return null;
    }
    if (Number.isNaN(end.getTime()) || end <= start) {
      setError('End date must be after start date.');
      return null;
    }

    const payload = getPayload();
    try {
      const saved = eventState
        ? await updateOrganizerEvent(eventState.id, payload)
        : await createOrganizerEvent(payload);
      setEventState(saved);
      onSaved?.(saved);
      setNotice('Draft saved.');
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft.');
      return null;
    }
  }

  async function goToStep(targetIndex: number) {
    if (targetIndex === step) return;
    setError(null);

    // Existing event: all steps are genuinely directly accessible without forced sequence
    if (eventState) {
      setStep(targetIndex);
      return;
    }

    // New event: backward navigation or steps 0, 1, 2, 3, 5 are directly accessible
    if (targetIndex < step || targetIndex !== 4) {
      setStep(targetIndex);
      return;
    }

    // Navigating to Step 4 (Tickets & Inventory) for an unsaved new event requires an event ID in DB
    const start = new Date(values.startDate);
    const end = new Date(values.endDate);
    if (values.title.trim().length < 3) {
      setError('Please enter an event title (min 3 chars) before configuring tickets.');
      setStep(0);
      return;
    }
    if (values.description.trim().length < 20) {
      setError('Please enter an event description (min 20 chars) before configuring tickets.');
      setStep(0);
      return;
    }
    if (!values.categoryId || !values.venueId) {
      setError('Please select a category and venue before configuring tickets.');
      setStep(1);
      return;
    }
    if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) {
      setError('Please set a valid future start date before configuring tickets.');
      setStep(2);
      return;
    }
    if (Number.isNaN(end.getTime()) || end <= start) {
      setError('Please set an end date after the start date before configuring tickets.');
      setStep(2);
      return;
    }

    setSubmitting(true);
    try {
      const saved = await saveDraftEvent();
      if (saved) {
        setStep(4);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function continueToNextStep() {
    await goToStep(Math.min(step + 1, steps.length - 1));
  }

  async function handleSubmitForReview() {
    setError(null);
    setNotice(null);

    if (uploadingCover || uploadingGallery) {
      setError('Please wait for media uploads to finish before submitting.');
      return;
    }

    if (values.title.trim().length < 3) {
      setError('Event title must be at least 3 characters.');
      setStep(0);
      return;
    }
    if (values.description.trim().length < 20) {
      setError('Event description must be at least 20 characters.');
      setStep(0);
      return;
    }
    if (!values.categoryId || !values.venueId) {
      setError('Please select both a category and a venue.');
      setStep(1);
      return;
    }
    const start = new Date(values.startDate);
    const end = new Date(values.endDate);
    if (Number.isNaN(start.getTime()) || (!eventState && start.getTime() <= Date.now())) {
      setError('Event start date must be in the future.');
      setStep(2);
      return;
    }
    if (Number.isNaN(end.getTime()) || end <= start) {
      setError('Event end date must be after the start date.');
      setStep(2);
      return;
    }

    setSubmittingForReview(true);
    try {
      const saved = await saveDraftEvent();
      if (!saved) return;

      if (tickets.length === 0) {
        setError('Please add at least one ticket tier in Tickets & Inventory before submitting for review.');
        setStep(4);
        return;
      }
      for (const t of tickets) {
        if (t.totalQuantity < 1) {
          setError(`Ticket "${t.name}" has invalid inventory.`);
          setStep(4);
          return;
        }
      }

      await submitOrganizerEventForReview(saved.id);
      setEventState({
        ...saved,
        moderation: {
          status: 'PENDING_APPROVAL',
          submittedAt: new Date().toISOString(),
        },
      });
      setNotice('Event submitted for administrator approval! You will receive an in-app notification once reviewed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit event for review.');
    } finally {
      setSubmittingForReview(false);
    }
  }

  async function handlePublish() {
    setError(null);
    setNotice(null);

    if (uploadingCover || uploadingGallery) {
      setError('Please wait for media uploads to finish before publishing.');
      return;
    }

    if (!eventState) {
      setError('Please save and submit your event for administrator approval before publishing.');
      return;
    }

    if (eventState.moderation?.status !== 'APPROVED') {
      setError('Event must be approved by an administrator before it can be published.');
      return;
    }

    const start = new Date(values.startDate);
    if (start.getTime() <= Date.now()) {
      setError('Cannot publish an event whose start date has passed.');
      setStep(2);
      return;
    }

    if (tickets.length === 0) {
      setError('Please add at least one ticket tier before publishing.');
      setStep(4);
      return;
    }
    for (const t of tickets) {
      if (t.totalQuantity < 1) {
        setError(`Ticket "${t.name}" has invalid inventory.`);
        setStep(4);
        return;
      }
    }

    setPublishing(true);
    try {
      await updateOrganizerEvent(eventState.id, getPayload());
      const published = await publishOrganizerEvent(eventState.id);
      setEventState(published);
      onSaved?.(published);
      setNotice('Event published successfully! It is now live for attendees.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed.');
    } finally {
      setPublishing(false);
    }
  }

  const selectedCategory = categories.find((c) => c.id === values.categoryId);
  const selectedVenue = venues.find((v) => v.id === values.venueId);

  const inputClass =
    'mt-1 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
  const textareaClass =
    'mt-1 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

  return (
    <div className="space-y-6">
      {/* 6-step progress header */}
      <nav aria-label="Event wizard steps" className="border-b pb-4">
        <ol className="flex flex-wrap items-center gap-2 text-sm">
          {steps.map((s, index) => {
            const Icon = s.icon;
            const isCurrent = step === index;
            const isCompleted = step > index;
            return (
              <li key={s.label} className="flex items-center">
                <button
                  type="button"
                  onClick={() => void goToStep(index)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                    isCurrent
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : isCompleted
                        ? 'bg-muted text-foreground hover:bg-muted/80'
                        : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>
                    {index + 1}. {s.label}
                  </span>
                </button>
                {index < steps.length - 1 && (
                  <span className="mx-1 text-muted-foreground/40 font-mono">/</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive font-medium">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300 font-medium">
          {notice}
        </div>
      )}

      {/* STEP 0: Basics */}
      {step === 0 && (
        <section className="space-y-4" aria-label="Event basics">
          <div>
            <label htmlFor="event-title" className="block text-sm font-medium">
              Event title <span className="text-destructive">*</span>
            </label>
            <input
              id="event-title"
              required
              maxLength={200}
              placeholder="e.g. Bangalore Indie Music Festival 2026"
              value={values.title}
              onChange={(e) => setField('title', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="event-short-desc" className="block text-sm font-medium">
              Short summary (optional)
            </label>
            <input
              id="event-short-desc"
              maxLength={300}
              placeholder="One-line hook shown on discovery cards"
              value={values.shortDescription}
              onChange={(e) => setField('shortDescription', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="event-description" className="block text-sm font-medium">
              Full description <span className="text-destructive">*</span>
            </label>
            <textarea
              id="event-description"
              required
              maxLength={10000}
              rows={5}
              placeholder="Provide event overview, artist lineup, schedule highlights, and experience details."
              value={values.description}
              onChange={(e) => setField('description', e.target.value)}
              className={textareaClass}
            />
          </div>
        </section>
      )}

      {/* STEP 1: Venue & Category */}
      {step === 1 && (
        <section className="space-y-5" aria-label="Venue and category">
          {categoryLoadError && (
            <div
              role="alert"
              className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive font-medium"
            >
              <span>Could not load event categories: {categoryLoadError}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void reloadCategories()}
              >
                Retry categories
              </Button>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="event-category" className="block text-sm font-medium">
                Category <span className="text-destructive">*</span>
              </label>
              <select
                id="event-category"
                required
                value={values.categoryId}
                onChange={(e) => setField('categoryId', e.target.value)}
                className={inputClass}
              >
                <option value="">{loadingOptions ? 'Loading categories…' : 'Select category'}</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="event-venue" className="block text-sm font-medium">
                Venue <span className="text-destructive">*</span>
              </label>
              <select
                id="event-venue"
                required
                value={values.venueId}
                onChange={(e) => setField('venueId', e.target.value)}
                className={inputClass}
              >
                <option value="">{loadingOptions ? 'Loading venues…' : 'Select your venue'}</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.city} {v.capacity ? `(Cap: ${v.capacity.toLocaleString()})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick inline venue creation / reuse */}
          <div className="ep-surface-inset rounded-lg border bg-muted/20 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Need a different venue?</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowVenueForm((prev) => !prev)}
              >
                {showVenueForm ? 'Close form' : '+ Add venue'}
              </Button>
            </div>
            {showVenueForm && (
              <div className="mt-3 space-y-3">
                {venueError && (
                  <p role="alert" className="text-xs text-destructive">
                    {venueError}
                  </p>
                )}
                <div className="grid gap-2.5 sm:grid-cols-2 text-xs">
                  <label className="font-medium">
                    Name *
                    <input value={venueName} onChange={(e) => setVenueName(e.target.value)} className={inputClass} />
                  </label>
                  <label className="font-medium">
                    Address *
                    <input value={venueAddress} onChange={(e) => setVenueAddress(e.target.value)} className={inputClass} />
                  </label>
                  <label className="font-medium">
                    City *
                    <input value={venueCity} onChange={(e) => setVenueCity(e.target.value)} className={inputClass} />
                  </label>
                  <label className="font-medium">
                    State *
                    <input value={venueState} onChange={(e) => setVenueState(e.target.value)} className={inputClass} />
                  </label>
                  <label className="font-medium">
                    Capacity *
                    <input type="number" min="1" max="100000" value={venueCapacity} onChange={(e) => setVenueCapacity(e.target.value)} className={inputClass} />
                  </label>
                </div>
                <Button type="button" size="sm" disabled={savingVenue} onClick={() => void saveVenue()}>
                  {savingVenue ? 'Saving venue…' : 'Save & select venue'}
                </Button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* STEP 2: Schedule */}
      {step === 2 && (
        <section className="space-y-5" aria-label="Event schedule">
          <div className="grid gap-4 sm:grid-cols-2">
            <DateTimePicker
              label="Event starts"
              required
              value={values.startDate}
              onChange={(val) => setField('startDate', val)}
            />
            <DateTimePicker
              label="Event ends"
              required
              value={values.endDate}
              minDate={values.startDate?.slice(0, 10)}
              onChange={(val) => setField('endDate', val)}
            />
          </div>
          <div>
            <label htmlFor="event-tags" className="block text-sm font-medium">
              Tags (comma separated, max 10)
            </label>
            <input
              id="event-tags"
              placeholder="e.g. concert, live, rock, festival"
              value={values.tags}
              onChange={(e) => setField('tags', e.target.value)}
              className={inputClass}
            />
          </div>
        </section>
      )}

      {/* STEP 3: Media & Policies */}
      {step === 3 && (
        <section className="space-y-6" aria-label="Event media and policies">
          {uploadConfig && !uploadConfig.configured && (
            <div
              role="status"
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200"
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">Media storage is not configured on this server</p>
                  <p className="text-xs text-muted-foreground">
                    Image uploads require Cloudinary credentials to be configured on the server. You can still save and submit events without images.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Cover Image Upload */}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-semibold">
                Event cover image <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Primary image shown on search cards, event banners, and social sharing. Recommended ratio 16:9, max 5 MB.
              </p>
            </div>

            {values.coverImage ? (
              <div className="relative overflow-hidden rounded-xl border bg-muted shadow-sm max-w-xl group">
                <div className="aspect-[16/9] w-full overflow-hidden bg-black/5 dark:bg-black/40 flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={values.coverImage}
                    alt="Event cover preview"
                    className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                  />
                </div>
                <div className="p-3 bg-card flex items-center justify-between gap-3 border-t">
                  <span className="text-xs font-medium text-muted-foreground truncate">
                    Cover image uploaded
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <label
                      className={cn(
                        buttonVariants({ variant: 'outline', size: 'sm' }),
                        'cursor-pointer gap-1.5 text-xs h-8',
                        (uploadingCover || uploadConfig?.configured === false) && 'pointer-events-none opacity-50',
                      )}
                    >
                      {uploadingCover ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Replacing…
                        </>
                      ) : (
                        <>
                          <Upload className="h-3.5 w-3.5" /> Replace image
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        disabled={uploadingCover || uploadConfig?.configured === false}
                        onChange={(e) => void handleCoverUpload(e)}
                      />
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        const prev = values.coverImage;
                        setField('coverImage', '');
                        if (eventState?.id && prev) {
                          void deleteOrganizerMedia(eventState.id, prev).catch(() => undefined);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <label
                className={cn(
                  'flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-input p-8 text-center transition-colors cursor-pointer max-w-xl hover:border-primary/50 hover:bg-accent/40',
                  (uploadingCover || uploadConfig?.configured === false) && 'pointer-events-none opacity-60 bg-muted/40',
                )}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
                  {uploadingCover ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <Upload className="h-6 w-6" />
                  )}
                </div>
                <span className="text-sm font-semibold text-foreground">
                  {uploadingCover
                    ? 'Uploading cover image…'
                    : uploadConfig?.configured === false
                      ? 'Image upload not configured'
                      : 'Upload cover image'}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  {uploadConfig?.configured === false
                    ? 'Storage environment variables missing on server'
                    : 'JPEG, PNG, or WebP up to 5 MB'}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={uploadingCover || uploadConfig?.configured === false}
                  onChange={(e) => void handleCoverUpload(e)}
                />
              </label>
            )}
          </div>

          {/* Gallery Images Upload */}
          <div className="space-y-3 pt-2 border-t">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <label className="block text-sm font-semibold">
                  Gallery photos <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Showcase the venue, performers, seating, or past event moments. Multiple images supported.
                </p>
              </div>
              <label
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'cursor-pointer gap-1.5 text-xs shrink-0 self-start sm:self-auto',
                  (uploadingGallery || uploadConfig?.configured === false) && 'pointer-events-none opacity-50',
                )}
              >
                {uploadingGallery ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {uploadProgress || 'Uploading…'}
                  </>
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5" />
                    Add gallery photos
                  </>
                )}
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={uploadingGallery || uploadConfig?.configured === false}
                  onChange={(e) => void handleGalleryUpload(e)}
                />
              </label>
            </div>

            {galleryImages.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-1">
                {galleryImages.map((imgUrl, index) => (
                  <div
                    key={`${imgUrl}-${index}`}
                    className="group relative aspect-square overflow-hidden rounded-lg border bg-muted shadow-sm transition-all hover:shadow"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imgUrl}
                      alt={`Gallery item ${index + 1}`}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 opacity-90 transition-opacity" />
                    <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur">
                      #{index + 1}
                    </span>
                    <div className="absolute bottom-1.5 inset-x-1.5 flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveGalleryImage(index, 'left')}
                          className="h-6 w-6 rounded bg-black/60 text-white flex items-center justify-center hover:bg-black/90 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                          title="Move earlier"
                          aria-label={`Move photo ${index + 1} earlier`}
                        >
                          <ArrowLeft className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          disabled={index === galleryImages.length - 1}
                          onClick={() => moveGalleryImage(index, 'right')}
                          className="h-6 w-6 rounded bg-black/60 text-white flex items-center justify-center hover:bg-black/90 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                          title="Move later"
                          aria-label={`Move photo ${index + 1} later`}
                        >
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeGalleryImage(index)}
                        className="h-6 w-6 rounded bg-destructive/80 text-destructive-foreground flex items-center justify-center hover:bg-destructive transition-colors"
                        title="Remove photo"
                        aria-label={`Remove gallery photo ${index + 1}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground bg-muted/20">
                No gallery photos added yet. Click &quot;Add gallery photos&quot; above to select multiple photos.
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium">
              Event policies (optional)
              <textarea
                maxLength={5000}
                value={values.policies}
                onChange={(e) => setField('policies', e.target.value)}
                className={textareaClass}
                placeholder="Entry requirements, dress code, age limits..."
              />
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium">
              Cancellation policy (optional)
              <textarea
                maxLength={2000}
                value={values.cancellationPolicy}
                onChange={(e) => setField('cancellationPolicy', e.target.value)}
                className={textareaClass}
                placeholder="Refund terms upon attendee or organizer cancellation."
              />
            </label>
          </div>
        </section>
      )}

      {/* STEP 4: Tickets & Inventory */}
      {step === 4 && (
        <section className="space-y-4" aria-label="Tickets and inventory">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-base">Ticket tiers & inventory</h3>
              <p className="text-xs text-muted-foreground">
                Set ticket names, prices (INR), and seat/entry capacity. Free events can proceed without tickets.
              </p>
            </div>
            {!showAddTicketForm && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setShowAddTicketForm(true);
                  setEditingTicketId(null);
                }}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add tier
              </Button>
            )}
          </div>

          {showAddTicketForm && eventState && (
            <TicketInlineForm
              onSave={async (input) => {
                const created = await createOrganizerTicketType(eventState.id, input);
                setTickets((curr) => [...curr, created].sort((a, b) => a.price - b.price));
                setShowAddTicketForm(false);
                setNotice('Ticket type added.');
              }}
              onCancel={() => setShowAddTicketForm(false)}
            />
          )}

          {tickets.length === 0 && !showAddTicketForm ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              <Ticket className="mx-auto mb-2 h-6 w-6 opacity-40" />
              <p className="font-medium text-foreground">No ticket tiers configured</p>
              <p className="text-xs mt-1">
                You can add paid or free admission tiers now, or proceed if this event does not require tickets.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {tickets.map((t) => {
                const sold = t.totalQuantity - t.availableQuantity;
                if (editingTicketId === t.id && eventState) {
                  return (
                    <TicketInlineForm
                      key={t.id}
                      ticket={t}
                      onSave={async (input) => {
                        const updated = await updateOrganizerTicketType(t.id, input);
                        setTickets((curr) =>
                          curr.map((item) => (item.id === t.id ? updated : item)).sort((a, b) => a.price - b.price),
                        );
                        setEditingTicketId(null);
                        setNotice('Ticket type updated.');
                      }}
                      onCancel={() => setEditingTicketId(null)}
                    />
                  );
                }
                return (
                  <article key={t.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border bg-card p-3.5 shadow-sm">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{t.name}</span>
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', t.isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground')}>
                          {t.isActive ? 'Active' : 'Hidden'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatPrice(t.price)} · {t.availableQuantity} available of {t.totalQuantity} total ({sold} sold) · Max {t.maxPerBooking}/booking
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingTicketId(t.id);
                          setShowAddTicketForm(false);
                        }}
                      >
                        Edit
                      </Button>
                      {sold === 0 && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={async () => {
                            if (!window.confirm(`Delete "${t.name}"?`)) return;
                            try {
                              await deleteOrganizerTicketType(t.id);
                              setTickets((curr) => curr.filter((item) => item.id !== t.id));
                              setNotice('Ticket tier deleted.');
                            } catch (err) {
                              setError(err instanceof Error ? err.message : 'Delete failed.');
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* STEP 5: Review & Publish */}
      {step === 5 && (
        <section className="space-y-5" aria-label="Review and publish">
          <div>
            <h3 className="font-bold text-lg">Review event details</h3>
            <p className="text-xs text-muted-foreground">
              Verify your event details and ticket tiers before publishing to attendees.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Basics Card */}
            <div className="rounded-lg border bg-card p-4 space-y-2">
              <span className="text-xs font-bold text-muted-foreground uppercase">Basics & Category</span>
              <h4 className="font-bold text-base text-foreground">{values.title}</h4>
              <p className="text-xs text-primary font-semibold">Category: {selectedCategory?.name ?? 'Not selected'}</p>
              {values.shortDescription && <p className="text-xs text-muted-foreground">{values.shortDescription}</p>}
            </div>

            {/* Venue Card */}
            <div className="rounded-lg border bg-card p-4 space-y-2">
              <span className="text-xs font-bold text-muted-foreground uppercase">Venue & Capacity</span>
              <h4 className="font-bold text-base text-foreground">{selectedVenue?.name ?? 'Not selected'}</h4>
              <p className="text-xs text-muted-foreground">
                {selectedVenue?.address}, {selectedVenue?.city} · Capacity: {selectedVenue?.capacity?.toLocaleString() ?? 'N/A'}
              </p>
            </div>

            {/* Schedule Card */}
            <div className="rounded-lg border bg-card p-4 space-y-2">
              <span className="text-xs font-bold text-muted-foreground uppercase">Schedule</span>
              <p className="text-xs font-semibold">Starts: {formatEventDate(values.startDate)}</p>
              <p className="text-xs text-muted-foreground">Ends: {formatEventDate(values.endDate)}</p>
              {values.tags && <p className="text-xs text-muted-foreground font-mono">Tags: {values.tags}</p>}
            </div>

            {/* Tickets Card */}
            <div className="rounded-lg border bg-card p-4 space-y-2">
              <span className="text-xs font-bold text-muted-foreground uppercase">Tickets ({tickets.length} tier{tickets.length === 1 ? '' : 's'})</span>
              {tickets.length === 0 ? (
                <p className="text-xs text-muted-foreground">Free admission / no ticket registration required.</p>
              ) : (
                <ul className="text-xs space-y-1">
                  {tickets.map((t) => (
                    <li key={t.id} className="flex justify-between">
                      <span className="font-medium">{t.name} ({t.totalQuantity} qty)</span>
                      <span className="font-semibold text-primary">{formatPrice(t.price)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Moderation status banner if rejected */}
          {eventState?.moderation?.status === 'REJECTED' && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 space-y-1">
              <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
                <AlertCircle className="h-4 w-4" />
                <span>Event rejected by administrator</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Reason: {eventState.moderation.rejectionReason || 'No specific reason provided.'}
              </p>
              <p className="text-xs text-muted-foreground">
                Please make the necessary changes to your event details or ticket tiers, then resubmit for review.
              </p>
            </div>
          )}

          <div className="rounded-lg border bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              {eventState?.status === 'PUBLISHED' ? (
                <>
                  <p className="font-semibold text-sm text-foreground">Event is Live & Published</p>
                  <p className="text-xs text-muted-foreground">
                    This event is visible to attendees and open for ticket bookings.
                  </p>
                </>
              ) : eventState?.moderation?.status === 'APPROVED' ? (
                <>
                  <p className="font-semibold text-sm text-emerald-600 dark:text-emerald-400">
                    Event Approved by Administrator
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Your event has been approved! Ready to make it live for attendees?
                  </p>
                </>
              ) : eventState?.moderation?.status === 'PENDING_APPROVAL' ? (
                <>
                  <p className="font-semibold text-sm text-amber-600 dark:text-amber-400">
                    Under Administrator Review
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Your event is in the moderation queue. You will receive an in-app notification once a decision is made.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-sm text-foreground">Ready to submit for approval?</p>
                  <p className="text-xs text-muted-foreground">
                    Events must be reviewed and approved by an administrator before they can be published live.
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={submitting || publishing || submittingForReview || uploadingCover || uploadingGallery}
                onClick={() => void saveDraftEvent()}
              >
                {submitting ? 'Saving…' : 'Save draft changes'}
              </Button>
              {eventState?.status === 'PUBLISHED' ? (
                <Link
                  href={`/events/${encodeURIComponent(eventState.slug)}`}
                  className={cn(buttonVariants(), 'gap-1.5')}
                >
                  <ExternalLink className="h-4 w-4" /> View live page
                </Link>
              ) : eventState?.moderation?.status === 'APPROVED' ? (
                <Button
                  type="button"
                  disabled={publishing || submitting || submittingForReview || uploadingCover || uploadingGallery}
                  onClick={() => void handlePublish()}
                >
                  {publishing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Publishing…
                    </>
                  ) : (
                    'Publish event now'
                  )}
                </Button>
              ) : eventState?.moderation?.status === 'PENDING_APPROVAL' ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  <Clock className="h-3.5 w-3.5" />
                  Awaiting Approval
                </span>
              ) : (
                <Button
                  type="button"
                  disabled={submittingForReview || submitting || publishing || uploadingCover || uploadingGallery}
                  onClick={() => void handleSubmitForReview()}
                >
                  {submittingForReview ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting…
                    </>
                  ) : eventState?.moderation?.status === 'REJECTED' ? (
                    'Resubmit for admin approval'
                  ) : (
                    'Submit for admin approval'
                  )}
                </Button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Navigation Footer */}
      <div className="flex items-center justify-between border-t pt-4">
        <Button
          type="button"
          variant="outline"
          disabled={step === 0 || submitting || publishing || submittingForReview || uploadingCover || uploadingGallery}
          onClick={() => setStep((curr) => Math.max(0, curr - 1))}
        >
          Previous step
        </Button>

        <div className="flex gap-2">
          {step < steps.length - 1 && (
            <Button
              type="button"
              variant="outline"
              disabled={submitting || uploadingCover || uploadingGallery}
              onClick={() => void saveDraftEvent()}
            >
              Save draft
            </Button>
          )}

          {step < steps.length - 1 ? (
            <Button
              type="button"
              disabled={submitting || uploadingCover || uploadingGallery}
              onClick={() => void continueToNextStep()}
            >
              {submitting ? 'Saving…' : 'Next step'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
