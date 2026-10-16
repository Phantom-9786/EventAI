import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  AdminAuditLogListInput,
  AdminEventListInput,
  AdminBookingListInput,
  AdminModerateEventInput,
  AdminOrganizerListInput,
  AdminSetOrganizerVerificationInput,
  AdminSetUserStatusInput,
  AdminUserListInput,
} from '@eventai/validation';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly eventsService?: EventsService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async invalidateEventCache(): Promise<void> {
    await this.eventsService?.invalidateEventCache();
  }

  /** Search bookings with explicitly limited customer, event and payment fields. */
  async listBookings(query: AdminBookingListInput) {
    const { page, limit, search, status } = query;
    const where = {
      AND: [
        status ? { status } : {},
        search
          ? {
              OR: [
                { id: { equals: search } },
                { user: { email: { contains: search, mode: 'insensitive' as const } } },
                { event: { title: { contains: search, mode: 'insensitive' as const } } },
              ],
            }
          : {},
      ],
    };
    const [bookings, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        select: {
          id: true,
          status: true,
          totalAmount: true,
          currency: true,
          createdAt: true,
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
          event: { select: { id: true, title: true, startDate: true } },
          payment: { select: { status: true, amount: true, refundAmount: true, updatedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return { bookings, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /** Detail view deliberately omits provider signatures, QR data and ticket codes. */
  async getBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        currency: true,
        createdAt: true,
        updatedAt: true,
        confirmedAt: true,
        cancelledAt: true,
        cancellationReason: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        event: { select: { id: true, title: true, startDate: true } },
        items: {
          select: {
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            ticketType: { select: { name: true } },
          },
        },
        payment: {
          select: {
            status: true,
            amount: true,
            currency: true,
            method: true,
            refundId: true,
            refundAmount: true,
            refundRequestStatus: true,
            refundRequestReason: true,
            refundRequestedAt: true,
            failureReason: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        tickets: { select: { status: true } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const { tickets, ...detail } = booking;
    return {
      ...detail,
      ticketCounts: tickets.reduce<Record<string, number>>((counts, ticket) => {
        counts[ticket.status] = (counts[ticket.status] ?? 0) + 1;
        return counts;
      }, {}),
    };
  }

  /** Platform-wide aggregates for the admin dashboard. */
  async platformStats() {
    const [users, organizers, verifiedOrganizers, eventGroups, bookingGroups, ticketGroups] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.organizer.count(),
        this.prisma.organizer.count({ where: { isVerified: true } }),
        this.prisma.event.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.booking.groupBy({
          by: ['status'],
          _count: { _all: true },
          _sum: { totalAmount: true },
        }),
        this.prisma.ticket.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
      ]);

    const events: Record<string, number> = {
      total: 0,
      DRAFT: 0,
      PUBLISHED: 0,
      CANCELLED: 0,
      COMPLETED: 0,
      SOLDOUT: 0,
    };
    for (const g of eventGroups) {
      events[g.status] = g._count._all;
      events.total += g._count._all;
    }

    const bookings: Record<string, number> = {
      PENDING: 0,
      PAYMENT_PENDING: 0,
      CONFIRMED: 0,
      CANCELLED: 0,
      EXPIRED: 0,
      REFUNDED: 0,
    };
    let grossRevenue = 0;
    let refundedAmount = 0;
    for (const g of bookingGroups) {
      bookings[g.status] = g._count._all;
      if (g.status === 'CONFIRMED') grossRevenue = g._sum.totalAmount ?? 0;
      if (g.status === 'REFUNDED') refundedAmount = g._sum.totalAmount ?? 0;
    }

    const tickets: Record<string, number> = {
      VALID: 0,
      USED: 0,
      CANCELLED: 0,
      EXPIRED: 0,
    };
    let ticketsIssued = 0;
    for (const g of ticketGroups) {
      tickets[g.status] = g._count._all;
      ticketsIssued += g._count._all;
    }

    return {
      users,
      organizers: { total: organizers, verified: verifiedOrganizers },
      events,
      bookings,
      revenue: { gross: grossRevenue, refunded: refundedAmount, net: grossRevenue - refundedAmount },
      tickets: { ...tickets, issued: ticketsIssued, checkedIn: tickets.USED },
    };
  }

  // ── User management ──────────────────────────────

  async listUsers(query: AdminUserListInput) {
    const { page, limit, search, role, isActive } = query;
    const where = {
      AND: [
        search
          ? {
              OR: [
                { email: { contains: search, mode: 'insensitive' as const } },
                { firstName: { contains: search, mode: 'insensitive' as const } },
                { lastName: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {},
        role ? { role } : {},
        isActive === undefined ? {} : { isActive },
      ],
    };

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          isEmailVerified: true,
          createdAt: true,
          _count: { select: { bookings: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users: users.map(({ _count, ...u }) => ({ ...u, bookingCount: _count.bookings })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async setUserStatus(adminUserId: string, targetUserId: string, input: AdminSetUserStatusInput) {
    if (adminUserId === targetUserId && !input.isActive) {
      throw new BadRequestException('You cannot deactivate your own admin account');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, isActive: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: targetUserId },
        data: { isActive: input.isActive },
        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,
        },
      });
      if (!input.isActive) {
        // Consistent with self-deletion: kill every live session
        await tx.session.deleteMany({ where: { userId: targetUserId } });
      }
      await tx.auditLog.create({
        data: {
          userId: adminUserId,
          action: input.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
          entity: 'USER',
          entityId: targetUserId,
          details: {
            email: u.email,
            previousStatus: user.isActive,
            newStatus: input.isActive,
          },
        },
      });
      return u;
    });

    this.logger.log(`Admin ${adminUserId} set user ${targetUserId} isActive=${input.isActive}`);
    return updated;
  }

  // ── Event moderation ─────────────────────────────

  async listEvents(query: AdminEventListInput) {
    const { page, limit, search, status } = query;
    const where = {
      AND: [
        search ? { title: { contains: search, mode: 'insensitive' as const } } : {},
        status ? { status } : {},
      ],
    };

    const [events, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          startDate: true,
          endDate: true,
          createdAt: true,
          category: { select: { id: true, name: true } },
          venue: { select: { id: true, name: true, city: true } },
          organizer: { select: { id: true, user: { select: { email: true } } } },
          _count: { select: { bookings: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.event.count({ where }),
    ]);

    return {
      events: events.map(({ _count, organizer, ...e }) => ({
        ...e,
        organizerEmail: organizer.user.email,
        bookingCount: _count.bookings,
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async moderateEvent(adminUserId: string, eventId: string, input: AdminModerateEventInput) {
    if (input.action !== 'CANCEL') {
      throw new BadRequestException('Unsupported moderation action');
    }

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, status: true },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    if (event.status !== 'PUBLISHED') {
      throw new ConflictException(
        `Only published events can be cancelled via moderation (current status: ${event.status})`,
      );
    }

    const cancellationReason = input.reason
      ? `Event cancelled by administrator: ${input.reason}`
      : 'Event cancelled by administrator';

    const result = await this.prisma.$transaction(async (tx) => {
      const e = await tx.event.update({
        where: { id: eventId },
        data: { status: 'CANCELLED' },
        select: { id: true, title: true, status: true },
      });

      const now = new Date();
      const refundRequests = await tx.payment.updateMany({
        where: {
          status: 'CAPTURED',
          OR: [
            { refundRequestStatus: null },
            { refundRequestStatus: 'REJECTED' },
            { refundRequestStatus: 'FAILED' },
          ],
          booking: { eventId, status: 'CONFIRMED' },
        },
        data: {
          refundRequestStatus: 'PENDING',
          refundRequestReason: cancellationReason,
          refundRequestedAt: now,
          refundReviewedAt: null,
          refundReviewedBy: null,
        },
      });

      const cancelledBookings = await tx.booking.updateMany({
        where: { eventId, status: { in: ['PENDING', 'PAYMENT_PENDING', 'CONFIRMED'] } },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancellationReason,
        },
      });

      await tx.ticket.updateMany({
        where: { eventId, status: 'VALID' },
        data: { status: 'CANCELLED' },
      });

      const attendees = await tx.booking.findMany({
        where: { eventId, status: 'CANCELLED' },
        select: {
          id: true,
          user: { select: { email: true, firstName: true, lastName: true } },
          payment: { select: { status: true, refundRequestStatus: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: adminUserId,
          action: 'EVENT_CANCELLED_BY_ADMIN',
          entity: 'EVENT',
          entityId: eventId,
          details: {
            title: event.title,
            reason: input.reason ?? null,
            bookingsCancelled: cancelledBookings.count,
            refundRequestsQueued: refundRequests.count,
          },
        },
      });

      return {
        event: e,
        refundRequestsQueued: refundRequests.count,
        bookingsCancelled: cancelledBookings.count,
        attendees,
      };
    });

    if (this.eventsService) {
      await this.eventsService.invalidateEventCache();
    }

    if (this.notifications) {
      for (const attendee of result.attendees) {
        void this.notifications
          .sendEventCancellationNotice({
            to: attendee.user.email,
            holderName: `${attendee.user.firstName} ${attendee.user.lastName}`.trim() || 'Attendee',
            eventTitle: result.event.title,
            bookingId: attendee.id,
            paymentStatus: attendee.payment?.status ?? null,
            refundRequestStatus: attendee.payment?.refundRequestStatus ?? null,
          })
          .catch((error: unknown) => {
            this.logger.warn(
              `Admin cancellation notice failed for booking ${attendee.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
            );
          });
      }
    }

    this.logger.log(
      `Admin ${adminUserId} moderated event ${eventId}: CANCEL (reason: ${input.reason ?? 'none provided'}, bookingsCancelled: ${result.bookingsCancelled}, refundRequestsQueued: ${result.refundRequestsQueued})`,
    );
    return result.event;
  }

  // ── Organizer management ─────────────────────────

  async listOrganizers(query: AdminOrganizerListInput) {
    const { page, limit, search, isVerified } = query;
    const where = {
      AND: [
        search
          ? {
              OR: [
                { organizationName: { contains: search, mode: 'insensitive' as const } },
                { user: { email: { contains: search, mode: 'insensitive' as const } } },
              ],
            }
          : {},
        isVerified === undefined ? {} : { isVerified },
      ],
    };

    const [organizers, total] = await this.prisma.$transaction([
      this.prisma.organizer.findMany({
        where,
        select: {
          id: true,
          organizationName: true,
          isVerified: true,
          createdAt: true,
          user: { select: { id: true, email: true, isActive: true } },
          _count: { select: { events: true, venues: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.organizer.count({ where }),
    ]);

    return {
      organizers: organizers.map(({ _count, ...o }) => ({
        ...o,
        eventCount: _count.events,
        venueCount: _count.venues,
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async setOrganizerVerification(
    adminUserId: string,
    organizerId: string,
    input: AdminSetOrganizerVerificationInput,
  ) {
    const organizer = await this.prisma.organizer.findUnique({
      where: { id: organizerId },
      select: { id: true, organizationName: true, isVerified: true },
    });
    if (!organizer) {
      throw new NotFoundException('Organizer not found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const o = await tx.organizer.update({
        where: { id: organizerId },
        data: { isVerified: input.isVerified },
        select: { id: true, organizationName: true, isVerified: true },
      });
      await tx.auditLog.create({
        data: {
          userId: adminUserId,
          action: input.isVerified ? 'ORGANIZER_VERIFIED' : 'ORGANIZER_UNVERIFIED',
          entity: 'ORGANIZER',
          entityId: organizerId,
          details: {
            organizationName: organizer.organizationName,
            previousVerified: organizer.isVerified,
            newVerified: input.isVerified,
          },
        },
      });
      return o;
    });

    this.logger.log(
      `Admin ${adminUserId} set organizer ${organizerId} isVerified=${input.isVerified}`,
    );
    return updated;
  }

  // ── Audit logs ───────────────────────────────────

  async listAuditLogs(query: AdminAuditLogListInput) {
    const { page, limit, search, entity, action } = query;
    const where = {
      AND: [
        entity ? { entity } : {},
        action ? { action } : {},
        search
          ? {
              OR: [
                { entityId: { contains: search, mode: 'insensitive' as const } },
                { action: { contains: search, mode: 'insensitive' as const } },
                { user: { email: { contains: search, mode: 'insensitive' as const } } },
              ],
            }
          : {},
      ],
    };

    const [logs, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          details: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      logs,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }
}

