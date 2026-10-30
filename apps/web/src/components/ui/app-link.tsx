'use client';

import NextLink from 'next/link';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

// Public pages read live API data. Speculative route preloads can wake Neon
// for every visible event card even when the visitor never opens an event.
// Keep normal Next.js click navigation, history and accessibility intact.
const AppLink = forwardRef<HTMLAnchorElement, ComponentPropsWithoutRef<typeof NextLink>>(
  function AppLink(props, ref) {
    return <NextLink {...props} prefetch={false} ref={ref} />;
  },
);

export default AppLink;
