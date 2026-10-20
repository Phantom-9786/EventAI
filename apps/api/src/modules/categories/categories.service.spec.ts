import { CategoriesService, chooseCategorySpotlights, type CategorySpotlight } from './categories.service';

const row = (slug: string, paidTickets = 0, upcomingEvents = 2): CategorySpotlight => ({
  id: slug, name: slug, slug, paidTickets, upcomingEvents, coverImage: null,
});

describe('Automatic category spotlights', () => {
  it('selects two categories by recent paid admissions and excludes empty categories', () => {
    const result = chooseCategorySpotlights([row('empty', 100, 0), row('music', 5), row('food', 12), row('arts', 2)], '2026-10-20');
    expect(result.map(item => item.slug)).toEqual(['food', 'music']);
  });
  it('keeps tied categories stable during a day and rotates them across days', () => {
    const rows = ['music', 'arts', 'food', 'wellness', 'technology'].map(slug => row(slug));
    expect(chooseCategorySpotlights(rows, '2026-10-20')).toEqual(chooseCategorySpotlights([...rows].reverse(), '2026-10-20'));
    const choices = new Set(Array.from({ length: 10 }, (_, i) => chooseCategorySpotlights(rows, '2026-10-' + (20 + i)).map(r => r.slug).join(',')));
    expect(choices.size).toBeGreaterThan(1);
  });
  it('does not invent a second category when only one is eligible', () => {
    expect(chooseCategorySpotlights([row('music')], '2026-10-20')).toHaveLength(1);
    expect(chooseCategorySpotlights([], '2026-10-20')).toEqual([]);
  });
  it('queries live eligibility and reuses the short public cache', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([row('music', 1)]) };
    const cache = { get: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce([row('music', 1)]), set: jest.fn().mockResolvedValue(undefined) };
    const service = new CategoriesService(prisma as never, cache as never);
    await service.spotlights();
    await service.spotlights();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(expect.stringContaining('categories:spotlights:'), [row('music', 1)], 60);
    const sql = prisma.$queryRaw.mock.calls[0][0].join(' ');
    expect(sql).toContain("e.status='PUBLISHED'");
    expect(sql).toContain('e.start_date >=');
    expect(sql).toContain('c.is_active=true');
    expect(sql).toContain("p.status='CAPTURED'");
  });
});
