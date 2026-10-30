import Link from '@/components/ui/app-link';
import type { ReactNode, MouseEventHandler } from 'react';
import { ArrowRight, CalendarDays } from 'lucide-react';
export const previewPhoto =
  'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1600&q=85';
export function PreviewHeading({
  title,
  sub,
  eyebrow = 'Your EventPoint',
  action,
}: {
  title: string;
  sub: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <div className={'page-head' + (action ? ' ep-page-head-action' : '')}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {action}
    </div>
  );
}
export function PreviewPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
export function PreviewStat({
  label,
  value,
  href,
  icon,
  note,
  onClick,
}: {
  label: string;
  value: string;
  href: string;
  icon: ReactNode;
  note?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <Link
      className="stat stat-link"
      href={href}
      onClick={onClick}
      aria-label={label + ': ' + value + '. Open related section'}
    >
      <span className="stat-icon">{icon}</span>
      <strong>{value}</strong>
      <span>{label}</span>
      {note && <small>{note}</small>}
      <span className="stat-open" aria-hidden="true">
        View details <ArrowRight className="icon" />
      </span>
    </Link>
  );
}
export function PreviewBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  return (
    <span
      className={
        'badge ' +
        (/^(published|approved|confirmed|active|used|verified|live)$/.test(s)
          ? 'green'
          : /pending|draft|review/.test(s)
            ? 'amber'
            : /rejected|cancelled|failed|inactive/.test(s)
              ? 'red'
              : '')
      }
    >
      {status.replaceAll('_', ' ')}
    </span>
  );
}
export function PreviewEmpty({
  title,
  copy,
  href,
  label,
}: {
  title: string;
  copy: string;
  href?: string;
  label?: string;
}) {
  return (
    <div className="empty">
      <CalendarDays className="icon" />
      <h2>{title}</h2>
      <p>{copy}</p>
      {href && (
        <Link className="btn" href={href}>
          {label || 'Explore events'}
          <ArrowRight className="icon" />
        </Link>
      )}
    </div>
  );
}
