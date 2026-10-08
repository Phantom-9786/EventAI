import Link from 'next/link';
import { ArrowRight, CalendarDays, MapPin, Sparkles, Ticket } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const features = [
  {
    icon: Sparkles,
    title: 'AI-Powered Discovery',
    description:
      'Describe what you are in the mood for and let our AI assistant find the perfect event for you.',
  },
  {
    icon: Ticket,
    title: 'Instant Digital Tickets',
    description:
      'QR-coded digital tickets delivered the moment your booking is confirmed. No queues, no printing.',
  },
  {
    icon: MapPin,
    title: 'Venue Maps & Seating',
    description:
      'Explore venues on an interactive map and pick your seats with a live availability view.',
  },
];

const categories = [
  'Music',
  'Tech',
  'Sports',
  'Food & Drink',
  'Arts & Theatre',
  'Business',
];

export default function HomePage() {
  return (
    <div className="animate-fade-in">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,hsl(var(--accent)),transparent_60%)]"
          aria-hidden
        />
        <div className="container flex flex-col items-center gap-6 py-24 text-center md:py-32">
          <span className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs font-medium text-accent-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            Your AI event concierge is here
          </span>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Discover. Book. <span className="text-primary">Experience.</span>
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Find the best events around you, book tickets in seconds, and let AI
            handle the rest — from recommendations to instant digital tickets.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/events" className={cn(buttonVariants({ size: 'lg' }))}>
              Explore Events
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
            <Link
              href="/ai"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}
            >
              Ask the AI Assistant
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="container py-16">
        <div className="grid gap-6 md:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-lg border bg-card p-6 shadow-sm"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <feature.icon className="h-5 w-5" />
              </span>
              <h2 className="mt-4 text-lg font-semibold">{feature.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Categories */}
      <section className="container py-8 pb-20">
        <h2 className="text-2xl font-semibold tracking-tight">
          Browse by category
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          From concerts to conferences — there is something for everyone.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {categories.map((category) => (
            <Link
              key={category}
              href={`/events?category=${encodeURIComponent(category)}`}
              className={cn(
                buttonVariants({ variant: 'secondary', size: 'sm' }),
                'rounded-full',
              )}
            >
              <CalendarDays className="mr-1 h-3.5 w-3.5" />
              {category}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
