import crypto from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '../../common/exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { SystemControlsService } from './system-controls.service';
import { AdminRoleType, AdminInvitationStatus, UserRole } from '@eventai/types';
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
    @Optional() private readonly systemControlsService?: SystemControlsService,
  ) {}

  async invalidateEventCache(): Promise<void> {
    await this.eventsService?.invalidateEventCache();
  }

  /** Search bookings with explicitly limited customer, event and payment fields. */
  async listBookings(query: Partial<AdminBookingListInput> = {}) {
    const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit ?? '20'), 10) || 20));
    const search = query.search?.trim();
    const status = query.status;
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
    return { bookings, total, page, limit, pages: Math.ceil(total / limit) || 1 };
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
        this.prisma.user.count({
          where: { NOT: { email: { endsWith: '@anonymized.eventai.local' } } },
        }),
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

  async listUsers(query: Partial<AdminUserListInput> & { status?: string } = {}) {
    const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit ?? '20'), 10) || 20));
    const search = query.search?.trim();
    const role = query.role;
    const status = query.status?.toUpperCase()?.trim();
    let statusFilter: Record<string, unknown> = {};

    if (status === 'ACTIVE') {
      statusFilter = {
        isActive: true,
        isEmailVerified: true,
        NOT: { email: { endsWith: '@anonymized.eventai.local' } },
      };
    } else if (status === 'DEACTIVATED') {
      statusFilter = {
        isActive: false,
        NOT: { email: { endsWith: '@anonymized.eventai.local' } },
      };
    } else if (status === 'DELETED') {
      statusFilter = {
        email: { endsWith: '@anonymized.eventai.local' },
      };
    } else if (status === 'UNVERIFIED') {
      statusFilter = {
        isActive: true,
        isEmailVerified: false,
        NOT: { email: { endsWith: '@anonymized.eventai.local' } },
      };
    } else if (query.isActive !== undefined && (query.isActive as unknown) !== '') {
      const isActiveFilter = String(query.isActive) === 'true' || query.isActive === true;
      statusFilter = { isActive: isActiveFilter };
    }

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
        statusFilter,
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
      users: users.map(({ _count, ...u }) => {
        const isDeleted = Boolean(
          (u.email && u.email.endsWith('@anonymized.eventai.local')) ||
          (u.firstName === 'Deleted' && u.lastName === 'User' && !u.isActive),
        );
        const lifecycleStatus = isDeleted
          ? 'DELETED'
          : !u.isActive
            ? 'DEACTIVATED'
            : !u.isEmailVerified
              ? 'UNVERIFIED'
              : 'ACTIVE';
        return {
          ...u,
          bookingCount: _count.bookings,
          isDeleted,
          lifecycleStatus,
        };
      }),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    };
  }

  async setUserStatus(adminUserId: string, targetUserId: string, input: AdminSetUserStatusInput) {
    if (adminUserId === targetUserId && !input.isActive) {
      throw new BadRequestException('You cannot deactivate your own admin account');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, firstName: true, lastName: true, isActive: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isDeleted = Boolean(
      (user.email && user.email.endsWith('@anonymized.eventai.local')) ||
      (user.firstName === 'Deleted' && user.lastName === 'User' && !user.isActive),
    );

    if (isDeleted && input.isActive) {
      throw new BadRequestException(
        'Cannot reactivate a permanently deleted user account whose personal data was anonymized.',
      );
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

  async listEvents(query: Partial<AdminEventListInput> = {}) {
    const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit ?? '20'), 10) || 20));
    const search = query.search?.trim();
    const status = query.status;
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
        organizerEmail: organizer?.user?.email ?? 'Unknown',
        bookingCount: _count.bookings,
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    };
  }

  async getEventDetail(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        category: true,
        venue: true,
        ticketTypes: {
          orderBy: { price: 'asc' },
        },
        organizer: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const latestAudit = await this.prisma.auditLog.findFirst({
      where: {
        entity: 'Event',
        entityId: event.id,
        action: { in: ['EVENT_SUBMITTED', 'EVENT_APPROVED', 'EVENT_REJECTED', 'EVENT_MATERIAL_CHANGE'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      ...event,
      moderation: latestAudit
        ? {
            status:
              latestAudit.action === 'EVENT_APPROVED'
                ? 'APPROVED'
                : latestAudit.action === 'EVENT_REJECTED'
                  ? 'REJECTED'
                  : 'PENDING_APPROVAL',
            rejectionReason: (latestAudit.details as any)?.reason,
            reviewedAt: latestAudit.createdAt.toISOString(),
            reviewedBy: latestAudit.userId,
          }
        : {
            status: event.status === 'PUBLISHED' ? 'APPROVED' : 'DRAFT',
          },
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

  async listOrganizers(query: Partial<AdminOrganizerListInput> = {}) {
    const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit ?? '20'), 10) || 20));
    const search = query.search?.trim();
    let isVerifiedFilter: boolean | undefined = undefined;
    if (query.isVerified !== undefined && (query.isVerified as unknown) !== '') {
      isVerifiedFilter = String(query.isVerified) === 'true' || query.isVerified === true;
    }
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
        isVerifiedFilter === undefined ? {} : { isVerified: isVerifiedFilter },
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
      organizers: organizers.map(({ _count, user, ...o }) => ({
        ...o,
        user: user ?? { id: '', email: 'Unknown', isActive: false },
        eventCount: _count.events,
        venueCount: _count.venues,
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
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

  async listAuditLogs(query: Partial<AdminAuditLogListInput> = {}) {
    const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit ?? '20'), 10) || 20));
    const search = query.search?.trim();
    const entity = query.entity;
    const action = query.action;
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
      pages: Math.ceil(total / limit) || 1,
    };
  }

  private hashInvitationToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async isPlatformOwner(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, adminRole: true, createdAt: true, isActive: true },
    });
    if (!user || user.role !== UserRole.ADMIN || !user.isActive) {
      return false;
    }
    if (user.adminRole === AdminRoleType.OWNER) {
      return true;
    }

    // If an explicit active platform owner exists, delegated administrators (adminRole: ADMIN) are not owners
    const explicitOwner = await this.prisma.user.findFirst({
      where: { role: UserRole.ADMIN, adminRole: AdminRoleType.OWNER, isActive: true },
      select: { id: true },
    });
    if (explicitOwner) {
      return false;
    }

    // Fallback: The earliest created active ADMIN is only recognized as a platform owner if no explicit owner exists
    const earliestAdmin = await this.prisma.user.findFirst({
      where: { role: UserRole.ADMIN, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    return earliestAdmin?.id === userId;
  }

  async listTeam(callerUserId: string) {
    const isOwner = await this.isPlatformOwner(callerUserId);
    const admins = await this.prisma.user.findMany({
      where: { role: UserRole.ADMIN },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        adminRole: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const explicitOwner = admins.find((a) => a.adminRole === AdminRoleType.OWNER);
    const members = admins.map((admin, idx) => {
      const adminIsOwner = explicitOwner
        ? admin.adminRole === AdminRoleType.OWNER
        : idx === 0;
      const isCurrentUser = admin.id === callerUserId;
      const fullName =
        `${admin.firstName ?? ''} ${admin.lastName ?? ''}`.trim() || admin.email;
      return {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        fullName,
        role: admin.role,
        adminRole: adminIsOwner ? AdminRoleType.OWNER : AdminRoleType.ADMIN,
        isActive: admin.isActive,
        createdAt: admin.createdAt.toISOString(),
        isOwner: adminIsOwner,
        isCurrentUser,
      };
    });

    const rawInvitations = await this.prisma.adminInvitation.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        acceptedAt: true,
        revokedAt: true,
        invitedBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Query recent invitation audit logs to reflect email delivery failure status
    const invitationAuditLogs = await this.prisma.auditLog.findMany({
      where: {
        entity: 'AdminInvitation',
        action: { in: ['ADMIN_INVITATION_CREATED', 'ADMIN_INVITATION_RESENT'] },
      },
      select: { entityId: true, details: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const deliveryFailedMap = new Map<string, boolean>();
    for (const log of invitationAuditLogs) {
      if (log.entityId && !deliveryFailedMap.has(log.entityId)) {
        const details = (log.details as Record<string, unknown> | null) ?? {};
        deliveryFailedMap.set(log.entityId, Boolean(details.emailDeliveryFailed));
      }
    }

    const now = new Date();
    const invitations = rawInvitations.map((inv) => {
      let status = inv.status;
      if (status === AdminInvitationStatus.PENDING && inv.expiresAt < now) {
        status = AdminInvitationStatus.EXPIRED;
      }
      return {
        id: inv.id,
        email: inv.email,
        role: inv.role,
        status,
        expiresAt: inv.expiresAt.toISOString(),
        createdAt: inv.createdAt.toISOString(),
        acceptedAt: inv.acceptedAt ? inv.acceptedAt.toISOString() : null,
        revokedAt: inv.revokedAt ? inv.revokedAt.toISOString() : null,
        invitedBy: inv.invitedBy,
        emailDeliveryFailed: deliveryFailedMap.get(inv.id) ?? false,
      };
    });

    const pendingInvitations = invitations.filter(
      (inv) => inv.status === AdminInvitationStatus.PENDING,
    );
    const acceptedInvitations = invitations.filter(
      (inv) => inv.status === AdminInvitationStatus.ACCEPTED,
    );
    const historicalInvitations = invitations.filter(
      (inv) =>
        inv.status === AdminInvitationStatus.REVOKED ||
        inv.status === AdminInvitationStatus.EXPIRED,
    );

    const caller = await this.prisma.user.findUnique({
      where: { id: callerUserId },
      select: { id: true, email: true, role: true, adminRole: true },
    });
    const callerRole = isOwner ? AdminRoleType.OWNER : AdminRoleType.ADMIN;

    return {
      currentUser: {
        id: callerUserId,
        email: caller?.email ?? '',
        isOwner,
        role: callerRole,
      },
      members,
      invitations,
      pendingInvitations,
      acceptedInvitations,
      historicalInvitations,
      isOwner,
      callerId: callerUserId,
    };
  }

  async inviteAdministrator(
    callerUserId: string,
    input: { email: string; role?: 'ADMIN' | 'OWNER' },
    meta?: { ipAddress?: string; userAgent?: string; frontendUrl?: string },
  ) {
    const isOwner = await this.isPlatformOwner(callerUserId);
    if (!isOwner) {
      throw new ForbiddenException('Only platform owners can invite team members');
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    const existingAdmin = await this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' }, role: UserRole.ADMIN },
    });
    if (existingAdmin) {
      throw new ConflictException('A team member with this email address already exists');
    }

    const existingInvitation = await this.prisma.adminInvitation.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        status: AdminInvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
    });
    if (existingInvitation) {
      throw new ConflictException(
        'An active invitation for this email address already exists. You can resend it from the team list.',
      );
    }

    const caller = await this.prisma.user.findUnique({
      where: { id: callerUserId },
      select: { firstName: true, lastName: true, email: true },
    });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = this.hashInvitationToken(rawToken);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    // Safeguard: Invitations can ONLY grant the delegated ADMIN role. Platform owner
    // status is strictly reserved and cannot be assigned through the invitation flow.
    const invitationRole = AdminRoleType.ADMIN;

    const invitation = await this.prisma.adminInvitation.create({
      data: {
        email: normalizedEmail,
        role: invitationRole,
        token: hashedToken,
        status: AdminInvitationStatus.PENDING,
        invitedById: callerUserId,
        expiresAt,
      },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    const inviterName =
      `${caller?.firstName ?? ''} ${caller?.lastName ?? ''}`.trim() ||
      caller?.email ||
      'Platform Owner';
    const frontendUrl =
      meta?.frontendUrl ?? process.env.FRONTEND_URL ?? 'http://localhost:3000';

    let emailSent = false;
    if (this.notifications) {
      try {
        emailSent = await this.notifications.sendAdminInvitationEmail({
          to: normalizedEmail,
          inviterName,
          role: invitationRole,
          invitationToken: rawToken,
          frontendUrl,
          expiresInHours: 48,
        });
      } catch (err) {
        this.logger.warn(`Failed to dispatch admin invitation email: ${String(err)}`);
        emailSent = false;
      }
    }

    await this.prisma.auditLog.create({
      data: {
        userId: callerUserId,
        action: 'ADMIN_INVITATION_CREATED',
        entity: 'AdminInvitation',
        entityId: invitation.id,
        details: {
          email: normalizedEmail,
          role: invitationRole,
          expiresAt: expiresAt.toISOString(),
          emailDeliveryFailed: !emailSent,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      },
    });

    return {
      success: true,
      emailDeliveryFailed: !emailSent,
      message: emailSent
        ? `Invitation sent to ${normalizedEmail}`
        : `Invitation created for ${normalizedEmail}, but email delivery failed. You can resend it from the team list.`,
      invitation,
    };
  }

  async resendInvitation(
    callerUserId: string,
    invitationId: string,
    meta?: { ipAddress?: string; userAgent?: string; frontendUrl?: string },
  ) {
    const isOwner = await this.isPlatformOwner(callerUserId);
    if (!isOwner) {
      throw new ForbiddenException('Only platform owners can manage invitations');
    }

    const invitation = await this.prisma.adminInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.status === AdminInvitationStatus.REVOKED) {
      throw new BadRequestException('Cannot resend a revoked invitation');
    }
    if (invitation.status === AdminInvitationStatus.ACCEPTED) {
      throw new BadRequestException('Invitation has already been accepted');
    }

    const caller = await this.prisma.user.findUnique({
      where: { id: callerUserId },
      select: { firstName: true, lastName: true, email: true },
    });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = this.hashInvitationToken(rawToken);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await this.prisma.adminInvitation.update({
      where: { id: invitationId },
      data: {
        token: hashedToken,
        status: AdminInvitationStatus.PENDING,
        expiresAt,
      },
    });

    const inviterName =
      `${caller?.firstName ?? ''} ${caller?.lastName ?? ''}`.trim() ||
      caller?.email ||
      'Platform Owner';
    const frontendUrl =
      meta?.frontendUrl ?? process.env.FRONTEND_URL ?? 'http://localhost:3000';

    let emailSent = false;
    if (this.notifications) {
      try {
        emailSent = await this.notifications.sendAdminInvitationEmail({
          to: invitation.email,
          inviterName,
          role: invitation.role,
          invitationToken: rawToken,
          frontendUrl,
          expiresInHours: 48,
        });
      } catch (err) {
        this.logger.warn(`Failed to dispatch admin invitation email: ${String(err)}`);
        emailSent = false;
      }
    }

    await this.prisma.auditLog.create({
      data: {
        userId: callerUserId,
        action: 'ADMIN_INVITATION_RESENT',
        entity: 'AdminInvitation',
        entityId: invitation.id,
        details: {
          email: invitation.email,
          role: invitation.role,
          expiresAt: expiresAt.toISOString(),
          emailDeliveryFailed: !emailSent,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      },
    });

    return {
      success: true,
      emailDeliveryFailed: !emailSent,
      message: emailSent
        ? `Invitation resent to ${invitation.email}`
        : `Invitation updated, but email delivery failed. Check email service configuration.`,
    };
  }

  async revokeInvitation(
    callerUserId: string,
    invitationId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const isOwner = await this.isPlatformOwner(callerUserId);
    if (!isOwner) {
      throw new ForbiddenException('Only platform owners can revoke invitations');
    }

    const invitation = await this.prisma.adminInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.status !== AdminInvitationStatus.PENDING) {
      throw new BadRequestException('Only pending invitations can be revoked');
    }

    await this.prisma.adminInvitation.update({
      where: { id: invitationId },
      data: {
        status: AdminInvitationStatus.REVOKED,
        revokedAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: callerUserId,
        action: 'ADMIN_INVITATION_REVOKED',
        entity: 'AdminInvitation',
        entityId: invitation.id,
        details: {
          email: invitation.email,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      },
    });

    return { success: true, message: 'Invitation revoked successfully' };
  }

  async revokeAdminAccess(
    callerUserId: string,
    targetUserId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const isOwner = await this.isPlatformOwner(callerUserId);
    if (!isOwner) {
      throw new ForbiddenException('Only platform owners can manage administrator roles');
    }

    if (callerUserId === targetUserId) {
      throw new BadRequestException('You cannot revoke your own administrator access');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, role: true, adminRole: true },
    });

    if (!targetUser || targetUser.role !== UserRole.ADMIN) {
      throw new NotFoundException('Administrator not found');
    }

    const targetIsOwner = await this.isPlatformOwner(targetUserId);
    if (targetIsOwner) {
      const allAdmins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN, isActive: true },
        select: { id: true, adminRole: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      const explicitOwners = allAdmins.filter((a) => a.adminRole === AdminRoleType.OWNER);
      const activeOwnersCount =
        explicitOwners.length > 0 ? explicitOwners.length : allAdmins.length > 0 ? 1 : 0;
      if (activeOwnersCount <= 1) {
        throw new BadRequestException(
          'Cannot revoke administrator access for the last active platform owner',
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetUserId },
        data: {
          role: UserRole.CUSTOMER,
          adminRole: null,
        },
      }),
      this.prisma.session.deleteMany({
        where: { userId: targetUserId },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: callerUserId,
          action: 'ADMIN_ACCESS_REVOKED',
          entity: 'User',
          entityId: targetUserId,
          details: {
            email: targetUser.email,
            previousRole: targetUser.role,
          },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        },
      }),
    ]);

    // Also purge every maintenance tester entitlement associated with the revoked admin
    if (this.systemControlsService) {
      try {
        await this.systemControlsService.purgeTesterEntitlementsForUser(
          callerUserId,
          { id: targetUserId, email: targetUser.email },
          meta,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to purge maintenance tester entitlements for revoked admin ${targetUser.email}: ${String(err)}`,
        );
      }
    }

    return { success: true, message: `Administrator access revoked for ${targetUser.email}` };
  }

  async deleteInvitationHistory(
    callerUserId: string,
    invitationId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const isOwner = await this.isPlatformOwner(callerUserId);
    if (!isOwner) {
      throw new ForbiddenException('Only platform owners can manage invitation history');
    }

    const invitation = await this.prisma.adminInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.status === AdminInvitationStatus.PENDING && invitation.expiresAt > new Date()) {
      throw new BadRequestException(
        'Active pending invitations cannot be deleted from history; revoke them instead',
      );
    }

    await this.prisma.adminInvitation.delete({
      where: { id: invitationId },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: callerUserId,
        action: 'ADMIN_INVITATION_HISTORY_DELETED',
        entity: 'AdminInvitation',
        entityId: invitation.id,
        details: {
          email: invitation.email,
          previousStatus: invitation.status,
          role: invitation.role,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      },
    });

    return { success: true, message: 'Invitation history record removed' };
  }

  async clearAcceptedInvitations(
    callerUserId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const isOwner = await this.isPlatformOwner(callerUserId);
    if (!isOwner) {
      throw new ForbiddenException('Only platform owners can clear invitation history');
    }

    const deleteResult = await this.prisma.adminInvitation.deleteMany({
      where: { status: AdminInvitationStatus.ACCEPTED },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: callerUserId,
        action: 'ADMIN_ACCEPTED_INVITATIONS_CLEARED',
        entity: 'AdminInvitation',
        entityId: 'bulk',
        details: {
          count: deleteResult.count,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      },
    });

    return {
      success: true,
      count: deleteResult.count,
      clearedCount: deleteResult.count,
      message: `Cleared ${deleteResult.count} accepted invitation record(s) from history. Active team members remain unaffected.`,
    };
  }

  async linkMaintenanceTester(
    callerUserId: string,
    testEmail: string,
    allowedRoles?: ('CUSTOMER' | 'ORGANIZER')[],
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    if (!this.systemControlsService) {
      throw new BadRequestException('System controls service is not configured');
    }
    return this.systemControlsService.linkMaintenanceTester(
      callerUserId,
      testEmail,
      allowedRoles,
      meta,
    );
  }

  async unlinkMaintenanceTester(
    callerUserId: string,
    testEmail: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    if (!this.systemControlsService) {
      throw new BadRequestException('System controls service is not configured');
    }
    return this.systemControlsService.unlinkMaintenanceTester(callerUserId, testEmail, meta);
  }

  async listMaintenanceTesters(callerUserId: string) {
    if (!this.systemControlsService) {
      return [];
    }
    return this.systemControlsService.listMaintenanceTesters(callerUserId);
  }

  async acceptInvitation(
    userId: string,
    rawToken: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.trim().length < 10) {
      throw new BadRequestException('Invalid invitation token');
    }

    const hashedToken = this.hashInvitationToken(rawToken.trim());
    const invitation = await this.prisma.adminInvitation.findUnique({
      where: { token: hashedToken },
    });

    if (!invitation || invitation.status !== AdminInvitationStatus.PENDING) {
      throw new BadRequestException('Invalid, revoked, or previously used invitation link');
    }

    if (invitation.expiresAt < new Date()) {
      await this.prisma.adminInvitation.update({
        where: { id: invitation.id },
        data: { status: AdminInvitationStatus.EXPIRED },
      });
      throw new BadRequestException('This invitation has expired. Please request a new invitation.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, isEmailVerified: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account not found or inactive');
    }

    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new ForbiddenException(
        `This invitation was issued to ${invitation.email}. You are currently signed in as ${user.email}. Please sign in with the invited email address to accept.`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.adminInvitation.update({
        where: { id: invitation.id },
        data: {
          status: AdminInvitationStatus.ACCEPTED,
          acceptedById: userId,
          acceptedAt: new Date(),
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          role: UserRole.ADMIN,
          adminRole: invitation.role,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'ADMIN_INVITATION_ACCEPTED',
          entity: 'AdminInvitation',
          entityId: invitation.id,
          details: {
            email: user.email,
            assignedRole: invitation.role,
          },
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        },
      }),
    ]);

    return {
      success: true,
      message: 'Invitation accepted successfully. You now have Administrator access.',
      role: invitation.role,
    };
  }
}

