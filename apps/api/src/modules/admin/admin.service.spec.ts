import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: {
    user: { count: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    organizer: { count: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    event: {
      groupBy: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    booking: {
      groupBy: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    ticket: { groupBy: jest.Mock; updateMany: jest.Mock };
    payment: { updateMany: jest.Mock };
    session: { deleteMany: jest.Mock };
    auditLog: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };
  let eventsService: { invalidateEventCache: jest.Mock };
  let notificationsService: { sendEventCancellationNotice: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { count: jest.fn().mockResolvedValue(42), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      organizer: { count: jest.fn().mockResolvedValue(7), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      event: {
        groupBy: jest.fn().mockResolvedValue([{ status: 'PUBLISHED', _count: { _all: 5 } }]),
        count: jest.fn().mockResolvedValue(5),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      booking: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'CONFIRMED', _count: { _all: 10 }, _sum: { totalAmount: 500000 } },
          { status: 'REFUNDED', _count: { _all: 2 }, _sum: { totalAmount: 50000 } },
        ]),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      ticket: {
        groupBy: jest.fn().mockResolvedValue([{ status: 'USED', _count: { _all: 4 } }]),
        updateMany: jest.fn(),
      },
      payment: { updateMany: jest.fn() },
      session: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      auditLog: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      $transaction: jest.fn(),
    };

    eventsService = { invalidateEventCache: jest.fn().mockResolvedValue(undefined) };
    notificationsService = { sendEventCancellationNotice: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventsService, useValue: eventsService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = moduleRef.get(AdminService);
  });

  describe('booking oversight', () => {
    it('searches bookings with customer/event filters and paginates', async () => {
      prisma.$transaction.mockResolvedValue([[{ id: 'b1', status: 'CONFIRMED' }], 1]);
      const result = await service.listBookings({ page: 2, limit: 10, search: 'person@example.test', status: 'CONFIRMED' });

      const args = prisma.booking.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ AND: [
        { status: 'CONFIRMED' },
        { OR: [
          { id: { equals: 'person@example.test' } },
          { user: { email: { contains: 'person@example.test', mode: 'insensitive' } } },
          { event: { title: { contains: 'person@example.test', mode: 'insensitive' } } },
        ] },
      ] });
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
      expect(result).toMatchObject({ bookings: [{ id: 'b1' }], total: 1, page: 2 });
    });

    it('returns a safe detail projection without payment signatures or ticket codes', async () => {
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1', user: {}, event: {}, items: [], payment: null, tickets: [{ status: 'VALID' }],
      });
      const result = await service.getBooking('b1');
      const select = prisma.booking.findUnique.mock.calls[0][0].select;
      expect(select.payment.select).not.toHaveProperty('razorpaySignature');
      expect(select.tickets.select).toEqual({ status: true });
      expect(result.ticketCounts).toEqual({ VALID: 1 });
    });
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

  // ── User management ──────────────────────────────

  describe('listUsers', () => {
    it('queries with search/role/isActive filters and paginates', async () => {
      prisma.$transaction.mockResolvedValue([
        [{ id: 'u1', _count: { bookings: 3 } }],
        1,
      ]);

      const result = await service.listUsers({
        page: 2,
        limit: 10,
        search: 'ada',
        role: 'CUSTOMER',
        isActive: true,
      });

      const findManyArgs = prisma.user.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toEqual({
        AND: [
          {
            OR: [
              { email: { contains: 'ada', mode: 'insensitive' } },
              { firstName: { contains: 'ada', mode: 'insensitive' } },
              { lastName: { contains: 'ada', mode: 'insensitive' } },
            ],
          },
          { role: 'CUSTOMER' },
          { isActive: true },
        ],
      });
      expect(findManyArgs.skip).toBe(10);
      expect(findManyArgs.take).toBe(10);
      expect(result).toMatchObject({ users: [{ id: 'u1', bookingCount: 3 }], total: 1, page: 2, pages: 1 });
    });

    it('omits filters that are not provided', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);
      await service.listUsers({ page: 1, limit: 20 });
      const findManyArgs = prisma.user.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toEqual({ AND: [{}, {}, {}] });
    });
  });

  describe('setUserStatus', () => {
    it('deactivates a user, revokes sessions, and records audit log in one transaction', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true });
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          user: { update: prisma.user.update },
          session: { deleteMany: prisma.session.deleteMany },
          auditLog: { create: prisma.auditLog.create },
        }),
      );
      prisma.user.update.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'CUSTOMER', isActive: false });

      const result = await service.setUserStatus('admin-1', 'u1', { isActive: false });

      expect(result.isActive).toBe(false);
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'admin-1',
          action: 'USER_DEACTIVATED',
          entity: 'USER',
          entityId: 'u1',
          details: { email: 'a@b.c', previousStatus: true, newStatus: false },
        }),
      });
    });

    it('does not revoke sessions when reactivating', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: false });
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          user: { update: prisma.user.update },
          session: { deleteMany: prisma.session.deleteMany },
          auditLog: { create: prisma.auditLog.create },
        }),
      );
      prisma.user.update.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'CUSTOMER', isActive: true });

      await service.setUserStatus('admin-1', 'u1', { isActive: true });

      expect(prisma.session.deleteMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'admin-1',
          action: 'USER_ACTIVATED',
          entity: 'USER',
          entityId: 'u1',
        }),
      });
    });

    it('refuses an admin deactivating their own account', async () => {
      await expect(
        service.setUserStatus('admin-1', 'admin-1', { isActive: false }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('404s for an unknown user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.setUserStatus('admin-1', 'ghost', { isActive: false })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── Event moderation ─────────────────────────────

  describe('listEvents', () => {
    it('queries all events regardless of status with filters', async () => {
      prisma.$transaction.mockResolvedValue([
        [
          {
            id: 'e1',
            organizer: { user: { email: 'o@x.y' } },
            _count: { bookings: 4 },
          },
        ],
        1,
      ]);

      const result = await service.listEvents({ page: 1, limit: 20, status: 'PUBLISHED' });

      const findManyArgs = prisma.event.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toEqual({ AND: [{}, { status: 'PUBLISHED' }] });
      expect(result.events[0]).toMatchObject({ id: 'e1', organizerEmail: 'o@x.y', bookingCount: 4 });
    });
  });

  describe('moderateEvent', () => {
    it('cancels a published event and executes full cascade (refunds, bookings, tickets, cache, notifications)', async () => {
      prisma.event.findUnique.mockResolvedValue({ id: 'e1', title: 'T', status: 'PUBLISHED' });
      prisma.event.update.mockResolvedValue({ id: 'e1', title: 'T', status: 'CANCELLED' });
      prisma.payment.updateMany.mockResolvedValue({ count: 2 });
      prisma.booking.updateMany.mockResolvedValue({ count: 3 });
      prisma.ticket.updateMany.mockResolvedValue({ count: 5 });
      prisma.booking.findMany.mockResolvedValue([
        {
          id: 'b1',
          user: { email: 'attendee@test.com', firstName: 'John', lastName: 'Doe' },
          payment: { status: 'CAPTURED', refundRequestStatus: 'PENDING' },
        },
      ]);
      prisma.auditLog.create.mockResolvedValue({ id: 'a1' });

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          event: { update: prisma.event.update },
          payment: { updateMany: prisma.payment.updateMany },
          booking: { updateMany: prisma.booking.updateMany, findMany: prisma.booking.findMany },
          ticket: { updateMany: prisma.ticket.updateMany },
          auditLog: { create: prisma.auditLog.create },
        }),
      );

      const result = await service.moderateEvent('admin-1', 'e1', { action: 'CANCEL', reason: 'Fraud' });

      expect(prisma.event.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: 'CANCELLED' },
        select: { id: true, title: true, status: true },
      });
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'CAPTURED',
          OR: [
            { refundRequestStatus: null },
            { refundRequestStatus: 'REJECTED' },
            { refundRequestStatus: 'FAILED' },
          ],
          booking: { eventId: 'e1', status: 'CONFIRMED' },
        },
        data: expect.objectContaining({
          refundRequestStatus: 'PENDING',
          refundRequestReason: 'Event cancelled by administrator: Fraud',
        }),
      });
      expect(prisma.booking.updateMany).toHaveBeenCalledWith({
        where: { eventId: 'e1', status: { in: ['PENDING', 'PAYMENT_PENDING', 'CONFIRMED'] } },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancellationReason: 'Event cancelled by administrator: Fraud',
        }),
      });
      expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
        where: { eventId: 'e1', status: 'VALID' },
        data: { status: 'CANCELLED' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'admin-1',
          action: 'EVENT_CANCELLED_BY_ADMIN',
          entity: 'EVENT',
          entityId: 'e1',
          details: {
            title: 'T',
            reason: 'Fraud',
            bookingsCancelled: 3,
            refundRequestsQueued: 2,
          },
        }),
      });
      expect(eventsService.invalidateEventCache).toHaveBeenCalled();
      expect(notificationsService.sendEventCancellationNotice).toHaveBeenCalledWith({
        to: 'attendee@test.com',
        holderName: 'John Doe',
        eventTitle: 'T',
        bookingId: 'b1',
        paymentStatus: 'CAPTURED',
        refundRequestStatus: 'PENDING',
      });
      expect(result.status).toBe('CANCELLED');
    });

    it('refuses to cancel a non-published event', async () => {
      prisma.event.findUnique.mockResolvedValue({ id: 'e1', title: 'T', status: 'DRAFT' });
      await expect(service.moderateEvent('admin-1', 'e1', { action: 'CANCEL' })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.event.update).not.toHaveBeenCalled();
    });

    it('404s for an unknown event', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.moderateEvent('admin-1', 'ghost', { action: 'CANCEL' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── Organizer management ─────────────────────────

  describe('listOrganizers', () => {
    it('searches by organization or owner email and maps counts', async () => {
      prisma.$transaction.mockResolvedValue([
        [{ id: 'o1', user: { email: 'o@x.y' }, _count: { events: 5, venues: 2 } }],
        1,
      ]);

      const result = await service.listOrganizers({ page: 1, limit: 20, search: 'o@x.y' });

      const findManyArgs = prisma.organizer.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toEqual({
        AND: [
          {
            OR: [
              { organizationName: { contains: 'o@x.y', mode: 'insensitive' } },
              { user: { email: { contains: 'o@x.y', mode: 'insensitive' } } },
            ],
          },
          {},
        ],
      });
      expect(result.organizers[0]).toMatchObject({ id: 'o1', eventCount: 5, venueCount: 2 });
    });
  });

  describe('setOrganizerVerification', () => {
    it('toggles the verified badge and records audit log', async () => {
      prisma.organizer.findUnique.mockResolvedValue({ id: 'o1', organizationName: 'Acme', isVerified: false });
      prisma.organizer.update.mockResolvedValue({ id: 'o1', organizationName: 'Acme', isVerified: true });
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          organizer: { update: prisma.organizer.update },
          auditLog: { create: prisma.auditLog.create },
        }),
      );

      const result = await service.setOrganizerVerification('admin-1', 'o1', { isVerified: true });

      expect(prisma.organizer.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { isVerified: true },
        select: { id: true, organizationName: true, isVerified: true },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'admin-1',
          action: 'ORGANIZER_VERIFIED',
          entity: 'ORGANIZER',
          entityId: 'o1',
          details: { organizationName: 'Acme', previousVerified: false, newVerified: true },
        }),
      });
      expect(result.isVerified).toBe(true);
    });

    it('404s for an unknown organizer', async () => {
      prisma.organizer.findUnique.mockResolvedValue(null);
      await expect(
        service.setOrganizerVerification('admin-1', 'ghost', { isVerified: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Audit logs ───────────────────────────────────

  describe('listAuditLogs', () => {
    it('queries audit logs with filters and pagination', async () => {
      prisma.$transaction.mockResolvedValue([
        [
          {
            id: 'log-1',
            action: 'USER_DEACTIVATED',
            entity: 'USER',
            entityId: 'u1',
            details: { email: 'test@example.com' },
            createdAt: new Date('2026-10-14T08:00:00Z'),
            user: { id: 'admin-1', email: 'admin@eventai.test', firstName: 'Admin', lastName: 'User' },
          },
        ],
        1,
      ]);

      const result = await service.listAuditLogs({
        page: 1,
        limit: 10,
        entity: 'USER',
        action: 'USER_DEACTIVATED',
      });

      const findManyArgs = prisma.auditLog.findMany.mock.calls[0][0];
      expect(findManyArgs.where).toEqual({
        AND: [
          { entity: 'USER' },
          { action: 'USER_DEACTIVATED' },
          {},
        ],
      });
      expect(result.logs[0].id).toBe('log-1');
      expect(result.total).toBe(1);
    });
  });
});
