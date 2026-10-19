'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Sparkles } from 'lucide-react';
import { previewPhoto } from '@/components/approved/ui';
import { homeSearchDestination, type SearchCategory } from '@/lib/home-search';
export function SmartDiscovery({ categories }: { categories: SearchCategory[] }) {
  const [input, setInput] = useState(''),
    [city, setCity] = useState('');
  const router = useRouter();
  function search() {
    if (input.trim()) router.push(homeSearchDestination(input, categories, city));
  }
  return (
    <>
      {' '}
      <section className="hero wrap">
        <img
          className="hero-photo"
          src={previewPhoto}
          alt="A crowd enjoying a live concert"
        />
        <div className="hero-content">
          <span className="hero-label">
            <i />
            FOR THE MOMENTS THAT STAY WITH YOU
          </span>
          <h1>
            Good plans.
            <br />
            Great company.
            <br />
            <em>Unforgettable stories.</em>
          </h1>
          <p className="hero-desc">
            From your next favourite gig to something entirely new.
            <br />
            Find experiences worth stepping out for.
          </p>
          <form
            className="hero-search"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <Search className="icon" />
            <input
              type="search"
              aria-label="Describe the events you want"
              placeholder="Tell us your plans, city, budget or interests…"
              value={input}
              maxLength={1800}
              onChange={(e) => setInput(e.target.value)}
              required
            />
            <select
              aria-label="Choose city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            >
              <option value="">Any city</option>
              {[
                'Bengaluru',
                'Mumbai',
                'Delhi',
                'Pune',
                'Hyderabad',
                'Chennai',
                'Goa',
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button className="btn" type="submit" disabled={!input.trim()}>
              <Search className="icon" /> Explore
            </button>
          </form>
          <p className="hero-note">
            <Sparkles className="icon" />
            Search a category to explore, or describe your plans to ask AI.
          </p>
        </div>
        <span className="hero-credit">DISCOVER · BOOK · EXPERIENCE</span>
      </section>
    </>
  );
}
