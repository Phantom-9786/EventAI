'use client';
import Link from '@/components/ui/app-link';
import { EventImage } from '@/components/approved/event-image';
import { formatPrice, type EventSummary } from '@/lib/api';
export function AiEventCard({ event }: { event: EventSummary }) {
  return (
    <Link href={'/events/' + event.slug} className="ep-ai-event-card">
      <EventImage
        src={event.coverImage || event.images[0]}
        fallbacks={event.images}
        alt={event.title}
      />
      <div>
        <span className="ep-ai-event-category">{event.category.name}</span>
        <h3>{event.title}</h3>
        <p>
          {event.venue.city} ·{' '}
          {new Date(event.startDate).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
          })}
        </p>
        <strong>
          {event.minPrice == null ? 'See tickets' : formatPrice(event.minPrice)}
        </strong>
      </div>
    </Link>
  );
}
