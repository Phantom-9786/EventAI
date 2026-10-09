import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: {
    user: { count: jest.Mock };
    organizer: { count: jest.Mock };
    event: { groupBy: jest.Mock };
    booking: { groupBy: jest.Mock };
    ticket: { groupBy: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: { count: jest.fn().mockResolvedValue(42) },
      organizer: { count: jest.fn().mockResolvedValue(7) },
      event: { groupBy: jest.fn().mockResolvedValue([{ status: 'PUBLISHED', _count: { _all: 5 } }]) },
      booking: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'CONFIRMED', _count: { _all: 10 }, _sum: { totalAmount: 500000 } },
          { status: 'REFUNDED', _count: { _all: 2 }, _sum: { totalAmount: 50000 } },
        ]),
      },
      ticket: { groupBy: jest.fn().mockResolvedValue([{ status: 'USED', _count: { _all: 4 } }]) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(AdminService);
  });

  it('aggregates platform statistics', async () => {
    const stats = await service.platformStats();

    expect(stats.users).toBe(42);
    expect(stats.organizers).toEqual({ total: 7, verified: 7 });
    expect(stats.events).toMatchObject({ total: 5, PUBLISHED: 5 });
    expect(stats.bookings).toMatchObject({ CONFIRMED: 10, REFUNDED: 2 });
    expect(stats.revenue).toEqual({ gross: 500000, refunded: 50000, net: 450000 });
    expect(stats.tickets).toMatchObject({ USED: 4, issued: 4, checkedIn: 4 });
  });
});
