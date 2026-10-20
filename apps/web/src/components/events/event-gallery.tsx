'use client';

import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Maximize2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EventGalleryProps {
  images: string[];
  eventTitle: string;
}

export function EventGallery({ images, eventTitle }: EventGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [mobileIndex, setMobileIndex] = useState(0);
  const [imageErrors, setImageErrors] = useState<Record<number, boolean>>({});
  const triggerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const mobileTouchStartX = useRef<number | null>(null);
  const mobileTouchEndX = useRef<number | null>(null);

  const isOpen = selectedIndex !== null;
  const currentIndex = selectedIndex ?? 0;
  const totalCount = images.length;

  const handleOpen = (index: number) => {
    setSelectedIndex(index);
  };

  const handleMobilePrev = () => {
    setMobileIndex((prev) => (prev === 0 ? totalCount - 1 : prev - 1));
  };

  const handleMobileNext = () => {
    setMobileIndex((prev) => (prev === totalCount - 1 ? 0 : prev + 1));
  };

  const handleMobileTouchStart = (e: React.TouchEvent) => {
    mobileTouchStartX.current = e.changedTouches[0].clientX;
  };

  const handleMobileTouchMove = (e: React.TouchEvent) => {
    mobileTouchEndX.current = e.changedTouches[0].clientX;
  };

  const handleMobileTouchEnd = () => {
    if (mobileTouchStartX.current !== null && mobileTouchEndX.current !== null) {
      const distance = mobileTouchStartX.current - mobileTouchEndX.current;
      if (distance > 40) {
        handleMobileNext();
      } else if (distance < -40) {
        handleMobilePrev();
      }
    }
    mobileTouchStartX.current = null;
    mobileTouchEndX.current = null;
  };

  const handleClose = useCallback(() => {
    const lastOpened = selectedIndex;
    setSelectedIndex(null);
    // Restore focus to the button that triggered the modal
    if (lastOpened !== null && triggerRefs.current[lastOpened]) {
      setTimeout(() => {
        triggerRefs.current[lastOpened]?.focus();
      }, 0);
    }
  }, [selectedIndex]);

  const handlePrev = useCallback(() => {
    setSelectedIndex((current) => {
      if (current === null) return 0;
      return current === 0 ? totalCount - 1 : current - 1;
    });
  }, [totalCount]);

  const handleNext = useCallback(() => {
    setSelectedIndex((current) => {
      if (current === null) return 0;
      return current === totalCount - 1 ? 0 : current + 1;
    });
  }, [totalCount]);

  // Keyboard navigation & body scroll lock
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, handleClose, handlePrev, handleNext]);

  // Touch swipe support for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.changedTouches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.changedTouches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current !== null && touchEndX.current !== null) {
      const distance = touchStartX.current - touchEndX.current;
      if (distance > 50) {
        handleNext();
      } else if (distance < -50) {
        handlePrev();
      }
    }
    touchStartX.current = null;
    touchEndX.current = null;
  };

  if (!images || images.length === 0) {
    return null;
  }

  return (
    <>
      {/* 1. Mobile Swipeable Carousel (< sm) */}
      <div className="mt-3 block sm:hidden min-w-0 max-w-full overflow-hidden">
        <div
          className="relative aspect-video w-full max-w-full overflow-hidden rounded-xl border bg-muted shadow-sm select-none"
          onTouchStart={handleMobileTouchStart}
          onTouchMove={handleMobileTouchMove}
          onTouchEnd={handleMobileTouchEnd}
        >
          <button
            type="button"
            onClick={() => handleOpen(mobileIndex)}
            aria-label={`View enlarged photo ${mobileIndex + 1} of ${totalCount}`}
            className="group relative h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={images[mobileIndex]}
              alt={`${eventTitle} gallery photo ${mobileIndex + 1}`}
              className="h-full w-full max-w-full object-cover transition-transform duration-300"
              loading="lazy"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
              <span className="rounded-full bg-black/60 p-2 text-white shadow backdrop-blur-sm">
                <Maximize2 className="h-4 w-4" />
              </span>
            </div>
          </button>

          {/* Mobile Prev / Next Buttons */}
          {totalCount > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMobilePrev();
                }}
                aria-label="Previous gallery image"
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/75 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMobileNext();
                }}
                aria-label="Next gallery image"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/75 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              {/* Mobile Counter Pill */}
              <div className="absolute bottom-2.5 right-2.5 z-10 rounded-full bg-black/60 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm pointer-events-none">
                {mobileIndex + 1} / {totalCount}
              </div>
            </>
          )}
        </div>

        {/* Mobile Pagination Dot Indicators */}
        {totalCount > 1 && (
          <div className="mt-2.5 flex items-center justify-center gap-1.5" aria-hidden="true">
            {images.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setMobileIndex(idx)}
                aria-label={`Go to slide ${idx + 1}`}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  idx === mobileIndex ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50',
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* 2. Desktop Gallery Thumbnail Grid (sm and up) */}
      <div className="mt-3 hidden sm:grid sm:grid-cols-3 md:grid-cols-4 gap-3 min-w-0 max-w-full">
        {images.map((imgUrl, index) => (
          <button
            key={`${imgUrl}-${index}`}
            ref={(el) => {
              triggerRefs.current[index] = el;
            }}
            type="button"
            onClick={() => handleOpen(index)}
            aria-haspopup="dialog"
            aria-label={`View photo ${index + 1} of ${totalCount} for ${eventTitle}`}
            className="group relative aspect-video w-full max-w-full overflow-hidden rounded-xl border bg-muted shadow-sm transition-all hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imgUrl}
              alt={`${eventTitle} gallery photo ${index + 1}`}
              className="h-full w-full max-w-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/25">
              <span className="rounded-full bg-black/60 p-1.5 text-white opacity-0 shadow backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100">
                <Maximize2 className="h-4 w-4" />
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Lightbox Modal */}
      {isOpen && (
        <div
          id="event-gallery-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Image viewer for ${eventTitle}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-3 sm:p-6 backdrop-blur-md select-none animate-fade-in"
          onClick={(e) => {
            // Close when clicking the backdrop, but not when clicking inside image controls
            if (e.target === e.currentTarget) {
              handleClose();
            }
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Top Bar: Counter & Close Button */}
          <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between p-4 sm:p-6 bg-gradient-to-b from-black/80 to-transparent">
            <div className="rounded-full bg-white/10 px-3 py-1 text-xs sm:text-sm font-medium text-white backdrop-blur-sm">
              <span aria-live="polite">
                {currentIndex + 1} of {totalCount}
              </span>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close image viewer"
              className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Previous Button */}
          {totalCount > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
              aria-label="Previous image"
              className="absolute left-2 sm:left-6 z-20 rounded-full bg-white/10 p-2.5 sm:p-3 text-white/80 hover:bg-white/20 hover:text-white transition-colors backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          {/* Main Enlarged Image */}
          <div
            className="relative flex max-h-[calc(82vh/var(--ep-ui-scale))] max-w-[calc(92vw/var(--ep-ui-scale))] items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {imageErrors[currentIndex] ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-neutral-900 p-12 text-center text-white/70">
                <ImageOff className="h-12 w-12 text-white/40 mb-3" />
                <p className="text-sm font-medium">Unable to load image</p>
                <p className="mt-1 text-xs text-white/40">The image file could not be displayed.</p>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={images[currentIndex]}
                alt={`${eventTitle} enlarged photo ${currentIndex + 1}`}
                onError={() => {
                  setImageErrors((prev) => ({ ...prev, [currentIndex]: true }));
                }}
                className="max-h-[calc(82vh/var(--ep-ui-scale))] max-w-[calc(92vw/var(--ep-ui-scale))] rounded-lg object-contain shadow-2xl transition-opacity duration-200"
              />
            )}
          </div>

          {/* Next Button */}
          {totalCount > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              aria-label="Next image"
              className="absolute right-2 sm:right-6 z-20 rounded-full bg-white/10 p-2.5 sm:p-3 text-white/80 hover:bg-white/20 hover:text-white transition-colors backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}

          {/* Bottom Caption / Event Title */}
          <div className="absolute bottom-3 sm:bottom-6 z-20 max-w-[80vw] truncate rounded-full bg-black/60 px-4 py-1.5 text-xs text-white/70 backdrop-blur-sm pointer-events-none">
            {eventTitle}
          </div>
        </div>
      )}
    </>
  );
}
