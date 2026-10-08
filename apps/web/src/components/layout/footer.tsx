import Link from 'next/link';
import { CalendarDays } from 'lucide-react';

const footerSections = [
  {
    title: 'Discover',
    links: [
      { href: '/events', label: 'All Events' },
      { href: '/categories', label: 'Categories' },
      { href: '/venues', label: 'Venues' },
    ],
  },
  {
    title: 'Organizers',
    links: [
      { href: '/organizer', label: 'Organizer Dashboard' },
      { href: '/organizer/events/new', label: 'Create an Event' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t bg-muted/40">
      <div className="container grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <CalendarDays className="h-5 w-5" />
            </span>
            EventAI
          </Link>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Discover. Book. Experience. AI-powered event discovery and ticket
            booking.
          </p>
        </div>

        {footerSections.map((section) => (
          <div key={section.title}>
            <h3 className="text-sm font-semibold">{section.title}</h3>
            <ul className="mt-3 space-y-2">
              {section.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t py-6">
        <p className="container text-center text-sm text-muted-foreground sm:text-left">
          &copy; {new Date().getFullYear()} EventAI. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
