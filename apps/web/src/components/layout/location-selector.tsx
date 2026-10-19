'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { MapPin, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const POPULAR_CITIES = [
  { id: 'all', label: 'All Cities', value: '' },
  { id: 'bengaluru', label: 'Bengaluru', value: 'Bengaluru' },
  { id: 'mumbai', label: 'Mumbai', value: 'Mumbai' },
  { id: 'delhi', label: 'Delhi NCR', value: 'Delhi' },
  { id: 'hyderabad', label: 'Hyderabad', value: 'Hyderabad' },
  { id: 'pune', label: 'Pune', value: 'Pune' },
  { id: 'chennai', label: 'Chennai', value: 'Chennai' },
  { id: 'goa', label: 'Goa', value: 'Goa' },
];

function LocationSelectorInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentCityParam = searchParams.get('city') || '';
  const currentCity =
    POPULAR_CITIES.find((c) => c.value.toLowerCase() === currentCityParam.toLowerCase()) ||
    (currentCityParam ? { id: 'custom', label: currentCityParam, value: currentCityParam } : POPULAR_CITIES[1]); // Default to Bengaluru

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectCity = (cityValue: string) => {
    setOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    if (cityValue) {
      params.set('city', cityValue);
    } else {
      params.delete('city');
    }
    params.delete('page'); // Reset to page 1

    if (pathname === '/events') {
      router.push(`/events?${params.toString()}`);
    } else {
      router.push(`/events?${params.toString()}`);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/60 px-3 py-1.5 text-xs font-semibold text-foreground transition-all duration-150 hover:bg-accent/60 hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring select-none shadow-sm',
          open && 'ring-2 ring-primary/40 border-primary/50',
        )}
      >
        <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="max-w-[100px] sm:max-w-[120px] truncate">{currentCity.label}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 sm:right-0 sm:left-auto mt-2 w-48 rounded-xl border border-border bg-popover/95 p-1.5 shadow-xl backdrop-blur-md z-50 animate-fade-in"
        >
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Select Location
          </div>
          <div className="mt-1 space-y-0.5">
            {POPULAR_CITIES.map((city) => {
              const isSelected = city.value.toLowerCase() === currentCity.value.toLowerCase();
              return (
                <button
                  key={city.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelectCity(city.value)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors text-left',
                    isSelected
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <span>{city.label}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function LocationSelector() {
  return (
    <Suspense
      fallback={
        <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/60 px-3 py-1.5 text-xs font-semibold text-foreground">
          <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>Bengaluru</span>
        </div>
      }
    >
      <LocationSelectorInner />
    </Suspense>
  );
}

