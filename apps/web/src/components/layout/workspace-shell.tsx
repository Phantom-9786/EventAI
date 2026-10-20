'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { attendee, organizer, admin } from './workspace-navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { cn } from '@/lib/utils';

function WorkspaceShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const searchParams = useSearchParams();
  const query = searchParams.toString() ? '?' + searchParams.toString() : '';
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('eventpoint_sidebar_collapsed') === 'true');
    } catch {
      /* Storage is optional. */
    }
  }, []);
  const isAdmin = pathname === '/admin';
  const isOrganizer =
    pathname.startsWith('/organizer') || pathname.startsWith('/dashboard');
  const workspace =
    [
      '/overview',
      '/bookings',
      '/tickets',
      '/calendar',
      '/account',
      '/notifications',
    ].includes(pathname) ||
    isAdmin ||
    isOrganizer;
  if (!user || !workspace || (isAdmin && user.role !== 'ADMIN')) return <>{children}</>;
  const links = isAdmin ? admin : isOrganizer ? organizer : attendee;
  const title = isAdmin
    ? 'Admin workspace'
    : isOrganizer
      ? 'Organizer workspace'
      : 'Attendee workspace';
  return (
    <div className={cn('workspace', collapsed && 'sidebar-collapsed')}>
      <div className="ep-mobile-workspace-context">
        <span>{title}</span>
        <button type="button" onClick={() => window.dispatchEvent(new Event('eventpoint:open-mobile-menu'))}>Workspace menu</button>
      </div>
      <aside className="side-nav" aria-label={title}>
        <button
          type="button"
          className="sidebar-collapse"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          aria-controls="workspace-navigation"
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            try {
              localStorage.setItem('eventpoint_sidebar_collapsed', String(next));
            } catch {
              /* Storage is optional. */
            }
          }}
        >
          {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
          <span className="sidebar-label">Collapse sidebar</span>
        </button>
        <p className="side-label sidebar-label">{title}</p>
        <nav id="workspace-navigation" aria-label={title}>
          {links.map(([href, label, Icon]) => {
            const active = href.includes('?')
              ? pathname + (query || '?tab=overview') === href
              : pathname === href &&
                !(
                  href === '/overview' &&
                  new URLSearchParams(query).get('view') === 'saved'
                );
            return (
              <Link
                key={href}
                href={href}
                title={label}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={cn('workspace-nav-link', active && 'active')}
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent('eventpoint:workspace-navigation', { detail: href }),
                  );
                }}
              >
                <Icon size={19} className="icon" />
                <span className="sidebar-label">{label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="workspace-main app-content">{children}</div>
    </div>
  );
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={children}>
      <WorkspaceShellContent>{children}</WorkspaceShellContent>
    </Suspense>
  );
}
