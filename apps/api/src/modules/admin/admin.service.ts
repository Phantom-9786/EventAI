import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AdminEventListInput,
  AdminModerateEventInput,
  AdminOrganizerListInput,
  AdminSetOrganizerVerificationInput,
  AdminSetUserStatusInput,
  AdminUserListInput,
} from '@eventai/validation';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  async moderateEvent(eventId: string, input: AdminModerateEventInput) {
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

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: { status: 'CANCELLED' },
      select: { id: true, title: true, status: true },
    });

    this.logger.log(
      `Admin moderated event ${eventId}: CANCEL (reason: ${input.reason ?? 'none provided'})`,
    );
    return updated;
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
    organizerId: string,
    input: AdminSetOrganizerVerificationInput,
  ) {
    const organizer = await this.prisma.organizer.findUnique({
      where: { id: organizerId },
      select: { id: true, isVerified: true },
    });
    if (!organizer) {
      throw new NotFoundException('Organizer not found');
    }

    const updated = await this.prisma.organizer.update({
      where: { id: organizerId },
      data: { isVerified: input.isVerified },
      select: { id: true, organizationName: true, isVerified: true },
    });

    this.logger.log(
      `Admin set organizer ${organizerId} isVerified=${input.isVerified}`,
    );
    return updated;
  }
}
