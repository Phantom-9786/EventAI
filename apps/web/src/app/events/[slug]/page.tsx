import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  BadgeCheck,
  CalendarDays,
  ChevronLeft,
  Clock,
  MapPin,
  Navigation,
  ShieldCheck,
  Ticket,
} from 'lucide-react';
import { BookingWidget } from '@/components/booking/booking-widget';
import { EventCard } from '@/components/events/event-card';
import {
  formatEventDate,
  formatPrice,
  getEvent,
  getSimilarEvents,
  type TicketTypeView,
} from '@/lib/api';
import { getDirectionsUrl } from '@/lib/maps';
import { cn } from '@/lib/utils';

interface EventDetailPageProps {
  params: { slug: string };
}

export async function generateMetadata({
  params,
}: EventDetailPageProps): Promise<Metadata> {
  const event = await getEvent(params.slug).catch(() => null);
  if (!event) return { title: 'Event not found' };
  return {
    title: event.title,
    description:
      event.shortDescription ?? event.description.slice(0, 160),
  };
}

function availabilityLabel(t: TicketTypeView): { text: string; soldOut: boolean } {
  if (t.availableQuantity <= 0) return { text: 'Sold out', soldOut: true };
  if (t.totalQuantity > 0 && t.availableQuantity <= t.totalQuantity * 0.1) {
    return { text: `Only ${t.availableQuantity} left`, soldOut: false };
  }
  return { text: `${t.availableQuantity} available`, soldOut: false };
}

function saleWindow(t: TicketTypeView): string | null {
  const now = Date.now();
  if (t.saleStartDate && new Date(t.saleStartDate).getTime() > now) {
    return `Sales start ${formatEventDate(t.saleStartDate)}`;
  }
  if (t.saleEndDate && new Date(t.saleEndDate).getTime() < now) {
    return 'Sales ended';
  }
  return null;
}

export default async function EventDetailPage({ params }: EventDetailPageProps) {
  const event = await getEvent(params.slug).catch(() => null);
  if (!event) notFound();
  const similar = await getSimilarEvents(event.slug, 4).catch(() => []);

  const startDate = new Date(event.startDate);
  const endDate = new Date(event.endDate);
  const sameDay = startDate.toDateString() === endDate.toDateString();

  return (
    <div className="container py-10">
      <Link
        href="/events"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        All events
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_380px]">
        {/* Main column */}
        <div>
          <div className="flex h-56 items-center justify-center overflow-hidden rounded-xl border bg-muted lg:h-72">
            {event.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={event.images[0]}
                alt={event.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <CalendarDays className="h-16 w-16 text-muted-foreground/40" aria-hidden />
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {event.category.name && (
              <span
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={
                  event.category.color
                    ? { backgroundColor: `${event.category.color}22`, color: event.category.color }
                    : undefined
                }
              >
                {event.category.name}
              </span>
            )}
            {event.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>

          <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            {event.title}
          </h1>
          {event.shortDescription && (
            <p className="mt-2 text-lg text-muted-foreground">{event.shortDescription}</p>
          )}

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
              <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">Date &amp; time</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {sameDay
                    ? formatEventDate(event.startDate)
                    : `${startDate.toLocaleDateString('en-IN')} – ${endDate.toLocaleDateString('en-IN')}`}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">{event.venue.name}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {event.venue.address}, {event.venue.city}, {event.venue.state}
                </p>
                <a
                  href={getDirectionsUrl(event.venue)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <Navigation className="h-4 w-4" />
                  Get directions
                </a>
              </div>
            </div>
          </div>

          {/* Description */}
          <section className="mt-10">
            <h2 className="text-xl font-semibold">About this event</h2>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {event.description}
            </div>
          </section>

          {/* Ticket types */}
          {event.ticketTypes.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xl font-semibold">Tickets</h2>
              <div className="mt-3 divide-y rounded-lg border">
                {event.ticketTypes.map((t) => {
                  const availability = availabilityLabel(t);
                  const saleNote = saleWindow(t);
                  return (
                    <div key={t.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium">
                          {t.name}
                          {t.section && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {t.section.name}
                            </span>
                          )}
                        </p>
                        {t.description && (
                          <p className="mt-0.5 text-sm text-muted-foreground">{t.description}</p>
                        )}
                        <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span
                            className={cn(
                              availability.soldOut
                                ? 'text-destructive'
                                : 'text-green-600 dark:text-green-400',
                            )}
                          >
                            {availability.text}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Max {t.maxPerBooking} per booking
                          </span>
                          {saleNote && <span>{saleNote}</span>}
                        </p>
                      </div>
                      <p className="text-lg font-semibold sm:text-right">
                        {formatPrice(t.price)}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          {t.currency}
                        </span>
                      </p>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Ticket className="h-3 w-3" />
                Booking opens with the Phase 3 booking engine — ticket selection is shown for planning.
              </p>
            </section>
          )}

          {/* FAQs */}
          {event.faqs.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xl font-semibold">Frequently asked questions</h2>
              <div className="mt-3 divide-y rounded-lg border">
                {event.faqs.map((faq) => (
                  <details key={faq.id} className="group p-4">
                    <summary className="cursor-pointer list-none text-sm font-medium marker:hidden">
                      {faq.question}
                    </summary>
                    <p className="mt-2 text-sm text-muted-foreground">{faq.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          {/* Policies */}
          {(event.policies || event.cancellationPolicy) && (
            <section className="mt-10">
              <h2 className="text-xl font-semibold">Policies</h2>
              {event.policies && (
                <>
                  <h3 className="mt-3 text-sm font-medium">Event policies</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {event.policies}
                  </p>
                </>
              )}
              {event.cancellationPolicy && (
                <>
                  <h3 className="mt-4 text-sm font-medium">Cancellation policy</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {event.cancellationPolicy}
                  </p>
                </>
              )}
            </section>
          )}
        </div>

        {/* Sidebar */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            {event.minPrice !== null ? (
              <>
                <p className="text-sm text-muted-foreground">Tickets from</p>
                <p className="mt-1 text-3xl font-bold">{formatPrice(event.minPrice)}</p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Pricing</p>
                <p className="mt-1 text-2xl font-bold">To be announced</p>
              </>
            )}
            <BookingWidget
              eventId={event.id}
              eventTitle={event.title}
              ticketTypes={event.ticketTypes}
            />
          </div>

          <div className="mt-4 rounded-lg border bg-card p-6">
            <p className="text-sm font-medium">Organized by</p>
            <p className="mt-1 flex items-center gap-1.5 font-semibold">
              {event.organizer.organizationName}
              {event.organizer.isVerified && (
                <BadgeCheck className="h-4 w-4 text-primary" aria-label="Verified organizer" />
              )}
            </p>
            <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Secure checkout once bookings open
            </p>
          </div>
        </aside>
      </div>

      {/* Recommendations */}
      {similar.length > 0 && (
        <section className="mt-14">
          <h2 className="text-xl font-semibold">You might also like</h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {similar.map((s) => (
              <EventCard key={s.id} event={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
