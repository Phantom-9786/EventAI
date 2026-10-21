import Link from 'next/link';
import { ArrowRight, MapPin, Clock } from 'lucide-react';
import type { EventSummary } from '@/lib/api';
import { formatPrice } from '@/lib/api';
import { EventImage } from '@/components/approved/event-image';
import { FavoriteButton } from './favorite-button';
export function EventCard({
  event,
  showDescription = false,
}: {
  event: EventSummary;
  showDescription?: boolean;
}) {
  const d = new Date(event.startDate);
  return (
    <div className="ep-event-card">
      <Link className="card" href={'/events/' + event.slug}>
        <div className="card-media">
          <EventImage src={event.coverImage || event.images?.[0]} fallbacks={event.images} alt={event.title} />
          <div className="date-badge">
            <strong>{d.getDate()}</strong>
            <span>
              {d.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase()}
              <br />
              {d.getFullYear()}
            </span>
          </div>
          {event.isFeatured && <span className="card-flag">Featured</span>}
        </div>
        <div className="card-body">
          <span className="pill">{event.category.name}</span>
          <h3>{event.title}</h3>
          {showDescription && event.shortDescription && (
            <p className="meta">{event.shortDescription}</p>
          )}
          <p className="meta">
            <MapPin className="icon" />
            {event.venue.name}, {event.venue.city}
          </p>
          <p className="meta">
            <Clock className="icon" />
            {d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}{' '}
            onwards
          </p>
          <div className="card-bottom">
            <span>
              {event.minPrice == null || !Number.isFinite(event.minPrice) || event.minPrice < 0 ? (
                'Tickets coming soon'
              ) : (
                <>
                  From <strong>{formatPrice(event.minPrice)}</strong>
                </>
              )}
            </span>
            <ArrowRight className="icon" />
          </div>
        </div>
      </Link>
      <div className="ep-card-save">
        <FavoriteButton eventId={event.id} />
      </div>
    </div>
  );
}
