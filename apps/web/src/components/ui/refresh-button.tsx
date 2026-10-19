'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, type ButtonProps } from './button';
import { cn } from '@/lib/utils';

type RefreshButtonProps = ButtonProps & {
  refreshing?: boolean;
  iconOnly?: boolean;
};

/** Shared refresh action: keep a brief rotation visible even for cached responses. */
export function RefreshButton({
  refreshing = false,
  iconOnly = false,
  onClick,
  disabled,
  className,
  ...props
}: RefreshButtonProps) {
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const active = refreshing || pending;
  return (
    <Button
      type="button"
      variant="outline"
      {...props}
      className={cn('ep-refresh-button', iconOnly && 'ep-refresh-icon-only', className)}
      disabled={disabled || active}
      aria-busy={active}
      onClick={async (event) => {
        const started = Date.now();
        clearTimeout(timer.current);
        setPending(true);
        try {
          await onClick?.(event);
        } finally {
          if (mounted.current)
            timer.current = setTimeout(
              () => setPending(false),
              Math.max(0, 650 - (Date.now() - started)),
            );
        }
      }}
    >
      <RefreshCw
        aria-hidden="true"
        className={cn('ep-refresh-icon', active && 'is-refreshing')}
      />
      <span className={iconOnly ? 'sr-only' : undefined}>Refresh</span>
    </Button>
  );
}
