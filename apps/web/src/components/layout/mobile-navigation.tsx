'use client';
import { lockPageScroll } from '@/lib/scroll-lock';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from '@/components/ui/app-link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftRight, Bell, LayoutDashboard, LogOut, Menu, Settings, ShieldCheck, Ticket, X } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { ThemeToggle } from './theme-toggle';
import { admin, attendee, organizer } from './workspace-navigation';
import { AdminQueueBadge } from '@/components/admin/pending-counts';

function WorkspaceLinks({ close }: { close: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { user } = useAuth();
  const isAdmin = pathname === '/admin' && user?.role === 'ADMIN';
  const isOrganizer = pathname.startsWith('/organizer') || pathname.startsWith('/dashboard');
  const links = isAdmin ? admin : isOrganizer ? organizer : attendee;
  return (
    <nav aria-label="Mobile workspace navigation" className="ep-mobile-menu-links">
      {links.map(([href, label, Icon]) => {
        const [path, query] = href.split('?');
        const active = pathname === path && (query
          ? new URLSearchParams(query).get(isAdmin ? 'tab' : 'view') === (params.get(isAdmin ? 'tab' : 'view') ?? (isAdmin ? 'overview' : ''))
          : !params.get('view'));
        return <Link key={href} href={href} aria-current={active ? 'page' : undefined}
          onClick={() => {
            window.dispatchEvent(new CustomEvent('eventpoint:workspace-navigation', { detail: href }));
            close();
          }}><Icon className="icon" />{label}{isAdmin && <AdminQueueBadge section={new URLSearchParams(query).get('tab') ?? 'overview'} />}</Link>;
      })}
    </nav>
  );
}

export function MobileNavigation({ dashboard, workspace, canOrganize, hasApplication }: {
  dashboard: string; workspace: boolean; canOrganize: boolean; hasApplication: boolean;
}) {
  const { user, loading, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const show = () => { if (window.matchMedia('(max-width: 900px)').matches) setOpen(true); };
    window.addEventListener('eventpoint:open-mobile-menu', show);
    return () => window.removeEventListener('eventpoint:open-mobile-menu', show);
  }, []);
  useEffect(() => {
    if (!open || !dialog.current) return;
    const node = dialog.current;
    const opener = trigger.current;
    node.showModal();
    const unlockScroll = lockPageScroll();
    const mobile = window.matchMedia('(max-width: 900px)');
    const resized = () => { if (!mobile.matches) setOpen(false); };
    mobile.addEventListener('change', resized);
    return () => {
      if (node.open) node.close();
      unlockScroll();
      mobile.removeEventListener('change', resized);
      opener?.focus({ preventScroll: true });
    };
  }, [open]);
  const close = () => setOpen(false);
  return <>
    <button ref={trigger} type="button" className="ep-mobile-menu-trigger"
      aria-label="Open navigation menu" aria-haspopup="dialog" aria-expanded={open}
      aria-controls="ep-mobile-menu" onClick={() => setOpen(true)}>
      <Menu className="icon" /><span>Menu</span>{user?.role === 'ADMIN' && <AdminQueueBadge />}
    </button>
    <dialog ref={dialog} id="ep-mobile-menu" className="ep-mobile-menu"
      aria-labelledby="ep-mobile-menu-title" onClose={close}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }}>
      <div className="ep-mobile-menu-heading">
        <h2 id="ep-mobile-menu-title">Your EventPoint</h2>
        <button type="button" aria-label="Close navigation menu" className="icon-btn" onClick={close}><X className="icon" /></button>
      </div>
      <div className="ep-mobile-menu-scroll">
        {loading ? <p role="status">Checking sign-in…</p> : user ? <>
          <div className="ep-mobile-menu-person">
            <span className="account-monogram">{user.firstName?.slice(0, 1) || 'E'}{user.lastName?.slice(0, 1) || ''}</span>
            <div><strong>{[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Your account'}</strong><p>{user.email}</p></div>
          </div>
          <p className="ep-mobile-menu-label">{pathname === '/admin' ? 'Admin workspace' : workspace ? 'Organizer workspace' : 'Your account'}</p>
          <Suspense fallback={null}><WorkspaceLinks close={close} /></Suspense>
          {workspace && <nav className="ep-mobile-menu-links" aria-label="Personal account">
            <Link href="/account" onClick={close}><Settings className="icon" />Profile & settings</Link>
            <Link href="/bookings" onClick={close}><Ticket className="icon" />My tickets & bookings</Link>
            <Link href="/notifications" onClick={close}><Bell className="icon" />Notifications</Link>
          </nav>}
          <p className="ep-mobile-menu-label">Switch workspace</p>
          <nav className="ep-mobile-menu-links" aria-label="Switch workspace">
            <Link href={workspace ? '/overview' : '/dashboard'} onClick={close}><ArrowLeftRight className="icon" />
              {workspace ? 'Attendee view' : canOrganize ? 'Organizer' : hasApplication ? 'Organizer application' : 'Become an organizer'}
            </Link>
            {user.role === 'ADMIN' && pathname !== '/admin' && <Link href="/admin" onClick={close}><ShieldCheck className="icon" />Admin workspace<AdminQueueBadge /></Link>}
            {workspace && <Link href={dashboard} onClick={close}><LayoutDashboard className="icon" />My Dashboard</Link>}
          </nav>
        </> : <>
          <p className="muted">Sign in to keep your tickets, bookings and saved events together.</p>
          <nav className="ep-mobile-menu-links" aria-label="Account access">
            <Link href="/signin" onClick={close}>Sign in</Link>
            <Link href="/signup" onClick={close}>Create an account</Link>
          </nav>
        </>}
        <div className="ep-mobile-menu-theme"><span>Appearance</span>{open && <ThemeToggle />}</div>
        {user && <button type="button" className="ep-mobile-signout" disabled={signingOut} onClick={async () => {
          setSigningOut(true); setError('');
          try { await signOut(); close(); router.push('/'); router.refresh(); }
          catch { setError('Unable to sign out. Please try again.'); }
          finally { setSigningOut(false); }
        }}><LogOut className="icon" />{signingOut ? 'Signing out…' : 'Sign out'}</button>}
        {error && <p role="alert">{error}</p>}
      </div>
    </dialog>
  </>;
}
