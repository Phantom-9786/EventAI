'use client';
import { useEffect, useState } from 'react';
import { FileText, MapPin, Info } from 'lucide-react';
export function EventSectionNav() {
  const [active, setActive] = useState('about');
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-100px 0px -55% 0px' },
    );
    ['about', 'venue', 'faq'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);
  return (
    <nav className="tabs detail-tabs" aria-label="Event sections">
      {[
        { id: 'about', label: 'Overview', Icon: FileText },
        { id: 'venue', label: 'Venue', Icon: MapPin },
        { id: 'faq', label: 'Things to know', Icon: Info },
      ].map(({ id, label, Icon }) => (
        <a
          key={id}
          href={'#' + id}
          className={active === id ? 'active' : ''}
          aria-current={active === id ? 'location' : undefined}
          onClick={() => setActive(id)}
        >
          <Icon className="icon" />
          {label}
        </a>
      ))}
    </nav>
  );
}
