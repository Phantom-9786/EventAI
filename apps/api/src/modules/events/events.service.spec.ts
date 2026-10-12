import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from './events.service';

describe('EventsService', () => {
  let service: EventsService;
  let cacheMock: { get: jest.Mock; set: jest.Mock; invalidatePrefix: jest.Mock };
  let notificationsMock: { sendEventCancellationNotice: jest.Mock };
  let prisma: {
    event: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
    };
    payment: { updateMany: jest.Mock };
    booking: { findMany: jest.Mock; updateMany: jest.Mock };
    ticket: { updateMany: jest.Mock };
    category: { findFirst: jest.Mock };
    venue: { findFirst: jest.Mock };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };

  const ownedDraft = {
    id: 'event-1',
    status: 'DRAFT',
    startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    endDate: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000),
    categoryId: 'cat-1',
    venueId: 'venue-1',
  };

  beforeEach(async () => {
    prisma = {
      event: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      payment: { updateMany: jest.fn() },
      booking: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      ticket: { updateMany: jest.fn() },
      category: { findFirst: jest.fn() },
      venue: { findFirst: jest.fn() },
      $transaction: jest.fn(async (ops: unknown) => {
        // Prisma-style: array of promises OR interactive callback
        if (Array.isArray(ops)) return Promise.all(ops);
        if (typeof ops === 'function') return ops(prisma);
        throw new Error('unexpected $transaction shape');
      }),
      $queryRaw: jest.fn(),
    };
    cacheMock = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      invalidatePrefix: jest.fn().mockResolvedValue(undefined),
    };
    notificationsMock = {
      sendEventCancellationNotice: jest.fn().mockResolvedValue(true),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cacheMock },
        { provide: NotificationsService, useValue: notificationsMock },
      ],
    }).compile();

    service = moduleRef.get(EventsService);
  });

  describe('createEvent', () => {
    const baseInput = {
      title: 'Summer Rock Concert',
      description: 'An amazing outdoor live music festival for everyone',
      categoryId: 'cat-1',
      venueId: 'venue-1',
      startDate: new Date(Date.now() + 30 * 86400000).toISOString(),
      endDate: new Date(Date.now() + 31 * 86400000).toISOString(),
    };

    it('creates a DRAFT event with a unique slug', async () => {
      prisma.category.findFirst.mockResolvedValue({ id: 'cat-1' });
      prisma.venue.findFirst.mockResolvedValue({ id: 'venue-1' });
      prisma.event.create.mockImplementation(async ({ data }) => ({
        id: 'event-1',
        slug: data.slug,
        status: data.status,
      }));

      const result = await service.createEvent('org-1', baseInput);

      expect(result.status).toBe('DRAFT');
      expect(result.slug).toMatch(/^summer-rock-concert-[0-9a-f]{8}$/);
      const createArgs = prisma.event.create.mock.calls[0][0];
      expect(createArgs.data.organizerId).toBe('org-1');
      expect(createArgs.data.status).toBe('DRAFT');
    });

    it('rejects a start date in the past', async () => {
      await expect(
        service.createEvent('org-1', {
          ...baseInput,
          startDate: new Date(Date.now() - 86400000).toISOString(),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects an unknown or inactive category', async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      await expect(service.createEvent('org-1', baseInput)).rejects.toThrow(NotFoundException);
    });

    it('rejects a venue not owned by the organizer', async () => {
      prisma.category.findFirst.mockResolvedValue({ id: 'cat-1' });
      prisma.venue.findFirst.mockResolvedValue(null);
      await expect(service.createEvent('org-1', baseInput)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateEvent', () => {
    it('rejects updates to cancelled events', async () => {
      prisma.event.findFirst.mockResolvedValue({ ...ownedDraft, status: 'CANCELLED' });
      await expect(
        service.updateEvent('org-1', 'event-1', { title: 'New title here' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects an end date before the start date', async () => {
      prisma.event.findFirst.mockResolvedValue(ownedDraft);
      await expect(
        service.updateEvent('org-1', 'event-1', {
          endDate: new Date(Date.now() - 86400000).toISOString(),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('updates only provided fields', async () => {
      prisma.event.findFirst.mockResolvedValue(ownedDraft);
      prisma.event.update.mockResolvedValue({ id: 'event-1', title: 'Renamed Event Title' });

      const result = await service.updateEvent('org-1', 'event-1', { title: 'Renamed Event Title' });

      expect(result.title).toBe('Renamed Event Title');
      const args = prisma.event.update.mock.calls[0][0];
      expect(args.data).toEqual({ title: 'Renamed Event Title' });
    });

    it('throws NotFound when the event belongs to another organizer', async () => {
      prisma.event.findFirst.mockResolvedValue(null);
      await expect(
        service.updateEvent('org-2', 'event-1', { title: 'Hijack attempt here' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('publishEvent', () => {
    it('publishes a draft with a future start date', async () => {
      prisma.event.findFirst.mockResolvedValue(ownedDraft);
      prisma.event.update.mockResolvedValue({ id: 'event-1', status: 'PUBLISHED' });

      const result = await service.publishEvent('org-1', 'event-1');
      expect(result.status).toBe('PUBLISHED');
      expect(prisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'PUBLISHED' } }),
      );
    });

    it('rejects publishing an already published event', async () => {
      prisma.event.findFirst.mockResolvedValue({ ...ownedDraft, status: 'PUBLISHED' });
      await expect(service.publishEvent('org-1', 'event-1')).rejects.toThrow(ConflictException);
    });

    it('rejects publishing when the start date has passed', async () => {
      prisma.event.findFirst.mockResolvedValue({
        ...ownedDraft,
        startDate: new Date(Date.now() - 86400000),
      });
      await expect(service.publishEvent('org-1', 'event-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('cancelEvent and deleteEvent', () => {
    it('cancels bookings and tickets and queues captured payments for approval', async () => {
      prisma.event.findFirst.mockResolvedValue({ ...ownedDraft, status: 'PUBLISHED' });
      prisma.event.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.updateMany.mockResolvedValue({ count: 2 });
      prisma.booking.updateMany.mockResolvedValue({ count: 3 });
      prisma.ticket.updateMany.mockResolvedValue({ count: 4 });
      prisma.event.findUniqueOrThrow.mockResolvedValue({ id: 'event-1', status: 'CANCELLED' });
      prisma.booking.findMany.mockResolvedValue([{
        id: 'booking-1',
        user: { email: 'attendee@example.test', firstName: 'Attendee', lastName: 'One' },
        payment: { status: 'CAPTURED', refundRequestStatus: null },
      }]);
      const result = await service.cancelEvent('org-1', 'event-1');
      expect(result.event.status).toBe('CANCELLED');
      expect(result.refundRequestsQueued).toBe(2);
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ status: 'CAPTURED', booking: { eventId: 'event-1', status: 'CONFIRMED' } }),
        data: expect.objectContaining({ refundRequestStatus: 'PENDING' }),
      }));
      expect(prisma.ticket.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { eventId: 'event-1', status: 'VALID' },
        data: { status: 'CANCELLED' },
      }));
      expect(notificationsMock.sendEventCancellationNotice).toHaveBeenCalledWith(expect.objectContaining({
        to: 'attendee@example.test',
        bookingId: 'booking-1',
        paymentStatus: 'CAPTURED',
      }));
    });

    it('refuses to cancel a completed event', async () => {
      prisma.event.findFirst.mockResolvedValue({ ...ownedDraft, status: 'COMPLETED' });
      await expect(service.cancelEvent('org-1', 'event-1')).rejects.toThrow(ConflictException);
    });

    it('deletes a draft', async () => {
      prisma.event.findFirst.mockResolvedValue(ownedDraft);
      prisma.event.delete.mockResolvedValue(ownedDraft);
      const result = await service.deleteEvent('org-1', 'event-1');
      expect(result.message).toContain('deleted');
    });

    it('refuses to delete a published event', async () => {
      prisma.event.findFirst.mockResolvedValue({ ...ownedDraft, status: 'PUBLISHED' });
      await expect(service.deleteEvent('org-1', 'event-1')).rejects.toThrow(ConflictException);
      expect(prisma.event.delete).not.toHaveBeenCalled();
    });
  });

  describe('searchEvents', () => {
    it('runs the FTS raw query and hydrates in rank order', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: 'event-b' }, { id: 'event-a' }])
        .mockResolvedValueOnce([{ total: 2 }]);
      prisma.event.findMany.mockResolvedValue([
        {
          id: 'event-a',
          ticketTypes: [{ price: 500 }, { price: 1000 }],
          category: { id: 'cat-1', name: 'Music', slug: 'music' },
          venue: { id: 'venue-1', name: 'V', city: 'Bengaluru' },
          organizer: { id: 'org-1', organizationName: 'Org' },
        },
        {
          id: 'event-b',
          ticketTypes: [{ price: 200 }],
          category: { id: 'cat-1', name: 'Music', slug: 'music' },
          venue: { id: 'venue-1', name: 'V', city: 'Bengaluru' },
          organizer: { id: 'org-1', organizationName: 'Org' },
        },
      ]);

      const result = await service.searchEvents({ query: 'rock concert', page: 1, limit: 20 });

      expect(result.total).toBe(2);
      expect(result.events.map((e) => e.id)).toEqual(['event-b', 'event-a']); // rank order preserved
      expect(result.events[1].minPrice).toBe(500);
      expect(result.events[1].maxPrice).toBe(1000);
      expect(result.events[1].ticketTypes).toBeUndefined(); // stripped from the summary

      const sql = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
      expect(sql.text).toContain('websearch_to_tsquery');
      expect(sql.text).toContain('ts_rank');
      expect(sql.text).toContain('status =');
    });

    it('returns an empty page without hydrating when nothing matches', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]);

      const result = await service.searchEvents({ page: 1, limit: 20 });

      expect(result.events).toEqual([]);
      expect(result.total).toBe(0);
      expect(prisma.event.findMany).not.toHaveBeenCalled();
    });

    it('handles a null total from the count query defensively', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      const result = await service.searchEvents({ page: 1, limit: 20 });
      expect(result.total).toBe(0);
    });
  });

  describe('getPublishedEvent', () => {
    it('hides non-published events from the public route', async () => {
      prisma.event.findFirst.mockResolvedValue(null);
      await expect(service.getPublishedEvent('some-slug-or-id')).rejects.toThrow(NotFoundException);
      const args = prisma.event.findFirst.mock.calls[0][0];
      expect(args.where.status).toBe('PUBLISHED');
    });

    it('caches the detail and serves a repeat read from the cache', async () => {
      const detail = { id: 'event-1', slug: 'some-slug-or-id' };
      prisma.event.findFirst.mockResolvedValue(detail);

      const first = await service.getPublishedEvent('some-slug-or-id');
      expect(first).toEqual(detail);
      expect(cacheMock.set).toHaveBeenCalledWith(
        'event:detail:some-slug-or-id',
        detail,
        60,
      );

      cacheMock.get.mockResolvedValueOnce(detail);
      prisma.event.findFirst.mockClear();

      const second = await service.getPublishedEvent('some-slug-or-id');
      expect(second).toEqual(detail);
      expect(prisma.event.findFirst).not.toHaveBeenCalled();
    });
  });
});
