import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
}
