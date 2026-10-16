import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '../../common/exceptions';
import type { CreateBookingInput } from '@eventai/validation';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';

/** Reuses the seat-hold TTL: how long a PENDING booking keeps stock reserved. */
const HOLD_TTL_SECONDS = Number(process.env.SEAT_HOLD_TTL_SECONDS ?? 600);

const BOOKING_DETAIL_INCLUDE = {
  event: {
    select: {
      id: true,
      title: true,
      slug: true,
      startDate: true,
      endDate: true,
      status: true,
      venue: { select: { id: true, name: true, city: true, address: true } },
    },
  },
  items: {
    include: {
      ticketType: {
        select: { id: true, name: true, price: true, currency: true },
      },
    },
  },
  payment: {
    select: {
      id: true,
      status: true,
      amount: true,
      refundRequestStatus: true,
      refundRequestReason: true,
      refundRequestedAt: true,
    },
  },
  tickets: {
    select: {
      id: true,
      ticketCode: true,
      holderName: true,
      status: true,
      ticketTypeId: true,
      validatedAt: true,
    },
  },
} satisfies Prisma.BookingInclude;

// ═══════════════════════════════════════════════════
// Bookings: user-created reservations over ticket-type
// stock. Creation is concurrency-safe (conditional
// availability decrement inside a transaction), server-
// priced, and idempotent per idempotency key. PENDING
// bookings expire after HOLD_TTL and lazily release
// their reserved stock.
// ═══════════════════════════════════════════════════

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(userId: string, input: CreateBookingInput) {
    // Fast idempotency path: same key → return the original booking
    const existing = await this.prisma.booking.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: BOOKING_DETAIL_INCLUDE,
    });
    if (existing) {
      if (existing.userId !== userId) {
        throw new ForbiddenException('Idempotency key already in use');
      }
      return existing;
    }

    // Merge duplicate ticket-type lines into one quantity per type
    const quantities = new Map<string, number>();
    for (const item of input.items) {
      quantities.set(
        item.ticketTypeId,
        (quantities.get(item.ticketTypeId) ?? 0) + item.quantity,
      );
    }

    const event = await this.prisma.event.findFirst({
      where: { id: input.eventId, status: 'PUBLISHED' },
      select: { id: true, startDate: true },
    });
    if (!event) {
      throw new NotFoundException('Event not found or not open for booking');
    }
    if (event.startDate.getTime() <= Date.now()) {
      throw new ConflictException('This event has already started');
    }

    const ticketTypes = await this.prisma.ticketType.findMany({
      where: { id: { in: [...quantities.keys()] }, eventId: event.id },
    });
    if (ticketTypes.length !== quantities.size) {
      throw new NotFoundException('One or more ticket types do not belong to this event');
    }

    const now = Date.now();
    for (const type of ticketTypes) {
      if (!type.isActive) {
        throw new ConflictException(`Ticket type "${type.name}" is no longer on sale`);
      }
      const saleStart = type.saleStartDate?.getTime() ?? 0;
      const saleEnd = type.saleEndDate?.getTime() ?? Number.POSITIVE_INFINITY;
      if (now < saleStart || now > saleEnd) {
        throw new ConflictException(`Ticket type "${type.name}" is outside its sale window`);
      }
      const wanted = quantities.get(type.id) ?? 0;
      if (wanted > type.maxPerBooking) {
        throw new ConflictException(
          `Only ${type.maxPerBooking} "${type.name}" tickets per booking`,
        );
      }
    }

    const totalAmount = ticketTypes.reduce(
      (sum, type) => sum + type.price * (quantities.get(type.id) ?? 0),
      0,
    );
    const expiresAt = new Date(now + HOLD_TTL_SECONDS * 1000);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Deterministic sorting of ticket types avoids lock-ordering deadlocks
        // across concurrent multi-ticket bookings.
        const sortedQuantities = [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b));
        for (const [ticketTypeId, quantity] of sortedQuantities) {
          const result = await tx.ticketType.updateMany({
            where: {
              id: ticketTypeId,
              eventId: event.id,
              isActive: true,
              availableQuantity: { gte: quantity },
            },
            data: { availableQuantity: { decrement: quantity } },
          });
          if (result.count === 0) {
            const type = ticketTypes.find((t) => t.id === ticketTypeId);
            throw new ConflictException(
              `Not enough "${type?.name ?? 'ticket'}" tickets left for this booking`,
            );
          }
        }

        return tx.booking.create({
          data: {
            userId,
            eventId: event.id,
            totalAmount,
            idempotencyKey: input.idempotencyKey,
            expiresAt,
            items: {
              create: [...quantities.entries()].map(([ticketTypeId, quantity]) => {
                const type = ticketTypes.find((t) => t.id === ticketTypeId);
                return {
                  ticketTypeId,
                  quantity,
                  unitPrice: type!.price,
                  totalPrice: type!.price * quantity,
                };
              }),
            },
          },
          include: BOOKING_DETAIL_INCLUDE,
        });
      });
    } catch (error) {
      // Prisma unique-violation: a concurrent request won the idempotency race
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002'
      ) {
        const winner = await this.prisma.booking.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: BOOKING_DETAIL_INCLUDE,
        });
        if (winner && winner.userId === userId) {
          return winner;
        }
        throw new ForbiddenException('Idempotency key already in use');
      }
      throw error;
    }
  }

  async listOwn(userId: string, page: number, limit: number) {
    // Lazily expire this user's stale PENDING bookings before listing
    await this.expireStaleBookings(userId);

    const [bookings, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: BOOKING_DETAIL_INCLUDE,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.booking.count({ where: { userId } }),
    ]);
    return { bookings, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getOwn(userId: string, bookingId: string) {
    await this.expireBookingIfStale(bookingId);
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: BOOKING_DETAIL_INCLUDE,
    });
    if (!booking || booking.userId !== userId) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  async cancelOwn(userId: string, bookingId: string, reason?: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        items: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        event: { select: { title: true, organizer: { select: { userId: true } } } },
      },
    });
    if (!booking || booking.userId !== userId) {
      throw new NotFoundException('Booking not found');
    }
    if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') {
      throw new ConflictException('This booking is already closed');
    }
    if (booking.status === 'CONFIRMED') {
      return this.paymentsService.requestRefund(userId, bookingId, reason);
    }
    if (booking.status === 'REFUNDED') {
      throw new ConflictException('This booking was already refunded');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.booking.updateMany({
        where: { id: booking.id, status: booking.status },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
      });
      if (transitioned.count !== 1) {
        throw new ConflictException('Booking status changed, please retry');
      }

      const updated = await tx.booking.findUniqueOrThrow({
        where: { id: booking.id },
        include: BOOKING_DETAIL_INCLUDE,
      });

      // Release reserved stock (unpaid bookings only ever hold stock)
      for (const item of booking.items) {
        await tx.ticketType.updateMany({
          where: { id: item.ticketTypeId },
          data: { availableQuantity: { increment: item.quantity } },
        });
      }
      return updated;
    });

    this.notifyCancellation(booking, reason);
    return result;
  }

  /** Fire-and-forget cancellation email and in-app notifications for an unpaid booking. */
  private notifyCancellation(
    booking: {
      id: string;
      userId?: string;
      user: { id?: string; email: string; firstName: string; lastName: string };
      event: { title: string; organizer?: { userId: string } };
    },
    reason?: string,
  ): void {
    void this.notifications
      ?.sendBookingCancellation?.({
        to: booking.user.email,
        holderName: `${booking.user.firstName} ${booking.user.lastName}`.trim() || 'Guest',
        eventTitle: booking.event.title,
        bookingId: booking.id,
        reason,
      })
      ?.catch?.(() => undefined);

    const attendeeId = booking.userId ?? booking.user.id;
    if (attendeeId && typeof this.notifications?.createInAppNotification === 'function') {
      void this.notifications
        .createInAppNotification({
          userId: attendeeId,
          type: 'BOOKING_CANCELLED',
          title: 'Reservation cancelled',
          message: `Your reservation for "${booking.event.title}" has been cancelled.`,
          data: { bookingId: booking.id, link: '/tickets' },
        })
        ?.catch?.(() => undefined);
    }

    if (booking.event.organizer?.userId && typeof this.notifications?.createInAppNotification === 'function') {
      void this.notifications
        .createInAppNotification({
          userId: booking.event.organizer.userId,
          type: 'BOOKING_CANCELLED',
          title: 'Reservation cancelled by attendee',
          message: `A reservation for "${booking.event.title}" was cancelled by the attendee.`,
          data: { bookingId: booking.id, link: '/organizer/events' },
        })
        ?.catch?.(() => undefined);
    }
  }

  private isSweepRunning = false;

  /** Minute cron: expires stale bookings across all users and releases stock. */
  async handleStaleBookingsCron(): Promise<{ expiredCount: number }> {
    if (this.isSweepRunning) {
      this.logger.debug('Stale bookings sweep already in progress; skipping overlapping tick');
      return { expiredCount: 0 };
    }
    this.isSweepRunning = true;
    let expiredCount = 0;
    try {
      const stale = await this.prisma.booking.findMany({
        where: {
          status: { in: ['PENDING', 'PAYMENT_PENDING'] },
          expiresAt: { lt: new Date() },
        },
        select: { id: true },
        take: 200,
      });
      for (const { id } of stale) {
        try {
          const expired = await this.expireBookingIfStale(id);
          if (expired) expiredCount++;
        } catch (err) {
          this.logger.warn(
            `Failed to expire booking ${id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (expiredCount > 0) {
        this.logger.log(`Stale bookings sweep expired ${expiredCount} booking(s) and released inventory`);
      }
      return { expiredCount };
    } finally {
      this.isSweepRunning = false;
    }
  }

  /** Expires all stale PENDING bookings of a user (lazy sweep on list). */
  private async expireStaleBookings(userId: string): Promise<number> {
    const stale = await this.prisma.booking.findMany({
      where: {
        userId,
        status: { in: ['PENDING', 'PAYMENT_PENDING'] },
        expiresAt: { lt: new Date() },
      },
      select: { id: true },
      take: 200,
    });
    let count = 0;
    for (const { id } of stale) {
      try {
        const expired = await this.expireBookingIfStale(id);
        if (expired) count++;
      } catch (err) {
        this.logger.warn(
          `Failed to lazily expire booking ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return count;
  }

  /** Expires one stale booking past its TTL and releases its stock and seat holds. */
  private async expireBookingIfStale(bookingId: string): Promise<boolean> {
    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        status: { in: ['PENDING', 'PAYMENT_PENDING'] },
        expiresAt: { lt: new Date() },
      },
      include: { items: true },
    });
    if (!booking) return false;

    return await this.prisma.$transaction(async (tx) => {
      // Compare-and-set makes inventory release happen only for the request
      // that actually transitions this still-expired booking.
      const transitioned = await tx.booking.updateMany({
        where: {
          id: booking.id,
          status: { in: ['PENDING', 'PAYMENT_PENDING'] },
          expiresAt: { lt: new Date() },
        },
        data: { status: 'EXPIRED' },
      });
      if (transitioned.count !== 1) return false;

      for (const item of booking.items) {
        // Release held seat back to AVAILABLE if an assigned seat hold exists
        if (item.seatId) {
          await tx.seat.updateMany({
            where: { id: item.seatId, status: 'HELD' },
            data: { status: 'AVAILABLE' },
          });
        }
        await tx.ticketType.updateMany({
          where: { id: item.ticketTypeId },
          data: { availableQuantity: { increment: item.quantity } },
        });
      }
      this.logger.log(`Booking ${booking.id} expired and stock released`);
      return true;
    });
  }
}
