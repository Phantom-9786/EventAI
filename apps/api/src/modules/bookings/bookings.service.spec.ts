import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { BookingsService } from './bookings.service';

describe('BookingsService', () => {
  let service: BookingsService;
  let refundBooking: jest.Mock;
  let notifications: {
    sendBookingCancellation: jest.Mock;
    sendRefundConfirmation: jest.Mock;
  };
  let prisma: {
    booking: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    event: { findFirst: jest.Mock };
    ticketType: { findMany: jest.Mock; updateMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const futureDate = new Date(Date.now() + 30 * 86400000);
  const event = { id: 'event-1', startDate: futureDate, status: 'PUBLISHED' };

  const ticketType = {
    id: 'tt-1',
    eventId: 'event-1',
    name: 'General',
    price: 150000,
    currency: 'INR',
    isActive: true,
    availableQuantity: 50,
    maxPerBooking: 5,
    saleStartDate: null,
    saleEndDate: null,
  };

  const booking = {
    id: 'bk-1',
    userId: 'user-1',
    status: 'PENDING',
    totalAmount: 300000,
    expiresAt: new Date(Date.now() + 600000),
    user: { email: 'user-1@example.com', firstName: 'Test', lastName: 'User' },
    event: { title: 'Demo Event' },
    items: [
      { ticketTypeId: 'tt-1', quantity: 2, unitPrice: 150000, totalPrice: 300000 },
    ],
  };

  beforeEach(async () => {
    prisma = {
      booking: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      event: { findFirst: jest.fn() },
      ticketType: { findMany: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn(),
    };

    const paymentsService = { refundBooking: jest.fn() };
    notifications = {
      sendBookingCancellation: jest.fn().mockResolvedValue(true),
      sendRefundConfirmation: jest.fn().mockResolvedValue(true),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentsService, useValue: paymentsService },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
    refundBooking = paymentsService.refundBooking;
  });

  const validInput = {
    eventId: 'event-1',
    idempotencyKey: '0b8f6c1e-9f2a-4a5b-8c3d-1e2f3a4b5c6d',
    items: [{ ticketTypeId: 'tt-1', quantity: 2 }],
  };

  describe('create', () => {
    it('returns the existing booking for a repeated idempotency key', async () => {
      prisma.booking.findUnique.mockResolvedValue(booking);

      const result = await service.create('user-1', validInput);

      expect(result).toEqual(booking);
      expect(prisma.event.findFirst).not.toHaveBeenCalled();
    });

    it('rejects an idempotency key used by another user', async () => {
      prisma.booking.findUnique.mockResolvedValue({ ...booking, userId: 'someone-else' });

      await expect(service.create('user-1', validInput)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects unknown or unpublished events', async () => {
      prisma.booking.findUnique.mockResolvedValue(null);
      prisma.event.findFirst.mockResolvedValue(null);

      await expect(service.create('user-1', validInput)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects booking after the event has started', async () => {
      prisma.booking.findUnique.mockResolvedValue(null);
      prisma.event.findFirst.mockResolvedValue({
        ...event,
        startDate: new Date(Date.now() - 1000),
      });

      await expect(service.create('user-1', validInput)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects ticket types from another event', async () => {
      prisma.booking.findUnique.mockResolvedValue(null);
      prisma.event.findFirst.mockResolvedValue(event);
      prisma.ticketType.findMany.mockResolvedValue([]); // none belong to event

      await expect(service.create('user-1', validInput)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('enforces maxPerBooking on merged duplicate lines', async () => {
      prisma.booking.findUnique.mockResolvedValue(null);
      prisma.event.findFirst.mockResolvedValue(event);
      prisma.ticketType.findMany.mockResolvedValue([ticketType]);

      await expect(
        service.create('user-1', {
          ...validInput,
          items: [
            { ticketTypeId: 'tt-1', quantity: 3 },
            { ticketTypeId: 'tt-1', quantity: 3 },
          ],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects quantities outside the sale window', async () => {
      prisma.booking.findUnique.mockResolvedValue(null);
      prisma.event.findFirst.mockResolvedValue(event);
      prisma.ticketType.findMany.mockResolvedValue([
        { ...ticketType, saleStartDate: new Date(Date.now() + 86400000) },
      ]);

      await expect(service.create('user-1', validInput)).rejects.toThrow(
        ConflictException,
      );
    });

    it('decrements availability conditionally and prices server-side', async () => {
      prisma.booking.findUnique.mockResolvedValue(null);
      prisma.event.findFirst.mockResolvedValue(event);
      prisma.ticketType.findMany.mockResolvedValue([ticketType]);
      prisma.ticketType.updateMany.mockResolvedValue({ count: 1 });
      prisma.booking.create.mockImplementation(async ({ data }) => ({
        ...booking,
        totalAmount: data.totalAmount,
      }));
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));

      const result = await service.create('user-1', validInput);

      expect(prisma.ticketType.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'tt-1',
          eventId: 'event-1',
          isActive: true,
          availableQuantity: { gte: 2 },
        },
        data: { availableQuantity: { decrement: 2 } },
      });
      expect(result.totalAmount).toBe(300000); // 2 × 150000 from the DB row
    });

    it('rolls back when stock is insufficient mid-transaction', async () => {
      prisma.booking.findUnique.mockResolvedValue(null);
      prisma.event.findFirst.mockResolvedValue(event);
      prisma.ticketType.findMany.mockResolvedValue([ticketType]);
      prisma.ticketType.updateMany.mockResolvedValue({ count: 0 }); // no stock
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));

      await expect(service.create('user-1', validInput)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });
  });

  describe('getOwn', () => {
    it('returns own booking', async () => {
      prisma.booking.findFirst.mockResolvedValue(null); // not stale
      prisma.booking.findUnique.mockResolvedValue(booking);

      const result = await service.getOwn('user-1', 'bk-1');

      expect(result).toEqual(booking);
    });

    it('hides other users’ bookings', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);
      prisma.booking.findUnique.mockResolvedValue({ ...booking, userId: 'other' });

      await expect(service.getOwn('user-1', 'bk-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancelOwn', () => {
    it('cancels an unpaid booking and restores stock', async () => {
      prisma.booking.findUnique.mockResolvedValue(booking);
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.booking.findUnique
        .mockResolvedValueOnce(booking) // initial load
        .mockResolvedValueOnce({ status: 'PENDING' }); // re-check inside tx
      prisma.booking.update.mockResolvedValue({ ...booking, status: 'CANCELLED' });
      prisma.ticketType.updateMany.mockResolvedValue({ count: 1 });

      const result = (await service.cancelOwn('user-1', 'bk-1', 'changed plans')) as {
        status: string;
      };

      expect(result.status).toBe('CANCELLED');
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bk-1' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
      expect(prisma.ticketType.updateMany).toHaveBeenCalledWith({
        where: { id: 'tt-1' },
        data: { availableQuantity: { increment: 2 } },
      });
      expect(notifications.sendBookingCancellation).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user-1@example.com',
          eventTitle: 'Demo Event',
          bookingId: 'bk-1',
          reason: 'changed plans',
        }),
      );
    });

    it('refuses to cancel already-closed bookings', async () => {
      prisma.booking.findUnique.mockResolvedValue({ ...booking, status: 'EXPIRED' });

      await expect(service.cancelOwn('user-1', 'bk-1')).rejects.toThrow(ConflictException);
    });

    it('refunds a confirmed booking through the payments service', async () => {
      prisma.booking.findUnique.mockResolvedValue({ ...booking, status: 'CONFIRMED' });
      refundBooking.mockResolvedValue({
        booking: { ...booking, status: 'REFUNDED' },
        refundId: 'rfnd_1',
        refundAmount: 300000,
      });

      const result = (await service.cancelOwn('user-1', 'bk-1', 'changed plans')) as {
        booking: { status: string };
      };

      expect(refundBooking).toHaveBeenCalledWith('user-1', 'bk-1', 'changed plans');
      expect(result.booking.status).toBe('REFUNDED');
      expect(prisma.booking.update).not.toHaveBeenCalled();
    });
  });
});
