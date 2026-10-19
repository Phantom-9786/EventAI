'use client';

import { useState } from 'react';
import { Share2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function EventShareButton({ eventTitle }: { eventTitle: string }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    try {
      if (typeof window !== 'undefined') {
        const url = window.location.href;
        if (navigator.share) {
          await navigator.share({
            title: eventTitle,
            text: `Check out ${eventTitle} on EventPoint!`,
            url,
          });
          return;
        }
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // User cancelled or clipboard permission denied
    }
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      className={cn(
        'group inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-all duration-150 hover:bg-black/60 active:scale-95 shadow-sm',
        copied && 'bg-emerald-600 text-white',
      )}
      title={copied ? 'Link copied to clipboard!' : 'Share event'}
      aria-label="Share event"
    >
      {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
    </button>
  );
}
