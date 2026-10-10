import Link from 'next/link';
import Image from 'next/image';
import { CalendarDays, MapPin, Ticket } from 'lucide-react';
import type { EventSummary } from '@/lib/api';
import { formatEventDate, formatPriceRange } from '@/lib/api';
import { cn } from '@/lib/utils';

export function EventCard({
  event,
  showDescription = false,
}: {
  event: EventSummary;
  /** Optional: render the short description (used by the AI assistant cards). */
  showDescription?: boolean;
}) {
  return (
    <Link
      href={`/events/${event.slug}`}
      className="group flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="relative flex h-40 items-center justify-center overflow-hidden bg-muted">
        {event.images[0] ? (
          <Image
            src={event.images[0]}
            alt={event.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
            className="object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <CalendarDays
            className="h-12 w-12 text-muted-foreground/40 transition-transform group-hover:scale-110"
            aria-hidden
          />
        )}
        {event.isFeatured && (
          <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            Featured
          </span>
        )}
        {event.category.name && (
          <span className="absolute right-2 top-2 rounded-full border bg-background/90 px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {event.category.name}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 font-semibold leading-snug group-hover:text-primary">
          {event.title}
        </h3>
        {showDescription && event.shortDescription && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {event.shortDescription}
          </p>
        )}
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          {formatEventDate(event.startDate)}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {event.venue.name}, {event.venue.city}
          </span>
        </p>
        <div
          className={cn(
            'mt-auto flex items-center justify-between border-t pt-3 text-sm',
          )}
        >
          <span className="flex items-center gap-1.5 font-medium">
            <Ticket className="h-4 w-4 text-primary" />
            {formatPriceRange(event.minPrice, event.maxPrice)}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            by {event.organizer.organizationName}
          </span>
        </div>
      </div>
    </Link>
  );
}
