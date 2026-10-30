'use client';

import Link from '@/components/ui/app-link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/organizer/events', label: 'My events' },
  { href: '/organizer/refunds', label: 'Refund requests' },
  { href: '/organizer/events/new', label: 'Create event' },
];

export function OrganizerGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  if (loading) {
    return (
      <div className="container flex min-h-64 items-center justify-center py-16" role="status">
        <span className="animate-pulse text-sm text-muted-foreground">Checking organizer access…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container flex max-w-lg flex-col items-center py-20 text-center">
        <h1 className="text-2xl font-semibold">Sign in to manage events</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your organizer tools are available after signing in.</p>
        <Link href="/signin" className={cn(buttonVariants(), 'mt-6')}>Sign in</Link>
      </div>
    );
  }

  if (user.role !== 'ORGANIZER' && user.role !== 'ADMIN') {
    return (
      <div className="container flex max-w-lg flex-col items-center py-20 text-center">
        <h1 className="text-2xl font-semibold">Organizer access required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Create an organizer profile from your dashboard to manage events.
        </p>
        <Link href="/dashboard" className={cn(buttonVariants(), 'mt-6')}>Open dashboard</Link>
      </div>
    );
  }

  return (
    <div className="container py-8 sm:py-10">
      <nav className="mb-8 flex flex-wrap gap-2 border-b pb-4" aria-label="Organizer navigation">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={pathname === link.href ? 'page' : undefined}
            className={cn(
              buttonVariants({ variant: pathname === link.href ? 'secondary' : 'ghost', size: 'sm' }),
            )}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
