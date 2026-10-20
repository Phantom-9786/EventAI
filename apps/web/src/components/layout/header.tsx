'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeftRight, ShieldCheck, Ticket } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { EmailVerificationBanner } from '@/components/auth/email-verification-banner';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { getOrganizerProfile, type OrganizerProfile } from '@/lib/organizer';
import { BrandIcon } from '@/components/layout/brand-logo';
export function Header() {
  const { user, loading, signOut } = useAuth();
  const pathname = usePathname(),
    router = useRouter();
  const [open, setOpen] = useState(false),
    [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      document.documentElement.style.setProperty(
        '--ep-header-height',
        // Layout pixels stay correct when the desktop UI has CSS zoom.
        (entry?.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight) + 'px',
      ),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const workspace =
    pathname.startsWith('/organizer') ||
    pathname.startsWith('/dashboard') ||
    pathname === '/admin';
  const [organizerProfile, setOrganizerProfile] = useState<OrganizerProfile | null>(null);
  useEffect(() => {
    let live = true;
    setOrganizerProfile(null);
    if (user?.role === 'CUSTOMER')
      getOrganizerProfile()
        .then((p) => {
          if (live) setOrganizerProfile(p);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [user?.id, user?.role]);
  const canOrganize =
    user?.role === 'ORGANIZER' ||
    user?.role === 'ADMIN' ||
    Boolean(
      organizerProfile?.isVerified && organizerProfile.applicationStatus === 'APPROVED',
    );
  const dashboard =
    pathname === '/admin'
      ? '/admin'
      : workspace && canOrganize
        ? '/dashboard'
        : '/overview';
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', key);
    };
  }, []);
  return (
    <header className="header-shell" ref={headerRef}>
      <div className="wrap header">
        <Link href="/" className="brand" aria-label="EventPoint home">
          <BrandIcon />
          <span className="ep-brand-stack">
            <span className="ep-brand-name">
              Event<b>Point</b>
            </span>
            <small>Discover · Book · Experience</small>
          </span>
        </Link>
        <nav className="app-nav" aria-label="Main navigation">
          <Link href="/" className={pathname === '/' ? 'active' : ''}>
            Home
          </Link>
          <Link href="/events" className={pathname.startsWith('/events') ? 'active' : ''}>
            Discover
          </Link>
          <Link href="/venues" className={pathname.startsWith('/venues') ? 'active' : ''} aria-current={pathname.startsWith('/venues') ? 'page' : undefined}>Venues</Link>
          <Link href="/ai" className={pathname === '/ai' ? 'active' : ''} aria-current={pathname === '/ai' ? 'page' : undefined}>AI assistant</Link>
          <Link
            className={
              'dashboard-access ' +
              (['/overview', '/dashboard', '/admin'].includes(pathname) ? 'active' : '')
            }
            href={user ? dashboard : '/signin?returnUrl=/overview'}
          >
            My Dashboard
          </Link>
        </nav>
        <div className="head-actions">
          {!workspace && user && (
            <Link href="/bookings" className="ep-my-bookings" aria-label="My tickets and bookings">
              <Ticket className="icon" /> My Tickets
            </Link>
          )}
          {loading ? (
            <span className="meta" role="status">
              Checking sign-in…
            </span>
          ) : user ? (
            <>
              <Link
                className="workspace-switch"
                href={workspace ? '/overview' : '/dashboard'}
              >
                <ArrowLeftRight className="icon" />
                <span>
                  {workspace
                    ? 'Attendee view'
                    : canOrganize
                      ? 'Organizer'
                      : organizerProfile
                        ? 'Organizer application'
                        : 'Become an organizer'}
                </span>
              </Link>
              {user.role === 'ADMIN' && (
                <Link
                  className={'admin-switch ' + (pathname === '/admin' ? 'selected' : '')}
                  href="/admin"
                >
                  <ShieldCheck className="icon" />
                  <span>Admin</span>
                </Link>
              )}
            </>
          ) : (
            <>
              <Link className="btn outline" href="/signin">
                Sign in
              </Link>
              <Link className="btn outline" href="/signup">
                Get started
              </Link>
            </>
          )}
          {user && (
            <div className="account-control" ref={ref}>
              <button
                className="account-trigger"
                type="button"
                aria-label="Account menu"
                aria-expanded={open}
                aria-controls="account-popover"
                onClick={() => setOpen(!open)}
              >
                <span className="account-monogram">
                  {user.firstName?.slice(0, 1) || 'E'}
                  {user.lastName?.slice(0, 1) || ''}
                </span>
              </button>
              <div className="account-popover" id="account-popover" hidden={!open}>
                <p>{user.firstName || user.email}</p>
                <Link href="/overview">My Dashboard</Link>
                <Link href="/account">Personal profile & settings</Link>{workspace&&pathname!=="/admin"&&<Link href="/organizer/settings">Organization settings</Link>}
                <Link href="/bookings">My bookings</Link>
                <Link href="/tickets">Digital tickets</Link>
                <Link
                  href="/overview?view=saved"
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  Saved events
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await signOut();
                      setOpen(false);
                      router.push('/');
                      router.refresh();
                    } catch {
                      setError('Unable to sign out. Please try again.');
                    }
                  }}
                >
                  Sign out
                </button>
                {error && <p role="alert">{error}</p>}
              </div>
            </div>
          )}
          {user && (
            <div className="ep-notifications">
              <NotificationBell />
            </div>
          )}
          <ThemeToggle />
        </div>
      </div>
      <EmailVerificationBanner />
    </header>
  );
}
