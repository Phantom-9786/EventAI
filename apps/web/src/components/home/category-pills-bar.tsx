'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  LayoutGrid,
  Music2,
  Briefcase,
  Palette,
  UtensilsCrossed,
  Trophy,
  GraduationCap,
  Smile,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const CATEGORIES_WITH_ICONS = [
  { slug: '', name: 'All Events', icon: LayoutGrid, color: 'text-indigo-500 bg-indigo-500/10' },
  { slug: 'music', name: 'Music', icon: Music2, color: 'text-pink-500 bg-pink-500/10' },
  { slug: 'tech', name: 'Tech & Business', icon: Briefcase, color: 'text-blue-500 bg-blue-500/10' },
  { slug: 'arts', name: 'Arts & Culture', icon: Palette, color: 'text-purple-500 bg-purple-500/10' },
  { slug: 'food', name: 'Food & Drinks', icon: UtensilsCrossed, color: 'text-amber-500 bg-amber-500/10' },
  { slug: 'sports', name: 'Sports', icon: Trophy, color: 'text-emerald-500 bg-emerald-500/10' },
  { slug: 'workshops', name: 'Workshops', icon: GraduationCap, color: 'text-cyan-500 bg-cyan-500/10' },
  { slug: 'comedy', name: 'Comedy', icon: Smile, color: 'text-orange-500 bg-orange-500/10' },
  { slug: 'community', name: 'Community', icon: Users, color: 'text-teal-500 bg-teal-500/10' },
];

function CategoryPillsBarInner({ activeSlug }: { activeSlug?: string }) {
  const searchParams = useSearchParams();
  const currentCategory = (activeSlug !== undefined ? activeSlug : searchParams.get('category') || '').toLowerCase();

  return (
    <div className="w-full overflow-x-auto pb-2 scrollbar-none">
      <div className="flex items-center gap-2.5 min-w-max">
        {CATEGORIES_WITH_ICONS.map((cat) => {
          const isActive =
            cat.slug === '' ? !currentCategory : currentCategory.includes(cat.slug);
          const Icon = cat.icon;
          const href = cat.slug ? `/events?category=${encodeURIComponent(cat.name)}` : '/events';

          return (
            <Link
              key={cat.name}
              href={href}
              className={cn(
                'group flex items-center gap-2 rounded-2xl border px-3.5 py-2 text-xs font-semibold transition-all duration-150 select-none shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive
                  ? 'border-indigo-500/50 bg-indigo-600 text-white shadow-indigo-500/20 shadow-md'
                  : 'border-border/80 bg-card text-foreground hover:border-indigo-500/30 hover:bg-accent/80 hover:text-indigo-600 dark:hover:text-indigo-400',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-lg transition-colors',
                  isActive ? 'bg-white/20 text-white' : cat.color,
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
              </span>
              <span>{cat.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function CategoryPillsBar({ activeSlug }: { activeSlug?: string }) {
  return (
    <Suspense
      fallback={
        <div className="w-full overflow-x-auto pb-2 scrollbar-none">
          <div className="flex items-center gap-2.5 min-w-max">
            {CATEGORIES_WITH_ICONS.slice(0, 5).map((cat) => (
              <div
                key={cat.name}
                className="flex items-center gap-2 rounded-2xl border border-border/80 bg-card px-3.5 py-2 text-xs font-semibold text-muted-foreground"
              >
                <span>{cat.name}</span>
              </div>
            ))}
          </div>
        </div>
      }
    >
      <CategoryPillsBarInner activeSlug={activeSlug} />
    </Suspense>
  );
}

