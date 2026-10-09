import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { VenuesService } from './venues.service';

describe('VenuesService public discovery', () => {
  let service: VenuesService;
  let prisma: {
    venue: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      venue: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [VenuesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(VenuesService);
  });

  describe('search', () => {
    it('returns paginated venues with published-event counts', async () => {
      const venues = [{ id: 'venue-1', name: 'Hall A' }];
      prisma.venue.findMany.mockResolvedValue(venues);
      prisma.venue.count.mockResolvedValue(1);
      prisma.$transaction.mockResolvedValue([venues, 1]);

      const result = await service.search({ page: 1, limit: 20 });

      expect(result).toEqual({
        venues,
        total: 1,
        page: 1,
        limit: 20,
        pages: 1,
      });
      const findManyArgs = prisma.venue.findMany.mock.calls[0][0];
      expect(findManyArgs.skip).toBe(0);
      expect(findManyArgs.take).toBe(20);
      expect(findManyArgs.select._count.select.events).toEqual({
        where: { status: 'PUBLISHED' },
      });
    });

    it('filters by city (insensitive) and name/city query', async () => {
      prisma.venue.findMany.mockResolvedValue([]);
      prisma.venue.count.mockResolvedValue(0);
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.search({ city: 'Mumbai', query: 'grand', page: 2, limit: 10 });

      const where = prisma.venue.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        city: { contains: 'Mumbai', mode: 'insensitive' },
        OR: [
          { name: { contains: 'grand', mode: 'insensitive' } },
          { city: { contains: 'grand', mode: 'insensitive' } },
        ],
      });
      expect(prisma.venue.findMany.mock.calls[0][0].skip).toBe(10);
    });
  });

  describe('getVenue', () => {
    it('returns a venue with organizer, seat sections and event count', async () => {
      const venue = { id: 'venue-1', name: 'Hall A', seatSections: [] };
      prisma.venue.findUnique.mockResolvedValue(venue);

      const result = await service.getVenue('venue-1');

      expect(result).toEqual(venue);
      const include = prisma.venue.findUnique.mock.calls[0][0].include;
      expect(include.organizer.select).toMatchObject({
        organizationName: true,
        isVerified: true,
      });
      expect(include._count.select.events).toEqual({
        where: { status: 'PUBLISHED' },
      });
    });

    it('throws NotFound for an unknown venue', async () => {
      prisma.venue.findUnique.mockResolvedValue(null);
      await expect(service.getVenue('nope')).rejects.toThrow('Venue not found');
    });
  });
});
