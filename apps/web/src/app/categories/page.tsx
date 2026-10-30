import Link from '@/components/ui/app-link';
import type { Metadata } from 'next';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { getCategories } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Event Categories',
  description: 'Browse events by category — music, tech, sports, food & drink, and more.',
};

export default async function CategoriesPage() {
  const categories = await getCategories().catch(() => []);

  return (
    <div className="container py-10">
      <h1 className="text-3xl font-bold tracking-tight">Browse by category</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        From concerts to conferences — there is something for everyone.
      </p>

      {categories.length === 0 ? (
        <div className="mt-16 rounded-lg border border-dashed p-12 text-center">
          <p className="text-lg font-medium">No categories available</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The API may be offline — try again shortly.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/events?category=${encodeURIComponent(category.slug)}`}
              className="group flex items-center gap-4 rounded-lg border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg"
                style={
                  category.color
                    ? { backgroundColor: `${category.color}22`, color: category.color }
                    : { backgroundColor: 'hsl(var(--accent))', color: 'hsl(var(--accent-foreground))' }
                }
              >
                <CalendarDays className="h-6 w-6" aria-hidden />
              </span>
              <span className="flex-1">
                <span className="block font-semibold group-hover:text-primary">
                  {category.name}
                </span>
                <span className="text-sm text-muted-foreground">
                  {category._count?.events ?? 0} event{(category._count?.events ?? 0) === 1 ? '' : 's'}
                </span>
              </span>
              <ChevronRight
                className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
