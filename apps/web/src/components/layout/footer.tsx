import Link from 'next/link';
import { BrandIcon } from '@/components/layout/brand-logo';
export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-top">
          <div>
            <Link className="brand" href="/" aria-label="EventPoint home">
              <BrandIcon />
              <span>
                Event<b>Point</b>
              </span>
            </Link>
            <p className="footer-copy">
              Discover. Book. Experience.
              <br />A little more out of the everyday.
            </p>
          </div>
          <div className="footer-links">
            <Link href="/events">Discover events</Link>
            <Link href="/dashboard">For organizers</Link>
            <Link href="/ai">Your event assistant</Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} EventPoint</span>
          <span>Discover experiences worth stepping out for.</span>
        </div>
      </div>
    </footer>
  );
}
