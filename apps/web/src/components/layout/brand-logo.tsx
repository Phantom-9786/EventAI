import Link from '@/components/ui/app-link';
import { useId } from 'react';
import { cn } from '@/lib/utils';

interface BrandLogoProps {
  className?: string;
  showTagline?: boolean;
  size?: 'sm' | 'md' | 'lg';
  asLink?: boolean;
  href?: string;
}

/** Slanted ticket ribbon, traced in proportion to the supplied brand board. */
export function BrandIcon({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 100 110" fill="none" aria-hidden="true" className={cn('h-9 w-9 shrink-0', className)}>
      <defs>
        <linearGradient id={`${id}-ribbon`} x1="10" y1="98" x2="90" y2="8" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7C3AED" /><stop offset=".48" stopColor="#3935FF" /><stop offset="1" stopColor="#00C6EF" />
        </linearGradient>
      </defs>
      <path d="M19 29Q19 22 27 19L83 1Q96-3 96 11V21Q96 27 88 30L46 44Q40 46 40 53V75L85 60Q96 56 96 69V81Q96 87 89 90L28 110Q18 113 18 102V95L12 97Q7 99 7 92V79Q19 75 19 65Q19 55 7 55V44Q7 38 14 35L19 33Z" fill={`url(#${id}-ribbon)`} />
      <path d="M62 40Q64 50 75 52Q64 57 62 67Q58 57 49 55Q59 50 62 40Z" fill={`url(#${id}-ribbon)`} />
    </svg>
  );
}

export function BrandLogo({ className, showTagline = false, size = 'md', asLink = false, href = '/' }: BrandLogoProps) {
  const id = useId().replace(/:/g, '');
  const dimensions = { sm: 'h-7 w-[146px]', md: 'h-9 w-[177px]', lg: 'h-12 w-[232px]' }[size];
  const content = (
    <span className={cn('inline-flex shrink-0 flex-col', className)}>
      <span className="inline-flex items-center gap-2.5" aria-label="EventPoint">
        <BrandIcon className={size === 'lg' ? 'h-12 w-11' : size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'} />
        <svg viewBox="0 0 285 55" className={dimensions} aria-hidden="true">
          <defs><linearGradient id={`${id}-word`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#2563EB" /><stop offset="1" stopColor="#6D28FF" /></linearGradient></defs>
          <text x="0" y="42" fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize="48" letterSpacing="-2" fill="currentColor">Event</text>
          <text x="132" y="42" fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize="48" letterSpacing="-2" fill={`url(#${id}-word)`}>Point</text>
        </svg>
      </span>
      {showTagline && <span className="mt-3 text-[9px] font-medium uppercase tracking-[0.23em] text-muted-foreground">Discover · Book · Experience</span>}
    </span>
  );
  return asLink ? <Link href={href} className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{content}</Link> : content;
}
