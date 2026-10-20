import { acceptsAnyCity, normalizeDiscoveryFilter } from './discovery-intent';

describe('Conversational discovery constraints', () => {
  const history = [
    { role: 'user', content: 'We are three friends tired from all week work and want a relaxed evening' },
    { role: 'assistant', content: 'Which city?' },
    { role: 'user', content: 'we are free to choose any city' },
  ];
  it.each(['any city', 'anywhere', 'all cities', 'location does not matter', 'no city preference'])('recognizes %s', text => {
    expect(acceptsAnyCity(text)).toBe(true);
  });
  it('keeps mood/group, removes fabricated city, budget and dates on a flexible follow-up', () => {
    const filter = normalizeDiscoveryFilter({ city: 'any city', query: 'relaxed evening', priceMax: 0, dateTo: '2026-10-25' }, history, false);
    expect(filter).toMatchObject({ partySize: 3, semanticQuery: 'relaxed evening calm peaceful unwind' });
    for (const key of ['city', 'query', 'priceMax', 'dateTo']) expect(filter).not.toHaveProperty(key);
  });
  it('retains explicit budget/date restrictions', () => {
    const filter = normalizeDiscoveryFilter({ city: 'Mumbai', priceMax: 100000, dateFrom: '2026-11-01' }, [{ role: 'user', content: 'calm evening in Mumbai in November under 1000 rupees' }], false);
    expect(filter).toMatchObject({ city: 'Mumbai', priceMax: 100000, dateFrom: '2026-11-01T00:00:00.000Z' });
  });
  it('clears mood on an explicit category or all-events reset', () => {
    expect(normalizeDiscoveryFilter({ category: 'music', semanticQuery: 'calm evening' }, history, true)).not.toHaveProperty('semanticQuery');
  });
});
