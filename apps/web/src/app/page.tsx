import Link from 'next/link';
import { SmartDiscovery } from '@/components/home/smart-search';
import {
  ArrowRight,
  Sparkles,
  CalendarDays,
  Music,
  Briefcase,
  Utensils,
  Palette,
  Heart,
  GraduationCap,
  Grid2X2,
} from 'lucide-react';
import { getCategories, getCategorySpotlights, searchEvents } from '@/lib/api';
import { categorySpotlightCopy, categorySpotlightCover } from '@/lib/category-spotlights';
import { EventImage } from '@/components/approved/event-image';
import { EventCard } from '@/components/events/event-card';
export const dynamic = 'force-dynamic';
const categoryIcons = [
  Music,
  Briefcase,
  Palette,
  Utensils,
  Heart,
  GraduationCap,
  CalendarDays,
];
export default async function HomePage() {
  const [categories, result, spotlights] = await Promise.all([
    getCategories().catch(() => []),
    searchEvents({ sortBy: 'date', sortDir: 'asc', limit: 8 }).catch(() => null),
    getCategorySpotlights().catch(() => []),
  ]);
  const featured = result?.events ?? [];
  return (
    <>
      <SmartDiscovery categories={categories} />
      <div className="wrap category-strip" aria-label="Event categories">
        <Link href="/events" className="category active">
          <span className="cat-symbol">
            <Grid2X2 className="icon" />
          </span>
          All experiences
        </Link>
        {categories.slice(0, 7).map((c, i) => {
          const Icon = categoryIcons[i % categoryIcons.length];
          return (
            <Link
              href={'/events?category=' + encodeURIComponent(c.slug)}
              key={c.id}
              className="category"
            >
              <span className="cat-symbol">
                <Icon className="icon" />
              </span>
              {c.name}
            </Link>
          );
        })}
      </div>
      <section className="wrap section">
        <div className="section-heading">
          <div>
            <p className="small-label">Your next good plan</p>
            <h2>Something to look forward to</h2>
            <p>A little music, a new perspective, a different kind of weekend.</p>
          </div>
          <Link className="text-link" href="/events">
            Explore all
            <ArrowRight className="icon" />
          </Link>
        </div>
        <div className="ep-grid">
          {featured.slice(0, 4).map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
        {!featured.length && (
          <div className="empty">
            <CalendarDays className="icon" />
            <h2>
              {result
                ? 'Your next experience is on its way.'
                : 'Events are temporarily unavailable.'}
            </h2>
            <p>
              {result
                ? 'Published events will appear here.'
                : 'Please try discovery again shortly.'}
            </p>
            <Link href="/events" className="btn">
              Discover events
            </Link>
          </div>
        )}
        <div className="ai-banner">
          <div className="ai-art">
            <Sparkles className="icon" />
          </div>
          <div className="ai-copy">
            <p className="small-label">A little inspiration</p>
            <h2>Not sure what you’re in the mood for?</h2>
            <p>
              Start with a feeling. Your next favourite experience might surprise you.
            </p>
          </div>
          <Link className="btn outline" href="/ai">
            Meet your event assistant
            <ArrowRight className="icon" />
          </Link>
        </div>
      </section>
      {spotlights.length > 0 && <section className="wrap section">
        <div className="section-heading">
          <div>
            <p className="small-label">Change the pace</p>
            <h2>Make room for a little more</h2>
          </div>
        </div>
        <div className={'spotlight-grid' + (spotlights.length === 1 ? ' spotlight-single' : '')}>
          {spotlights.map(category => {
            const wording = categorySpotlightCopy(category);
            return <Link key={category.id} href={'/events?category=' + encodeURIComponent(category.slug)} className="spotlight">
              <EventImage src={categorySpotlightCover(category)} fallbacks={category.coverImage ? [category.coverImage] : []} alt={category.name + ' experiences'} className="ep-spotlight-cover" />
              <div>
                {wording.eyebrow && <span className="eyebrow">{wording.eyebrow}</span>}
                <h3>{wording.title}</h3>
                {wording.description && <p>{wording.description}</p>}
              </div>
              <span className="round-arrow"><ArrowRight className="icon" /></span>
            </Link>;
          })}
        </div>
      </section>}
    </>
  );
}
