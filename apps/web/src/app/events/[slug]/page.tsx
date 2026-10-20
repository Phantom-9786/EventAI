import {EventSectionNav} from '@/components/events/event-section-nav';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowRight, CalendarDays, MapPin, Users, Ticket, Sparkles } from 'lucide-react';
import { getEvent, getSimilarEvents, formatEventDate } from '@/lib/api';
import { getDirectionsUrl } from '@/lib/maps';
import { BookingWidget } from '@/components/booking/booking-widget';
import { EventCard } from '@/components/events/event-card';
import { FavoriteButton } from '@/components/events/favorite-button';
import { EventShareButton } from '@/components/events/event-share-button';
import { EventAiWidget } from '@/components/events/event-ai-widget';
import { PreviewGallery } from '@/components/approved/gallery';
export const dynamic = 'force-dynamic';
interface Props {
  params: { slug: string };
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await getEvent(params.slug).catch(() => null);
  return {
    title: event?.title ?? 'Event not found',
    description: event?.shortDescription ?? event?.description.slice(0, 160),
  };
}
export default async function EventDetailPage({ params }: Props) {
  let event: Awaited<ReturnType<typeof getEvent>> | null = null;
  let maintenance = false;
  try {
    event = await getEvent(params.slug);
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    maintenance = text.includes('503') || text.toLowerCase().includes('maintenance');
  }
  if (maintenance)
    return (
      <div className="ep-app-gate">
        <h1>Website Maintenance Active</h1>
        <p>
          Event details are temporarily restricted. Authorized maintenance testing
          accounts may sign in to continue.
        </p>
        <Link href="/signin" className="btn">
          Sign in
        </Link>
        <Link href="/events" className="btn outline">
          Back to events
        </Link>
      </div>
    );
  if (!event) notFound();
  const similar = await getSimilarEvents(event.slug, 4).catch(() => []);
  const d = new Date(event.startDate);
  const images = Array.from(
    new Set([event.coverImage, ...event.images].filter((v): v is string => Boolean(v))),
  );
  return (
    <div className="wrap ep-event-detail">
      <div className="breadcrumb">
        <Link href="/">Home</Link>
        <span>›</span>
        <Link href="/events">Discover events</Link>
        <span>›</span>
        <span>{event.title}</span>
      </div>
      <div className="detail-grid">
        <div>
          <div className="ep-gallery-frame">
            <PreviewGallery images={images} title={event.title} />
            <div className="ep-detail-actions">
              <EventShareButton eventTitle={event.title} />
              <FavoriteButton eventId={event.id} size="md" />
            </div>
          </div>
          <div className="detail-title">
            <div className="large-date">
              <span>
                {d.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase()}
              </span>
              <strong>{d.getDate()}</strong>
              <span>{d.getFullYear()}</span>
            </div>
            <div>
              <span className="pill">{event.category.name}</span>
              <h1>{event.title}</h1>
              <p>{event.shortDescription}</p>
            </div>
          </div>
          <div className="info-row">
            <div className="info-box">
              <CalendarDays className="icon" />
              <div>
                <strong>{formatEventDate(event.startDate)}</strong>
                <span>
                  {d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}{' '}
                  –{' '}
                  {new Date(event.endDate).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
            <div className="info-box">
              <MapPin className="icon" />
              <div>
                <strong>{event.venue.name}</strong>
                <span>
                  {event.venue.city}, {event.venue.state}
                </span>
              </div>
            </div>
          </div>
          <EventSectionNav/>
          <section className="detail-section" id="about">
            <h2>About the experience</h2>
            <p className="prose" style={{ whiteSpace: 'pre-line' }}>
              {event.description}
            </p>
            {event.tags.length > 0 && (
              <div className="highlight-list">
                {event.tags.map((t) => (
                  <div key={t}>
                    <Sparkles className="icon" />
                    {t}
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="detail-section" id="venue">
            <h2>A place to come together</h2>
            <div className="info-box">
              <MapPin className="icon" />
              <div>
                <strong>
                  {event.venue.name}, {event.venue.city}
                </strong>
                <span>
                  {event.venue.address}, {event.venue.state}, {event.venue.country}
                </span>
                <a
                  href={getDirectionsUrl(event.venue)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-link"
                >
                  Get directions
                  <ArrowRight className="icon" />
                </a>
              </div>
            </div>
          </section>
          <section className="detail-section" id="faq">
            <h2>A few things to know</h2>
            {event.faqs.map((f) => (
              <details key={f.id}>
                <summary>{f.question}</summary>
                <p>{f.answer}</p>
              </details>
            ))}
            {event.policies && (
              <details>
                <summary>Event policies</summary>
                <p>{event.policies}</p>
              </details>
            )}
            {event.cancellationPolicy && (
              <details>
                <summary>Cancellation policy</summary>
                <p>{event.cancellationPolicy}</p>
              </details>
            )}
            {!event.faqs.length && !event.policies && !event.cancellationPolicy && (
              <p className="prose">
                The organizer has not added additional policies yet.
              </p>
            )}
          </section>
          <section className="detail-section">
            <h2>Made possible by</h2>
            <div className="info-box">
              <Users className="icon" />
              <div>
                <strong>{event.organizer.organizationName}</strong>
                <span>
                  {event.organizer.isVerified ? 'Verified organizer' : 'Event organizer'}
                </span>
              </div>
            </div>
          </section>
        </div>
        <aside>
          <div className="ticket-panel">
            <div className="ticket-heading">
              <h2>Your next good plan</h2>
              <span className="status">Tickets</span>
            </div>
            <p className="ticket-caption">Choose your experience · Pricing in INR</p>
            <BookingWidget
              eventId={event.id}
              eventTitle={event.title}
              ticketTypes={event.ticketTypes}
            />
            <div className="question-box">
              <h3>
                <Ticket className="icon" /> A little help finding your plan?
              </h3>
              <p>Explore another experience that feels like you.</p>
              <Link className="text-link" href="/events">
                Keep exploring
                <ArrowRight className="icon" />
              </Link>
            </div>
          </div>
          <EventAiWidget eventId={event.id} eventTitle={event.title} eventCity={event.venue.city} />
        </aside>
      </div>
      {similar.length > 0 && (
        <section className="section">
          <div className="section-heading">
            <div>
              <p className="small-label">Keep the possibilities open</p>
              <h2>You might also love</h2>
            </div>
            <Link href="/events" className="text-link">
              View all
              <ArrowRight className="icon" />
            </Link>
          </div>
          <div className="ep-grid">
            {similar.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
