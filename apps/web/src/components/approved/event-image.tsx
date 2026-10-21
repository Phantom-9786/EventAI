'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';

function cloudinarySize(src: string, width: number): string {
  // Only transform unsigned Cloudinary uploads; other providers keep their URLs.
  if (!/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/(?!s--)/.test(src)) return src;
  return src.replace('/image/upload/', `/image/upload/f_auto,q_auto,c_limit,w_${width}/`);
}

export function EventImage({ src, alt, className = '', loading = 'lazy', fallbacks = [], onImageFailed, fullResolution = false, sizes }: {
  src?: string | null; alt: string; className?: string; loading?: 'lazy' | 'eager';
  fallbacks?: string[]; onImageFailed?: () => void; fullResolution?: boolean; sizes?: string;
}) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [originalOnly, setOriginalOnly] = useState<Set<string>>(() => new Set());
  const image = useRef<HTMLImageElement>(null);
  const candidate = [src, ...fallbacks].find((value): value is string => Boolean(value) && !failed.has(value as string));
  const optimized = Boolean(candidate && !fullResolution && !originalOnly.has(candidate) && cloudinarySize(candidate, 960) !== candidate);
  const fail = useCallback(() => {
    if (!candidate) return;
    // A strict transformation policy may reject a resized URL while the original is valid.
    if (optimized) { setOriginalOnly(old => new Set(old).add(candidate)); return; }
    setFailed(old => new Set(old).add(candidate));
    onImageFailed?.();
  }, [candidate, optimized, onImageFailed]);
  useEffect(() => {
    if (candidate && image.current?.complete && image.current.naturalWidth === 0) fail();
  }, [candidate, fail]);
  return candidate ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={candidate + String(optimized)} ref={image}
      src={optimized ? cloudinarySize(candidate, 960) : candidate}
      srcSet={optimized ? [160, 320, 640, 960, 1600].map(width => `${cloudinarySize(candidate, width)} ${width}w`).join(', ') : undefined}
      sizes={optimized ? sizes ?? '(max-width: 600px) 100vw, (max-width: 1200px) 50vw, 33vw' : undefined}
      alt={alt} className={className} loading={loading} decoding="async" onError={fail} />
  ) : <div className={'ep-empty-media ' + className} role="img" aria-label={'Image unavailable for ' + alt}><CalendarDays className="icon" /></div>;
}
