import { createHash } from 'crypto';
import { isMoodSearch, SEMANTIC_MODEL, SemanticRetrievalService } from './semantic-retrieval.service';

describe('Semantic retrieval', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['music', false], ['show all events', false], ['music in Mumbai under 1000', false],
    ['a quiet intimate evening', true], ['romantic date night', true], ['aaram aur sukoon wala scene', true],
  ])('routes mood intent for %s', (text, expected) => expect(isMoodSearch(text)).toBe(expected));

  it('reuses unchanged event vectors and caches query embeddings', async () => {
    const date = new Date('2026-10-20T00:00:00Z');
    const event = { id: 'event-1', title: 'Soft piano', description: 'Intimate acoustic evening', shortDescription: null, tags: ['seated'], updatedAt: date, category: { name: 'Music' } };
    const text = [event.title, event.category.name, event.tags.join(', '), event.description].join('. ');
    const prisma = {
      event: { findMany: jest.fn().mockResolvedValue([event]) },
      $queryRaw: jest.fn().mockResolvedValue([{ event_id: event.id, content_hash: createHash('sha256').update(text).digest('hex'), source_updated_at: date }]),
      $executeRaw: jest.fn(),
    };
    const service = new SemanticRetrievalService(prisma as never);
    const vector = Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0);
    const embed = jest.spyOn(service, 'embed').mockResolvedValue([vector]);
    expect(await service.queryVector('quiet evening')).toEqual(vector);
    expect(await service.queryVector('quiet evening')).toEqual(vector);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('refreshes changed text and persists the model and vector', async () => {
    const event = { id: 'event-2', title: 'New title', description: 'Garden dinner', shortDescription: null, tags: [], updatedAt: new Date(), category: { name: 'Food' } };
    const prisma = { event: { findMany: jest.fn().mockResolvedValue([event]) }, $queryRaw: jest.fn().mockResolvedValue([]), $executeRaw: jest.fn().mockResolvedValue(1) };
    const service = new SemanticRetrievalService(prisma as never);
    jest.spyOn(service, 'embed').mockResolvedValue([Array(384).fill(0.05)]);
    await service.refreshIndex();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(prisma.$executeRaw.mock.calls[0])).toContain(SEMANTIC_MODEL);
  });

  it('returns an explicit fallback signal when indexing fails', async () => {
    const service = new SemanticRetrievalService({ event: { findMany: jest.fn().mockRejectedValue(new Error('Database unavailable')) } } as never);
    expect(await service.queryVector('relaxed evening')).toBeNull();
  });
});
