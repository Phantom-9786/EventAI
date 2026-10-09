'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const navLinks = [
  { href: '/events', label: 'Discover' },
  { href: '/categories', label: 'Categories' },
  { href: '/venues', label: 'Venues' },
];

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  // Close the mobile menu when resizing up to desktop
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) setMobileOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg font-semibold tracking-tight"
          onClick={() => setMobileOpen(false)}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CalendarDays className="h-5 w-5" />
          </span>
          EventAI
        </Link>

        {/* Desktop navigation */}
        <nav className="hidden items-center gap-6 md:flex" aria-label="Main navigation">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          {loading ? (
            <span className="h-9 w-24 animate-pulse rounded-md bg-muted" aria-hidden />
          ) : user ? (
            <>
              <span className="max-w-[160px] truncate text-sm font-medium text-muted-foreground">
                Hi, {user.firstName ?? user.email}
              </span>
              <button
                type="button"
                className={cn(buttonVariants({ variant: 'ghost' }))}
                aria-label="Sign out"
                onClick={async () => {
                  await signOut();
                  router.push('/');
                  router.refresh();
                }}
              >
                <LogOut className="mr-1 h-4 w-4" />
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link href="/signin" className={buttonVariants({ variant: 'ghost' })}>
                Sign In
              </Link>
              <Link href="/signup" className={buttonVariants()}>
                Get Started
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu toggle */}
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent md:hidden"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          aria-label="Toggle navigation menu"
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile navigation */}
      <div
        id="mobile-nav"
        className={cn(
          'border-t bg-background md:hidden',
          mobileOpen ? 'block' : 'hidden',
        )}
      >
        <nav className="container flex flex-col gap-1 py-3" aria-label="Mobile navigation">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className="mt-2 flex gap-2 border-t pt-3">
            {user ? (
              <button
                type="button"
                className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}
                onClick={async () => {
                  setMobileOpen(false);
                  await signOut();
                  router.push('/');
                  router.refresh();
                }}
              >
                Sign Out
              </button>
            ) : (
              <>
                <Link
                  href="/signin"
                  className={cn(buttonVariants({ variant: 'outline' }), 'flex-1')}
                  onClick={() => setMobileOpen(false)}
                >
                  Sign In
                </Link>
                <Link
                  href="/signup"
                  className={cn(buttonVariants(), 'flex-1')}
                  onClick={() => setMobileOpen(false)}
                >
                  Get Started
                </Link>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
