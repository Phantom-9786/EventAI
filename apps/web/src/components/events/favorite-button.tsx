'use client';

import { Heart } from 'lucide-react';
import { useFavorites } from '@/lib/favorites';
import { cn } from '@/lib/utils';

interface FavoriteButtonProps {
  eventId: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function FavoriteButton({ eventId, className, size = 'md' }: FavoriteButtonProps) {
  const { isFavorite, toggleFavorite, mounted } = useFavorites();
  const active = mounted && isFavorite(eventId);

  const sizeClasses = {
    sm: 'h-7 w-7 p-1',
    md: 'h-8 w-8 p-1.5',
    lg: 'h-10 w-10 p-2',
  }[size];

  const iconSizes = {
    sm: 'h-3.5 w-3.5',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  }[size];

  return (
    <button
      type="button"
      aria-label={active ? 'Remove from saved events' : 'Save event to favorites'}
      title={active ? 'Remove from favorites' : 'Save to favorites'}
      className={cn(
        'group inline-flex items-center justify-center rounded-full transition-all duration-200 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring select-none shadow-sm',
        active
          ? 'bg-rose-500/15 text-rose-500 border border-rose-500/30 hover:bg-rose-500/25'
          : 'bg-black/40 text-white/90 backdrop-blur-md hover:bg-black/60 hover:text-white hover:scale-105',
        sizeClasses,
        className,
      )}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(eventId);
      }}
    >
      <Heart
        className={cn(
          iconSizes,
          'transition-all duration-200',
          active ? 'fill-rose-500 stroke-rose-500 scale-110' : 'stroke-current group-hover:scale-110',
        )}
      />
    </button>
  );
}
