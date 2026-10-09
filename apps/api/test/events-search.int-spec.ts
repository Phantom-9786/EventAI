import { CacheService } from '../src/common/cache/cache.service';
import { EventsService } from '../src/modules/events/events.service';
import { createEventFixture, prepareTestDatabase, uniqueSuffix, type TestPrisma } from './db';

/**
 * DB-backed integration tests for the public event search: exercises the
 * real PostgreSQL full-text search trigger (search_vector) created by the
 * migrations, the parameterised raw-SQL filter pass, and Prisma hydration.
 *
 * Every fixture embeds a unique per-run marker so assertions stay exact
 * even though suites share one test database (and run in parallel in CI).
 */
describe('EventsService.searchEvents (integration)', () => {
  let prisma: TestPrisma;
  let events: EventsService;
  // Unique marker: matches only this run's fixtures via FTS.
  const marker = `zephyrid${uniqueSuffix()}`;
  const city = `Searchville-${uniqueSuffix()}`;
  let categorySlug: string;

  beforeAll(async () => {
    prisma = await prepareTestDatabase();
    events = new EventsService(prisma as never, new CacheService({ get: () => undefined } as never));

    // Two matching published events (the first matches the marker in both
    // title and tags, so relevance ordering is deterministic), one matching
    // DRAFT (must never appear), one non-matching published event.
    const first = await createEventFixture(prisma, {
      title: `${marker} Gala`,
      tags: [marker, 'symposium'],
      city,
    });
    await createEventFixture(prisma, { title: `Intro to ${marker}`, tags: ['lecture'], city });
    await createEventFixture(prisma, { title: `${marker} Draft Special`, status: 'DRAFT', city });
    await createEventFixture(prisma, { title: 'Salsa Night Bash', tags: ['dance'], city });
    categorySlug = `cat-${first.suffix}`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('finds published events by title keyword via the FTS vector', async () => {
    const result = await events.searchEvents({ query: marker, page: 1, limit: 10 });
    expect(result.total).toBe(2); // the DRAFT marker event must be excluded
    const titles = result.events.map((e) => e.title);
    expect(titles).toContain(`${marker} Gala`);
    expect(titles).toContain(`Intro to ${marker}`);
    expect(titles).not.toContain('Salsa Night Bash');
  });

  it('ranks stronger matches first (relevance ordering)', async () => {
    const result = await events.searchEvents({ query: marker, page: 1, limit: 10 });
    expect(result.events[0]?.title).toBe(`${marker} Gala`);
  });

  it('returns no results for gibberish', async () => {
    const result = await events.searchEvents({ query: `${marker}zzqqxxnever`, page: 1, limit: 10 });
    expect(result.total).toBe(0);
    expect(result.events).toEqual([]);
  });

  it('respects pagination and the total count', async () => {
    const page1 = await events.searchEvents({ query: marker, page: 1, limit: 1 });
    expect(page1.events).toHaveLength(1);
    expect(page1.total).toBe(2);
    expect(page1.pages).toBe(2);

    const page2 = await events.searchEvents({ query: marker, page: 2, limit: 1 });
    expect(page2.events).toHaveLength(1);
    expect(page2.events[0].id).not.toBe(page1.events[0].id);
  });

  it('filters by city via the venue join', async () => {
    const result = await events.searchEvents({ query: marker, city, page: 1, limit: 10 });
    expect(result.total).toBe(2);

    const miss = await events.searchEvents({
      query: marker,
      city: `Nowhere-${uniqueSuffix()}`,
      page: 1,
      limit: 10,
    });
    expect(miss.total).toBe(0);
  });

  it('lists published events without a query (structured sort by date)', async () => {
    const result = await events.searchEvents({ category: categorySlug, page: 1, limit: 50 });
    expect(result.total).toBe(1); // only this fixture's category
    const dates = result.events.map((e) => new Date(e.startDate).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });
});
