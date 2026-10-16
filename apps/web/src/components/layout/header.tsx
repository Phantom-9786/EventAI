'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowLeftRight,
  Briefcase,
  CalendarDays,
  Compass,
  LayoutDashboard,
  LogOut,
  Menu,
  QrCode,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Ticket,
  User,
  X,
} from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { EmailVerificationBanner } from '@/components/auth/email-verification-banner';
import { buttonVariants } from '@/components/ui/button';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { cn } from '@/lib/utils';

const attendeeLinks = [
  { href: '/events', label: 'Discover Events', icon: Compass },
  { href: '/categories', label: 'Categories', icon: CalendarDays },
  { href: '/venues', label: 'Venues', icon: Compass },
  { href: '/ai', label: 'AI Assistant', icon: Sparkles },
];

const organizerLinks = [
  { href: '/dashboard', label: 'Overview', shortLabel: 'Overview', icon: LayoutDashboard },
  { href: '/organizer/events', label: 'Manage Events', shortLabel: 'Events', icon: CalendarDays },
  { href: '/organizer/events/new', label: 'Create Event', shortLabel: 'Create', icon: CalendarDays },
  { href: '/organizer/refunds', label: 'Refund Requests', shortLabel: 'Refunds', icon: RotateCcw },
  { href: '/dashboard/scan', label: 'Door Scanner', shortLabel: 'Scanner', icon: QrCode },
];

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isOrganizerSection =
    pathname.startsWith('/dashboard') || pathname.startsWith('/organizer');

  // Close the mobile menu when resizing up to desktop
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) setMobileOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container flex h-16 items-center justify-between gap-2 lg:gap-4">
        {/* Brand / Logo */}
        <div className="flex shrink-0 items-center gap-2.5">
          <Link
            href={isOrganizerSection ? '/dashboard' : '/'}
            className="flex items-center gap-2 text-lg font-bold tracking-tight"
            onClick={() => setMobileOpen(false)}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <CalendarDays className="h-5 w-5" />
            </span>
            <span className="hidden sm:inline">EventAI</span>
          </Link>
          {isOrganizerSection && (
            <span className="hidden sm:inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
              Organizer
            </span>
          )}
        </div>

        {/* Desktop navigation */}
        <nav
          className="hidden items-center gap-1 xl:gap-2 lg:flex shrink-0"
          aria-label={isOrganizerSection ? 'Organizer navigation' : 'Attendee navigation'}
        >
          {isOrganizerSection ? (
            organizerLinks.map((link) => {
              const active = pathname === link.href;
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors',
                    active
                      ? 'bg-primary/10 text-primary font-bold shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden xl:inline">{link.label}</span>
                  <span className="inline xl:hidden">{link.shortLabel}</span>
                </Link>
              );
            })
          ) : (
            attendeeLinks.map((link) => {
              const active = pathname === link.href;
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors hover:text-foreground',
                    active ? 'text-primary font-semibold' : 'text-muted-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                  <span>{link.label}</span>
                </Link>
              );
            })
          )}
        </nav>

        {/* Desktop actions & role switching */}
        <div className="hidden items-center gap-1.5 xl:gap-2.5 lg:flex shrink-0">
          {loading ? (
            <span className="h-8 w-20 animate-pulse rounded-md bg-muted" aria-hidden />
          ) : user ? (
            <>
              {isOrganizerSection ? (
                // Inside Organizer Hub: provide direct switch to Attendee mode
                <Link
                  href="/events"
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'gap-1.5 text-xs font-medium whitespace-nowrap shrink-0 h-8 px-2.5',
                  )}
                >
                  <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Attendee Mode</span>
                </Link>
              ) : (
                // Inside Attendee section: provide tickets and role switch if eligible
                <>
                  <Link
                    href="/tickets"
                    className={cn(
                      buttonVariants({ variant: 'ghost', size: 'sm' }),
                      'gap-1.5 text-xs font-medium whitespace-nowrap h-8 px-2.5',
                    )}
                  >
                    <Ticket className="h-3.5 w-3.5" />
                    <span>My Tickets</span>
                  </Link>

                  {user.role === 'ORGANIZER' ? (
                    <Link
                      href="/dashboard"
                      className={cn(
                        buttonVariants({ variant: 'outline', size: 'sm' }),
                        'gap-1.5 text-xs font-medium border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 whitespace-nowrap shrink-0 h-8 px-2.5',
                      )}
                    >
                      <Briefcase className="h-3.5 w-3.5" />
                      <span>Organizer Hub</span>
                    </Link>
                  ) : (
                    <Link
                      href="/dashboard"
                      className="px-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                    >
                      Become Organizer
                    </Link>
                  )}
                </>
              )}

              {user.role === 'ADMIN' && (
                <Link
                  href="/admin"
                  className={cn(
                    buttonVariants({
                      variant: pathname.startsWith('/admin') ? 'default' : 'ghost',
                      size: 'sm',
                    }),
                    'gap-1.5 h-8 px-2.5 text-xs font-semibold shrink-0',
                  )}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>Admin</span>
                </Link>
              )}

              <span className="inline max-w-[120px] truncate text-xs font-medium text-muted-foreground">
                Hi, {user.firstName ?? user.email}
              </span>

              <Link
                href="/account"
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'gap-1.5 text-xs font-medium h-8 px-2',
                )}
                aria-label="My Account"
                title="My Account"
              >
                <User className="h-4 w-4" />
                <span className="hidden xl:inline">Account</span>
              </Link>

              <button
                type="button"
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-8 w-8 p-0 text-muted-foreground hover:text-destructive')}
                aria-label="Sign out"
                title="Sign out"
                onClick={async () => {
                  await signOut();
                  router.push('/');
                  router.refresh();
                }}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <Link href="/signin" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-8 text-xs')}>
                Sign In
              </Link>
              <Link href="/signup" className={cn(buttonVariants({ size: 'sm' }), 'h-8 text-xs font-semibold')}>
                Get Started
              </Link>
            </>
          )}
          {user && <NotificationBell />}
          <ThemeToggle />
        </div>

        {/* Mobile / Tablet controls */}
        <div className="flex items-center gap-1.5 lg:hidden">
          {user && <NotificationBell />}
          <ThemeToggle />
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent border border-input/40"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label="Toggle navigation menu"
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <EmailVerificationBanner />

      {/* Mobile navigation drawer */}
      <div
        id="mobile-nav"
        className={cn(
          'border-t bg-background/95 backdrop-blur lg:hidden',
          mobileOpen ? 'block' : 'hidden',
        )}
      >
        <nav className="container flex flex-col gap-1 py-4" aria-label="Mobile navigation">
          {isOrganizerSection ? (
            <>
              <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
                Organizer Hub
              </p>
              {organizerLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
                    pathname === link.href ? 'text-primary font-semibold' : 'text-muted-foreground',
                  )}
                  onClick={() => setMobileOpen(false)}
                >
                  <link.icon className="h-4 w-4" />
                  {link.label}
                </Link>
              ))}
              <div className="my-2 border-t" />
              <Link
                href="/events"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
                onClick={() => setMobileOpen(false)}
              >
                <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                Switch to Attendee Mode
              </Link>
            </>
          ) : (
            <>
              <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Discover
              </p>
              {attendeeLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
                    pathname === link.href ? 'text-primary font-semibold' : 'text-muted-foreground',
                  )}
                  onClick={() => setMobileOpen(false)}
                >
                  <link.icon className="h-4 w-4" />
                  {link.label}
                </Link>
              ))}
              {user && (
                <>
                  <Link
                    href="/tickets"
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
                    onClick={() => setMobileOpen(false)}
                  >
                    <Ticket className="h-4 w-4 text-primary" />
                    My Tickets
                  </Link>
                  {user.role === 'ORGANIZER' ? (
                    <Link
                      href="/dashboard"
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-primary hover:bg-accent"
                      onClick={() => setMobileOpen(false)}
                    >
                      <Briefcase className="h-4 w-4" />
                      Switch to Organizer Hub
                    </Link>
                  ) : (
                    <Link
                      href="/dashboard"
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
                      onClick={() => setMobileOpen(false)}
                    >
                      <Briefcase className="h-4 w-4" />
                      Become an Organizer
                    </Link>
                  )}
                </>
              )}
            </>
          )}

          {user && (
            <Link
              href="/account"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
              onClick={() => setMobileOpen(false)}
            >
              <User className="h-4 w-4 text-muted-foreground" />
              My Account & Settings
            </Link>
          )}

          {user?.role === 'ADMIN' && (
            <Link
              href="/admin"
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                pathname.startsWith('/admin')
                  ? 'bg-primary/10 text-primary font-bold'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              onClick={() => setMobileOpen(false)}
            >
              <ShieldCheck className="h-4 w-4" />
              Platform Admin
            </Link>
          )}

          <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
            <ThemeToggle />
            {user ? (
              <button
                type="button"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'flex-1')}
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
              <div className="flex flex-1 gap-2">
                <Link
                  href="/signin"
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'flex-1 text-center')}
                  onClick={() => setMobileOpen(false)}
                >
                  Sign In
                </Link>
                <Link
                  href="/signup"
                  className={cn(buttonVariants({ size: 'sm' }), 'flex-1 text-center')}
                  onClick={() => setMobileOpen(false)}
                >
                  Get Started
                </Link>
              </div>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
