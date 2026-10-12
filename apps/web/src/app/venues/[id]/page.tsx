import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowRight, BadgeCheck, MapPin, Navigation, Users } from 'lucide-react';
import { getVenue } from '@/lib/api';
import { getDirectionsUrl } from '@/lib/maps';
import { VenueMap } from '@/components/venues/venue-map';

interface VenueDetailPageProps {
  params: { id: string };
}

export async function generateMetadata({ params }: VenueDetailPageProps): Promise<Metadata> {
  const venue = await getVenue(params.id).catch(() => null);
  if (!venue) return { title: 'Venue not found' };
  return {
    title: venue.name,
    description: `${venue.name} — ${venue.address}, ${venue.city}. Capacity ${venue.capacity}.`,
  };
}

export default async function VenueDetailPage({ params }: VenueDetailPageProps) {
  const venue = await getVenue(params.id).catch(() => null);
  if (!venue) notFound();

  const totalSeats = venue.seatSections.reduce((sum, s) => sum + s.totalSeats, 0);

  return (
    <div className="container py-10">
      <Link
        href="/venues"
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        &larr; All venues
      </Link>

      <div className="mt-6 flex h-48 items-center justify-center overflow-hidden rounded-xl border bg-muted lg:h-64">
        {venue.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={venue.images[0]} alt={venue.name} className="h-full w-full object-cover" />
        ) : (
          <MapPin className="h-14 w-14 text-muted-foreground/40" aria-hidden />
        )}
      </div>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_320px]">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{venue.name}</h1>
          <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            {venue.address}, {venue.city}, {venue.state} {venue.zipCode}, {venue.country}
          </p>
          <a
            href={getDirectionsUrl(venue)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <Navigation className="h-4 w-4" />
            Get directions
          </a>
          {venue.description && (
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {venue.description}
            </p>
          )}

          {venue.latitude != null && venue.longitude != null && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">Location</h2>
              <div className="mt-3">
                <VenueMap lat={venue.latitude} lng={venue.longitude} name={venue.name} />
              </div>
            </section>
          )}

          {venue.amenities.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">Amenities</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {venue.amenities.map((amenity) => (
                  <span
                    key={amenity}
                    className="rounded-full border px-3 py-1 text-xs text-muted-foreground"
                  >
                    {amenity}
                  </span>
                ))}
              </div>
            </section>
          )}

          {venue.seatSections.length > 0 && (
            <section className="mt-10">
              <h2 className="text-lg font-semibold">Seating sections</h2>
              <div className="mt-3 divide-y rounded-lg border">
                {venue.seatSections.map((section) => (
                  <div
                    key={section.id}
                    className="flex items-center justify-between p-4 text-sm"
                  >
                    <span className="font-medium">{section.name}</span>
                    <span className="text-muted-foreground">
                      {section.rows} rows × {section.seatsPerRow} seats ·{' '}
                      {section.totalSeats.toLocaleString('en-IN')} seats
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              Capacity
            </p>
            <p className="mt-1 text-3xl font-bold">
              {venue.capacity.toLocaleString('en-IN')}
            </p>
            {totalSeats > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">
                {totalSeats.toLocaleString('en-IN')} seats across {venue.seatSections.length}{' '}
                section{venue.seatSections.length === 1 ? '' : 's'}
              </p>
            )}
            <p className="mt-4 border-t pt-4 text-sm font-medium">Run by</p>
            <p className="mt-1 flex items-center gap-1.5 font-semibold">
              {venue.organizer.organizationName}
              {venue.organizer.isVerified && (
                <BadgeCheck className="h-4 w-4 text-primary" aria-label="Verified organizer" />
              )}
            </p>
            <Link
              href={`/events?city=${encodeURIComponent(venue.city)}`}
              className="mt-5 flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Events in {venue.city}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
