import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { TicketsService } from './tickets.service';

describe('TicketsService', () => {
  let service: TicketsService;
  let prisma: {
    ticketType: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    seatSection: { findFirst: jest.Mock };
  };
  let eventsService: { requireOwnedEvent: jest.Mock; invalidateEventCache: jest.Mock };

  const futureEvent = {
    id: 'event-1',
    status: 'PUBLISHED',
    startDate: new Date(Date.now() + 30 * 86400000),
    venueId: 'venue-1',
    organizerId: 'org-1',
  };

  beforeEach(async () => {
    prisma = {
      ticketType: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      seatSection: { findFirst: jest.fn() },
    };
    eventsService = {
      requireOwnedEvent: jest.fn().mockResolvedValue(futureEvent),
      invalidateEventCache: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventsService, useValue: eventsService },
      ],
    }).compile();

    service = moduleRef.get(TicketsService);
  });

  const baseInput = {
    name: 'General Admission',
    price: 150000, // ₹1,500 in paise
    totalQuantity: 100,
    maxPerBooking: 5,
  };

  describe('create', () => {
    it('creates a ticket type with availability initialised to total quantity', async () => {
      prisma.ticketType.create.mockImplementation(async ({ data }) => data);

      const result = await service.create('org-1', 'event-1', baseInput);

      expect(result.availableQuantity).toBe(100);
      expect(result.totalQuantity).toBe(100);
      expect(result.eventId).toBe('event-1');
    });

    it('rejects adding tickets to a cancelled event', async () => {
      eventsService.requireOwnedEvent.mockResolvedValue({
        ...futureEvent,
        status: 'CANCELLED',
      });
      await expect(service.create('org-1', 'event-1', baseInput)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects a section from another venue', async () => {
      prisma.seatSection.findFirst.mockResolvedValue(null);
      await expect(
        service.create('org-1', 'event-1', { ...baseInput, sectionId: 'section-x' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('accepts a section that belongs to the event venue', async () => {
      prisma.seatSection.findFirst.mockResolvedValue({ id: 'section-1' });
      prisma.ticketType.create.mockImplementation(async ({ data }) => data);
      const result = await service.create('org-1', 'event-1', {
        ...baseInput,
        sectionId: 'section-1',
      });
      expect(result.sectionId).toBe('section-1');
    });

    it('rejects a sale window ending after the event starts', async () => {
      await expect(
        service.create('org-1', 'event-1', {
          ...baseInput,
          saleEndDate: new Date(futureEvent.startDate.getTime() + 86400000).toISOString(),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a sale end before sale start', async () => {
      const start = new Date(Date.now() + 86400000).toISOString();
      const end = new Date(Date.now() + 7200000).toISOString();
      await expect(
        service.create('org-1', 'event-1', { ...baseInput, saleStartDate: start, saleEndDate: end }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    const existing = {
      id: 'tt-1',
      totalQuantity: 100,
      availableQuantity: 90,
      saleStartDate: null,
      saleEndDate: null,
      event: futureEvent,
    };

    it('derives availability when total quantity changes', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(existing);
      prisma.ticketType.update.mockImplementation(async ({ data }) => data);

      const result = await service.update('org-1', 'tt-1', { totalQuantity: 120 });

      // 10 sold → 120 - 10 = 110 available
      expect(result.totalQuantity).toBe(120);
      expect(result.availableQuantity).toBe(110);
    });

    it('refuses to reduce total below the sold count', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(existing);
      await expect(
        service.update('org-1', 'tt-1', { totalQuantity: 5 }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.ticketType.update).not.toHaveBeenCalled();
    });

    it('updates simple fields without touching quantities', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(existing);
      prisma.ticketType.update.mockImplementation(async ({ data }) => data);

      const result = await service.update('org-1', 'tt-1', { price: 200000, isActive: false });

      expect(result.price).toBe(200000);
      expect(result.isActive).toBe(false);
      expect(result.totalQuantity).toBeUndefined();
    });

    it('throws NotFound for another organizer’s ticket type', async () => {
      prisma.ticketType.findUnique.mockResolvedValue({
        ...existing,
        event: { ...futureEvent, organizerId: 'org-other' },
      });
      await expect(
        service.update('org-1', 'tt-1', { price: 1 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes an unbooked ticket type', async () => {
      prisma.ticketType.findUnique.mockResolvedValue({
        id: 'tt-1',
        totalQuantity: 50,
        availableQuantity: 50,
        event: futureEvent,
      });
      const result = await service.remove('org-1', 'tt-1');
      expect(result.message).toContain('deleted');
      expect(prisma.ticketType.delete).toHaveBeenCalledWith({ where: { id: 'tt-1' } });
    });

    it('refuses to delete a ticket type with bookings', async () => {
      prisma.ticketType.findUnique.mockResolvedValue({
        id: 'tt-1',
        totalQuantity: 50,
        availableQuantity: 20,
        event: futureEvent,
      });
      await expect(service.remove('org-1', 'tt-1')).rejects.toThrow(ConflictException);
      expect(prisma.ticketType.delete).not.toHaveBeenCalled();
    });
  });
});
