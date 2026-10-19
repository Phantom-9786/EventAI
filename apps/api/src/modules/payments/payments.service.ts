import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '../../common/exceptions';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import * as QRCode from 'qrcode';
import Razorpay from 'razorpay';
import { Prisma } from '@prisma/client';
import type { VerifyPaymentInput } from '@eventai/validation';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

type Tx = Prisma.TransactionClient;
type RefundablePayment = Prisma.PaymentGetPayload<{
  include: {
    booking: {
      include: {
        items: true;
        user: { select: { email: true; firstName: true; lastName: true } };
        event: { select: { title: true; organizerId: true; status: true } };
      };
    };
  };
}>;

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

interface RazorpayWebhookPayment {
  id: string;
  order_id: string;
  method?: string;
  error_description?: string;
}

interface RazorpayRefundRecord {
  id: string;
  payment_id: string;
  amount: number;
  status: 'pending' | 'processed' | 'failed' | string;
  notes?: Record<string, string | number>;
}

interface RazorpayPaymentRecord {
  id: string;
  status: string;
  amount: number;
  currency: string;
  amount_refunded?: number;
  refund_status?: string | null;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private razorpayClient: Razorpay | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Order creation ───────────────────────────────

  async createOrder(userId: string, bookingId: string) {
    const booking = await this.loadOwnBooking(userId, bookingId);
    if (booking.event?.status === 'PAUSED')
      throw new ConflictException(
        'This event is paused. New payments are temporarily unavailable.',
      );

    if (booking.status === 'CONFIRMED' || booking.status === 'REFUNDED') {
      throw new ConflictException('This booking is already paid');
    }
    if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') {
      throw new ConflictException('This booking is closed — please create a new one');
    }
    if (booking.expiresAt && booking.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('This booking has expired — please create a new one');
    }

    const existing = await this.prisma.payment.findUnique({
      where: { bookingId: booking.id },
    });

    if (existing && (existing.status === 'CREATED' || existing.status === 'PENDING')) {
      // Retry path: reuse the same open order (idempotent)
      return this.orderResponse(
        existing.razorpayOrderId,
        booking.totalAmount,
        existing.currency,
      );
    }

    let order: RazorpayOrder;
    try {
      order = (await this.ensureClient().orders.create({
        amount: booking.totalAmount, // paise
        currency: booking.currency,
        receipt: booking.id,
        notes: { bookingId: booking.id, userId },
      })) as RazorpayOrder;
    } catch (err: any) {
      const statusCode = Number(err?.statusCode);
      const errDescription = err?.error?.description || err?.message;
      this.logger.error(
        `Razorpay order creation failed${Number.isInteger(statusCode) ? ` (HTTP ${statusCode})` : ''}: ${errDescription ?? 'unknown error'}`,
      );
      if (statusCode === 401 || statusCode === 403) {
        throw new ServiceUnavailableException(
          'Payment gateway authentication failed: invalid or expired Razorpay API keys. Please verify your Razorpay configuration in .env.',
        );
      }
      throw new BadRequestException(
        `Payment gateway error: ${errDescription || 'unable to create payment order'}`,
      );
    }

    const payment = existing
      ? // A previous attempt failed — recycle the row with the fresh order
        await this.prisma.payment.update({
          where: { id: existing.id },
          data: {
            razorpayOrderId: order.id,
            status: 'CREATED',
            failureReason: null,
            razorpayPaymentId: null,
            razorpaySignature: null,
          },
        })
      : await this.prisma.payment.create({
          data: {
            bookingId: booking.id,
            userId,
            razorpayOrderId: order.id,
            amount: booking.totalAmount,
            currency: booking.currency,
            status: 'CREATED',
            idempotencyKey: `order:${booking.id}`,
          },
        });

    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'PAYMENT_PENDING' },
    });

    return this.orderResponse(payment.razorpayOrderId, payment.amount, payment.currency);
  }

  // ── Payment verification (checkout callback) ─────

  async verifyPayment(userId: string, input: VerifyPaymentInput) {
    const payment = await this.prisma.payment.findUnique({
      where: { razorpayOrderId: input.razorpayOrderId },
      include: {
        booking: { include: { items: true, user: true, event: true } },
      },
    });

    if (!payment || payment.booking.userId !== userId) {
      throw new NotFoundException('Payment not found');
    }
    // Booking/order association: the callback's bookingId must be the one the
    // order was created for — never confirm across bookings.
    if (payment.bookingId !== input.bookingId) {
      throw new NotFoundException('Payment not found');
    }

    // Idempotent: already captured → return the confirmed booking
    if (payment.status === 'CAPTURED') {
      return { booking: await this.loadOwnBooking(userId, payment.bookingId) };
    }

    const booking = payment.booking;
    if (payment.amount !== booking.totalAmount) {
      throw new ConflictException('Payment amount does not match booking amount');
    }
    const expected = createHmac('sha256', this.requireSecret())
      .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
      .digest('hex');
    if (!safeEqualHex(expected, input.razorpaySignature)) {
      throw new ForbiddenException('Payment signature verification failed');
    }

    const confirmed = await this.prisma.$transaction(async (tx) =>
      this.confirmBooking(tx, {
        paymentId: payment.id,
        bookingId: booking.id,
        razorpayPaymentId: input.razorpayPaymentId,
        razorpaySignature: input.razorpaySignature,
        method: null,
      }),
    );

    if (confirmed.status === 'CONFIRMED') {
      this.logger.log(`Booking ${booking.id} confirmed via checkout verification`);
      this.notifyConfirmation(booking, confirmed);
    } else {
      this.logger.warn(
        `Late capture for closed booking ${booking.id}; organizer approval is required for a refund`,
      );
    }
    return { booking: confirmed };
  }

  // ── Webhooks ─────────────────────────────────────

  async handleWebhook(rawBody: Buffer | string, signature: string | undefined) {
    if (!signature) {
      throw new BadRequestException('Missing x-razorpay-signature header');
    }
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
    if (!secret) {
      throw new ServiceUnavailableException('Webhook secret is not configured');
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!safeEqualHex(expected, signature)) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    let parsed: {
      event: string;
      payload?: {
        payment?: { entity?: RazorpayWebhookPayment };
        refund?: { entity?: RazorpayRefundRecord };
      };
    };
    try {
      parsed = JSON.parse(
        typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'),
      );
    } catch {
      throw new BadRequestException('Webhook body is not valid JSON');
    }

    const refundEvent = parsed.payload?.refund?.entity;
    if (parsed.event.startsWith('refund.') && refundEvent) {
      // Webhook signatures are verified above. Refund webhooks only act on the
      // exact refund ID already recorded for a pending local attempt. If the
      // create call timed out before returning an ID, the admin reconciliation
      // lookup will correlate it from Razorpay's payment refund list instead.
      const payment = await this.prisma.payment.findFirst({
        where: { razorpayPaymentId: refundEvent.payment_id },
        include: {
          booking: {
            include: {
              items: true,
              user: { select: { email: true, firstName: true, lastName: true } },
              event: { select: { title: true } },
            },
          },
        },
      });
      const webhookAttemptKey = String(refundEvent.notes?.eventaiRefundAttempt ?? '');
      if (
        !payment ||
        payment.status !== 'REFUND_PENDING' ||
        (payment.refundId !== refundEvent.id &&
          (!payment.refundAttemptKey || payment.refundAttemptKey !== webhookAttemptKey))
      ) {
        return { received: true, handled: false };
      }
      const state = await this.applyRefundStatus(payment, refundEvent, null);
      return { received: true, handled: state !== 'unknown' };
    }

    const entity = parsed.payload?.payment?.entity;
    if (!entity?.order_id) {
      return { received: true, handled: false }; // not a payment event we track
    }

    const payment = await this.prisma.payment.findUnique({
      where: { razorpayOrderId: entity.order_id },
      include: { booking: { include: { items: true, user: true, event: true } } },
    });
    if (!payment) {
      return { received: true, handled: false }; // unknown order — ignore
    }

    if (parsed.event === 'payment.captured') {
      if (payment.status === 'CAPTURED') {
        return { received: true, handled: false }; // duplicate webhook
      }
      const webhookConfirmed = await this.prisma.$transaction(async (tx) =>
        this.confirmBooking(tx, {
          paymentId: payment.id,
          bookingId: payment.bookingId,
          razorpayPaymentId: entity.id,
          razorpaySignature: null, // webhook secret already authenticated the payload
          method: entity.method ?? null,
        }),
      );
      if (webhookConfirmed.status === 'CONFIRMED') {
        this.logger.log(`Booking ${payment.bookingId} confirmed via webhook capture`);
        this.notifyConfirmation(payment.booking, webhookConfirmed);
      } else {
        this.logger.warn(
          `Late capture for closed booking ${payment.bookingId}; organizer approval is required for a refund`,
        );
      }
      return { received: true, handled: true };
    }

    if (parsed.event === 'payment.failed') {
      if (payment.status === 'CAPTURED') {
        return { received: true, handled: false }; // paid beats failed (out-of-order delivery)
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failureReason: entity.error_description ?? 'Payment failed',
            razorpayPaymentId: entity.id,
          },
        });
      });
      const attendeeId = payment.booking?.userId ?? payment.userId;
      if (attendeeId) {
        void this.notifications.createInAppNotification({
          userId: attendeeId,
          type: 'PAYMENT_FAILED',
          title: 'Payment failed',
          message: `Your payment for "${payment.booking?.event?.title ?? 'booking'}" could not be completed: ${entity.error_description ?? 'Payment failed'}.`,
          data: {
            action: 'PAYMENT_FAILED',
            bookingId: payment.bookingId,
            link: '/tickets',
          },
        });
      }
      this.logger.warn(`Payment for booking ${payment.bookingId} failed`);
      return { received: true, handled: true };
    }

    return { received: true, handled: false };
  }

  // ── Refunds ──────────────────────────────────────

  /** Records a refund request; this method never calls the payment provider. */
  async requestRefund(userId: string, bookingId: string, reason?: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { bookingId },
      include: {
        booking: {
          include: {
            event: {
              select: {
                id: true,
                title: true,
                organizerId: true,
                organizer: { select: { userId: true } },
              },
            },
          },
        },
      },
    });
    if (!payment || payment.booking.userId !== userId) {
      throw new NotFoundException('Booking not found');
    }

    const booking = payment.booking;
    if (booking.status === 'REFUNDED') {
      throw new ConflictException('This booking was already refunded');
    }
    if (
      payment.status === 'REFUND_PENDING' ||
      payment.refundRequestStatus === 'APPROVED'
    ) {
      throw new ConflictException('A refund is already approved or being processed');
    }
    if (payment.refundRequestStatus === 'PENDING') {
      throw new ConflictException(
        'A refund request is already awaiting organizer approval',
      );
    }
    if (booking.status !== 'CONFIRMED') {
      throw new ConflictException(
        'Only paid (confirmed) bookings can request a refund — unpaid bookings can simply be cancelled',
      );
    }
    if (payment.status !== 'CAPTURED' || !payment.razorpayPaymentId) {
      throw new ConflictException('No captured payment exists for this booking');
    }

    const requestedAt = new Date();
    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: 'CAPTURED',
          OR: [
            { refundRequestStatus: null },
            { refundRequestStatus: 'REJECTED' },
            { refundRequestStatus: 'FAILED' },
          ],
        },
        data: {
          refundRequestStatus: 'PENDING',
          refundRequestReason: reason ?? null,
          refundRequestedAt: requestedAt,
          refundReviewedAt: null,
          refundReviewedBy: null,
        },
      });
      if (result.count === 1) {
        await tx.auditLog.create({
          data: {
            userId,
            action: 'REFUND_REQUESTED',
            entity: 'PAYMENT',
            entityId: payment.id,
            details: { bookingId: booking.id, outcome: 'awaiting_approval' },
          },
        });
      }
      return result.count === 1;
    });
    if (!claimed) {
      throw new ConflictException(
        'A refund request is already open or this payment is no longer eligible',
      );
    }

    if (booking.event.organizer?.userId) {
      void this.notifications.createInAppNotification({
        userId: booking.event.organizer.userId,
        type: 'SYSTEM',
        title: 'New refund request',
        message: `An attendee requested a refund for "${booking.event.title}".`,
        data: {
          action: 'REFUND_REQUESTED',
          bookingId,
          eventId: booking.event.id,
          link: '/organizer/refunds',
        },
      });
    }

    return {
      refundRequest: {
        bookingId,
        status: 'PENDING' as const,
        reason: reason ?? null,
        requestedAt,
      },
    };
  }

  async listOrganizerRefundRequests(
    organizerId: string,
    statusFilter?: string,
    page = 1,
    limit = 20,
  ) {
    const where: Prisma.PaymentWhereInput = {
      booking: { event: { organizerId } },
    };

    const upper = statusFilter?.toUpperCase();
    if (upper === 'PENDING') {
      where.refundRequestStatus = 'PENDING';
    } else if (upper === 'APPROVED') {
      where.refundRequestStatus = 'APPROVED';
      where.status = 'REFUND_PENDING';
    } else if (upper === 'REFUNDED') {
      where.status = 'REFUNDED';
    } else if (upper === 'REJECTED') {
      where.refundRequestStatus = 'REJECTED';
    } else if (upper === 'FAILED') {
      where.refundRequestStatus = 'FAILED';
    } else if (upper === 'ALL' || !statusFilter) {
      where.OR = [
        { refundRequestStatus: { not: null } },
        { status: { in: ['REFUND_PENDING', 'REFUNDED'] } },
      ];
    } else {
      where.refundRequestStatus = { not: null };
    }

    const [
      pendingCount,
      approvedCount,
      refundedCount,
      rejectedCount,
      failedCount,
      allCount,
    ] = await Promise.all([
      this.prisma.payment.count({
        where: { booking: { event: { organizerId } }, refundRequestStatus: 'PENDING' },
      }),
      this.prisma.payment.count({
        where: {
          booking: { event: { organizerId } },
          refundRequestStatus: 'APPROVED',
          status: 'REFUND_PENDING',
        },
      }),
      this.prisma.payment.count({
        where: { booking: { event: { organizerId } }, status: 'REFUNDED' },
      }),
      this.prisma.payment.count({
        where: { booking: { event: { organizerId } }, refundRequestStatus: 'REJECTED' },
      }),
      this.prisma.payment.count({
        where: { booking: { event: { organizerId } }, refundRequestStatus: 'FAILED' },
      }),
      this.prisma.payment.count({
        where: {
          booking: { event: { organizerId } },
          OR: [
            { refundRequestStatus: { not: null } },
            { status: { in: ['REFUND_PENDING', 'REFUNDED'] } },
          ],
        },
      }),
    ]);

    const [refundRequests, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { refundRequestedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          bookingId: true,
          amount: true,
          currency: true,
          status: true,
          refundRequestStatus: true,
          refundRequestReason: true,
          refundRequestedAt: true,
          refundReviewedAt: true,
          refundReviewedBy: true,
          refundId: true,
          updatedAt: true,
          booking: {
            select: {
              id: true,
              totalAmount: true,
              status: true,
              createdAt: true,
              user: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
              event: {
                select: {
                  id: true,
                  title: true,
                  slug: true,
                  startDate: true,
                  status: true,
                },
              },
              items: {
                select: { quantity: true, ticketType: { select: { name: true } } },
              },
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      refundRequests,
      counts: {
        PENDING: pendingCount,
        APPROVED: approvedCount,
        REFUNDED: refundedCount,
        REJECTED: rejectedCount,
        FAILED: failedCount,
        ALL: allCount,
      },
      total,
      page,
      limit,
    };
  }

  async reconcileOrganizerRefund(
    organizerId: string,
    actorUserId: string,
    bookingId: string,
  ) {
    await this.loadOrganizerRefundPayment(organizerId, bookingId);
    return this.reconcileRefund(actorUserId, bookingId);
  }

  async recoverOrganizerRefund(
    organizerId: string,
    actorUserId: string,
    bookingId: string,
  ) {
    await this.loadOrganizerRefundPayment(organizerId, bookingId);
    return this.recoverApprovedRefund(actorUserId, bookingId);
  }

  async approveRefundRequest(
    organizerId: string,
    actorUserId: string,
    bookingId: string,
  ) {
    const payment = await this.loadOrganizerRefundPayment(organizerId, bookingId);
    if (payment.refundRequestStatus !== 'PENDING') {
      throw new ConflictException('This refund request is no longer awaiting approval');
    }
    if (
      payment.status !== 'CAPTURED' ||
      (payment.booking.status !== 'CONFIRMED' &&
        payment.booking.status !== 'CANCELLED' &&
        payment.booking.status !== 'EXPIRED') ||
      !payment.razorpayPaymentId
    ) {
      throw new ConflictException('This payment is no longer eligible for a refund');
    }
    // Construction validates local configuration without making a provider call.
    const razorpay = this.ensureClient();
    const refundAttemptKey = randomBytes(16).toString('hex');
    const approvedAt = new Date();
    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: 'CAPTURED',
          refundRequestStatus: 'PENDING',
        },
        data: {
          status: 'REFUND_PENDING',
          refundId: null,
          refundAttemptKey,
          refundRequestStatus: 'APPROVED',
          refundReviewedAt: approvedAt,
          refundReviewedBy: actorUserId,
        },
      });
      if (result.count === 1) {
        await tx.auditLog.create({
          data: {
            userId: actorUserId,
            action: 'REFUND_APPROVED',
            entity: 'PAYMENT',
            entityId: payment.id,
            details: { bookingId, outcome: 'approved' },
          },
        });
      }
      return result.count === 1;
    });
    if (!claimed) {
      throw new ConflictException(
        'This refund request was already reviewed or processed',
      );
    }

    if (payment.booking.userId) {
      void this.notifications.createInAppNotification({
        userId: payment.booking.userId,
        type: 'REFUND_PROCESSED',
        title: 'Refund approved',
        message: `Your refund for "${payment.booking.event.title}" was approved and settlement is being processed.`,
        data: { action: 'REFUND_APPROVED', bookingId, link: '/tickets' },
      });
    }

    return this.initiateApprovedRefund(
      {
        ...payment,
        status: 'REFUND_PENDING',
        refundRequestStatus: 'APPROVED',
        refundAttemptKey,
      },
      actorUserId,
      razorpay,
      refundAttemptKey,
    );
  }

  async rejectRefundRequest(organizerId: string, actorUserId: string, bookingId: string) {
    const payment = await this.loadOrganizerRefundPayment(organizerId, bookingId);
    if (payment.refundRequestStatus !== 'PENDING') {
      throw new ConflictException('This refund request is no longer awaiting approval');
    }
    const reviewedAt = new Date();
    const rejected = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payment.updateMany({
        where: { id: payment.id, refundRequestStatus: 'PENDING', status: 'CAPTURED' },
        data: {
          refundRequestStatus: 'REJECTED',
          refundReviewedAt: reviewedAt,
          refundReviewedBy: actorUserId,
        },
      });
      if (result.count === 1) {
        await tx.auditLog.create({
          data: {
            userId: actorUserId,
            action: 'REFUND_REJECTED',
            entity: 'PAYMENT',
            entityId: payment.id,
            details: { bookingId, outcome: 'rejected' },
          },
        });
      }
      return result.count === 1;
    });
    if (!rejected) {
      throw new ConflictException(
        'This refund request was already reviewed or processed',
      );
    }

    if (payment.booking.userId) {
      void this.notifications.createInAppNotification({
        userId: payment.booking.userId,
        type: 'SYSTEM',
        title: 'Refund request declined',
        message: `Your refund request for "${payment.booking.event.title}" was declined by the organizer.`,
        data: { action: 'REFUND_REJECTED', bookingId, link: '/tickets' },
      });
    }

    return { bookingId, status: 'REJECTED' as const, reviewedAt };
  }

  private async loadOrganizerRefundPayment(
    organizerId: string,
    bookingId: string,
  ): Promise<RefundablePayment> {
    const payment = await this.prisma.payment.findUnique({
      where: { bookingId },
      include: {
        booking: {
          include: {
            items: true,
            user: { select: { id: true, email: true, firstName: true, lastName: true } },
            event: { select: { id: true, title: true, organizerId: true, status: true } },
          },
        },
      },
    });
    if (!payment || payment.booking.event.organizerId !== organizerId) {
      throw new NotFoundException('Refund request not found');
    }
    return payment;
  }

  private async initiateApprovedRefund(
    payment: RefundablePayment,
    actorUserId: string,
    razorpay: Razorpay,
    refundAttemptKey: string,
  ) {
    const booking = payment.booking;
    const reason = payment.refundRequestReason ?? 'Customer refund';
    const razorpayPaymentId = payment.razorpayPaymentId;
    if (!razorpayPaymentId) {
      throw new ConflictException('No captured payment exists for this booking');
    }
    let refund: { id: string; amount: number; status: string };
    try {
      refund = (await razorpay.payments.refund(razorpayPaymentId, {
        speed: 'normal',
        notes: {
          bookingId: booking.id,
          eventaiRefundAttempt: refundAttemptKey,
          reason,
        },
      })) as { id: string; amount: number; status: string };
    } catch (error) {
      const statusCode =
        typeof error === 'object' && error !== null && 'statusCode' in error
          ? Number((error as { statusCode?: unknown }).statusCode)
          : NaN;
      // Any transport/provider exception is ambiguous: even a 4xx surfaced by
      // an intermediary must not release the claim without authoritative data.
      await this.auditRefundOutcome(
        payment.id,
        actorUserId,
        'REFUND_RECONCILIATION_REQUIRED',
        {
          bookingId: booking.id,
          providerStatusCode: Number.isInteger(statusCode) ? statusCode : undefined,
          outcome: 'unknown',
        },
      );
      throw new ServiceUnavailableException(
        'Refund outcome is pending provider reconciliation; do not retry yet',
      );
    }
    const state = await this.applyRefundStatus(
      { ...payment, status: 'REFUND_PENDING', refundAttemptKey },
      { ...refund, payment_id: razorpayPaymentId },
      actorUserId,
      reason,
    );
    if (state === 'failed') {
      throw new BadRequestException('The payment provider could not process the refund');
    }
    if (state === 'unknown' || state === 'pending') {
      return {
        booking: await this.prisma.booking.findUniqueOrThrow({
          where: { id: booking.id },
          include: {
            items: true,
            payment: true,
            tickets: {
              select: {
                id: true,
                ticketCode: true,
                holderName: true,
                status: true,
                ticketTypeId: true,
              },
            },
          },
        }),
        refundId: refund.id,
        refundAmount: null,
        refundStatus: 'pending',
        reconciliationRequired: true,
      };
    }
    return {
      booking: await this.prisma.booking.findUniqueOrThrow({
        where: { id: booking.id },
        include: {
          items: true,
          payment: true,
          tickets: {
            select: {
              id: true,
              ticketCode: true,
              holderName: true,
              status: true,
              ticketTypeId: true,
            },
          },
        },
      }),
      refundId: refund.id,
      refundAmount: refund.amount,
      refundStatus: 'processed',
    };
  }

  /** Admin-only lookup; this never creates a refund and never treats missing data as failure. */
  async reconcileRefund(adminUserId: string, bookingId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { bookingId },
      include: {
        booking: {
          include: {
            items: true,
            user: { select: { email: true, firstName: true, lastName: true } },
            event: { select: { title: true } },
          },
        },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'REFUND_PENDING' || !payment.razorpayPaymentId) {
      return { bookingId, status: payment.status, outcome: 'not_pending' };
    }

    let refund: RazorpayRefundRecord | undefined;
    try {
      const client = this.ensureClient();
      if (payment.refundId) {
        refund = (await client.payments.fetchRefund(
          payment.razorpayPaymentId,
          payment.refundId,
        )) as RazorpayRefundRecord;
      } else {
        const providerPayment = (await client.payments.fetch(
          payment.razorpayPaymentId,
        )) as RazorpayPaymentRecord;
        const result = (await client.payments.fetchMultipleRefund(
          payment.razorpayPaymentId,
          { count: 100 },
        )) as {
          count: number;
          items: RazorpayRefundRecord[];
        };
        const rawKey = payment.refundAttemptKey ?? '';
        const claimMeta = parseClaimKey(rawKey);

        const matches = result.items.filter(
          (candidate) =>
            candidate.payment_id === payment.razorpayPaymentId &&
            candidate.amount === payment.amount &&
            (rawKey
              ? String(candidate.notes?.eventaiRefundAttempt ?? '') === claimMeta.baseKey
              : String(candidate.notes?.bookingId ?? '') === payment.bookingId),
        );

        if (matches.length === 1) {
          refund = matches[0] as RazorpayRefundRecord;
        } else if (
          result.items.length === 0 &&
          (providerPayment.amount_refunded ?? 0) === 0
        ) {
          // Provider authoritatively verifies zero refunds exist.
          if (claimMeta.isClaimed && claimMeta.claimedAt) {
            const elapsed = Date.now() - claimMeta.claimedAt;
            if (elapsed >= STALE_CLAIM_TIMEOUT_MS) {
              // Stale claim confirmed dead and zero refunds exist at provider: safely release claim.
              await this.prisma.payment.updateMany({
                where: {
                  id: payment.id,
                  status: 'REFUND_PENDING',
                  refundAttemptKey: rawKey,
                },
                data: {
                  refundAttemptKey: claimMeta.baseKey || null,
                },
              });
              await this.prisma.auditLog.create({
                data: {
                  userId: adminUserId,
                  action: 'STALE_RECOVERY_CLAIM_RELEASED',
                  entity: 'PAYMENT',
                  entityId: payment.id,
                  details: {
                    bookingId: payment.bookingId,
                    staleClaimKey: rawKey,
                    baseAttemptKey: claimMeta.baseKey,
                    elapsedMs: elapsed,
                  },
                },
              });
              return {
                bookingId,
                status: 'REFUND_PENDING',
                outcome: 'stale_claim_released',
                message:
                  'Provider reconciliation verified no refund exists at provider. Stale recovery claim has been safely cleared; recovery can now be retried.',
              };
            } else {
              return {
                bookingId,
                status: 'REFUND_PENDING',
                outcome: 'recovery_in_progress',
                message:
                  'A recovery operation is currently in progress. Please allow it to finish or wait for the timeout before reconciling.',
              };
            }
          }

          return {
            bookingId,
            status: 'REFUND_PENDING',
            outcome: 'no_provider_refund',
            message:
              'Provider reconciliation verified no refund exists at provider. Payment remains pending and eligible for recovery.',
          };
        }
      }

      if (
        !refund ||
        refund.payment_id !== payment.razorpayPaymentId ||
        (payment.refundId !== null && refund.id !== payment.refundId)
      ) {
        await this.auditRefundOutcome(
          payment.id,
          adminUserId,
          'REFUND_RECONCILIATION_REQUIRED',
          {
            bookingId: payment.bookingId,
            outcome: 'unknown',
          },
        );
        return {
          bookingId,
          status: 'REFUND_PENDING',
          outcome: 'unknown',
          message:
            'Provider settlement is still in progress or contains uncoordinated refunds that require manual inspection.',
        };
      }
    } catch (err: any) {
      const isMissingConfig =
        !process.env.RAZORPAY_KEY_ID?.trim() || !process.env.RAZORPAY_KEY_SECRET?.trim();
      const statusCode = Number(err?.statusCode);
      const isAuthError = statusCode === 401 || statusCode === 403;
      const outcome = isMissingConfig
        ? 'missing_configuration'
        : isAuthError
          ? 'provider_error'
          : 'provider_unavailable';
      const message = isMissingConfig
        ? 'Payment provider configuration missing: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set in .env.'
        : isAuthError
          ? 'Payment provider authentication failed (HTTP 401/403): invalid or expired Razorpay API keys in .env.'
          : err?.message ||
            'Payment provider is temporarily unavailable. The refund remains safely pending settlement.';

      await this.auditRefundOutcome(
        payment.id,
        adminUserId,
        'REFUND_RECONCILIATION_REQUIRED',
        {
          bookingId: payment.bookingId,
          outcome,
          error: message,
        },
      );
      return {
        bookingId,
        status: 'REFUND_PENDING',
        outcome,
        message,
      };
    }
    const state = await this.applyRefundStatus(payment, refund, adminUserId);
    const message =
      state === 'processed'
        ? 'Provider reconciliation complete: refund confirmed as processed.'
        : state === 'failed'
          ? 'Provider reconciliation complete: refund settlement failed.'
          : state === 'pending'
            ? 'Provider settlement is in progress at payment provider. Please check back shortly.'
            : 'Provider settlement outcome is pending confirmation.';

    return {
      bookingId,
      refundId: refund.id,
      status:
        state === 'processed'
          ? 'REFUNDED'
          : state === 'failed'
            ? 'CAPTURED'
            : 'REFUND_PENDING',
      outcome: state === 'pending' ? 'provider_pending' : state,
      message,
    };
  }

  /**
   * Guarded recovery for an approved REFUND_PENDING payment whose initial request
   * definitively failed before refund creation at the provider.
   *
   * Hardened safety design:
   * 1. Validates local record is in approved REFUND_PENDING state with null refundId.
   * 2. Inspects audit history: definitive 4xx pre-creation rejections (400/401/403/404)
   *    can proceed; ambiguous errors (timeouts, 5xx) require a 10-minute cooldown window.
   * 3. Claims the recovery operation via an atomic, conditional database update BEFORE
   *    any provider calls that could lead to refund creation.
   *    - Mutates the attempt key with an active claim token and timestamp.
   *    - Rejects concurrent requests unconditionally (count === 0).
   *    - Fails closed on any held claim; crashed claims must be reconciled with provider.
   * 4. Post-claim provider checks:
   *    - Validates client configuration, payment identity, captured status, and amount.
   *    - Checks Razorpay refund list: correlates existing refunds without issuing duplicates.
   *    - If pre-checks fail or cannot proceed, cleanly releases the claim back to the base attempt key.
   * 5. Refund initiation:
   *    - Passes durable base attempt key in notes (notes are correlation metadata, not gateway idempotency).
   *    - On ambiguous transport/gateway exceptions: records REFUND_RECONCILIATION_REQUIRED,
   *      restores base attempt key, and throws ServiceUnavailableException to prevent unsafe retry.
   * 6. Finalizes refund via applyRefundStatus (restores inventory, cancels tickets, notifies attendee).
   */
  async recoverApprovedRefund(actorUserId: string, bookingId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { bookingId },
      include: {
        booking: {
          include: {
            items: true,
            user: { select: { id: true, email: true, firstName: true, lastName: true } },
            event: { select: { id: true, title: true, organizerId: true, status: true } },
          },
        },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    if (
      payment.status !== 'REFUND_PENDING' ||
      payment.refundRequestStatus !== 'APPROVED'
    ) {
      throw new ConflictException(
        'Payment is not in an approved pending refund state eligible for recovery',
      );
    }
    if (payment.refundId !== null) {
      throw new ConflictException(
        'Payment already has a provider refund ID; use reconciliation instead of recovery',
      );
    }
    if (!payment.razorpayPaymentId) {
      throw new ConflictException('No captured payment exists for this booking');
    }

    // 1. Audit trail inspection for definitive pre-creation failure vs ambiguous error
    const auditLogs = await this.prisma.auditLog.findMany({
      where: { entity: 'PAYMENT', entityId: payment.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const reconciliationLogs = auditLogs.filter(
      (log) => log.action === 'REFUND_RECONCILIATION_REQUIRED',
    );
    const latestReconciliationLog = reconciliationLogs[0];

    if (latestReconciliationLog) {
      const details = (latestReconciliationLog.details ?? {}) as Record<string, unknown>;
      const statusCode = Number(details.providerStatusCode);
      const isDefinitivePreCreationFailure =
        statusCode === 400 ||
        statusCode === 401 ||
        statusCode === 403 ||
        statusCode === 404;

      if (!isDefinitivePreCreationFailure) {
        const cooldownMs = 10 * 60 * 1000;
        const logTime = latestReconciliationLog.createdAt
          ? new Date(latestReconciliationLog.createdAt).getTime()
          : 0;
        const elapsedMs = Date.now() - logTime;
        if (elapsedMs < cooldownMs) {
          return {
            bookingId,
            status: 'REFUND_PENDING',
            outcome: 'ambiguous_provider_state',
            message:
              'Previous refund attempt had an ambiguous outcome and is within the 10-minute cooldown window. Please allow provider settlement to proceed or use reconciliation.',
          };
        }
      }
    }

    // 2. Inspect current claim state on payment.refundAttemptKey
    const rawKey = payment.refundAttemptKey ?? '';
    const claimMeta = parseClaimKey(rawKey);
    const baseAttemptKey = claimMeta.baseKey || randomBytes(16).toString('hex');

    // Strict fail-closed guard: NEVER steal/reclaim an active claim solely on elapsed time.
    // Delayed provider requests or slow resumed processes could race and cause duplicate refunds.
    // Any held claim must be reconciled authoritatively with the provider before retrying.
    if (claimMeta.isClaimed) {
      throw new ConflictException(
        'A refund recovery operation is already claimed or in progress for this payment. Please run reconciliation to verify provider status before retrying.',
      );
    }

    // 3. Acquire Durable, Atomic Database Claim BEFORE provider calls
    const claimToken = randomBytes(8).toString('hex');
    const claimTimestamp = Date.now();
    const activeClaimKey = `${baseAttemptKey}:claim:${claimToken}:${claimTimestamp}`;

    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: 'REFUND_PENDING',
          refundRequestStatus: 'APPROVED',
          refundId: null,
          refundAttemptKey: payment.refundAttemptKey,
        },
        data: {
          refundAttemptKey: activeClaimKey,
          updatedAt: new Date(),
        },
      });
      if (result.count === 1) {
        await tx.auditLog.create({
          data: {
            userId: actorUserId,
            action: 'REFUND_RECOVERY_STARTED',
            entity: 'PAYMENT',
            entityId: payment.id,
            details: {
              bookingId: payment.bookingId,
              refundAttemptKey: baseAttemptKey,
              claimToken,
            },
          },
        });
      }
      return result.count === 1;
    });

    if (!claimed) {
      throw new ConflictException('Concurrent recovery or refund processing detected');
    }

    // Safe helper to release claim back to baseAttemptKey on non-refund exit paths
    const releaseClaim = async () => {
      try {
        await this.prisma.payment.updateMany({
          where: {
            id: payment.id,
            status: 'REFUND_PENDING',
            refundAttemptKey: activeClaimKey,
          },
          data: {
            refundAttemptKey: baseAttemptKey,
          },
        });
      } catch (releaseErr) {
        this.logger.error(
          `Failed to release recovery claim on payment ${payment.id}: ${releaseErr}`,
        );
      }
    };

    // 4. Provider Pre-Checks and Verification (Executed under protection of the claim)
    let client: Razorpay;
    try {
      client = this.ensureClient();
    } catch {
      await releaseClaim();
      return {
        bookingId,
        status: 'REFUND_PENDING',
        outcome: 'missing_configuration',
        message: 'Payment provider configuration missing: keys not configured.',
      };
    }

    let providerPayment: RazorpayPaymentRecord;
    let refundList: { count: number; items: RazorpayRefundRecord[] };

    try {
      providerPayment = (await client.payments.fetch(
        payment.razorpayPaymentId,
      )) as RazorpayPaymentRecord;
      refundList = (await client.payments.fetchMultipleRefund(payment.razorpayPaymentId, {
        count: 100,
      })) as {
        count: number;
        items: RazorpayRefundRecord[];
      };
    } catch (err: any) {
      await releaseClaim();
      const statusCode = Number(err?.statusCode);
      const isAuthError = statusCode === 401 || statusCode === 403;
      const outcome = isAuthError ? 'provider_error' : 'provider_unavailable';
      const message = isAuthError
        ? 'Payment provider authentication failed (HTTP 401/403): invalid or expired Razorpay API keys.'
        : err?.message ||
          'Payment provider is temporarily unavailable during recovery verification.';

      await this.auditRefundOutcome(
        payment.id,
        actorUserId,
        'REFUND_RECONCILIATION_REQUIRED',
        {
          bookingId: payment.bookingId,
          outcome,
          error: message,
        },
      );

      return {
        bookingId,
        status: 'REFUND_PENDING',
        outcome,
        message,
      };
    }

    // Validate payment identity, captured status, amount, and currency
    if (providerPayment.id !== payment.razorpayPaymentId) {
      await releaseClaim();
      throw new ConflictException(
        'Provider payment ID does not match local payment record',
      );
    }
    if (
      providerPayment.amount !== payment.amount ||
      providerPayment.currency !== payment.currency
    ) {
      await releaseClaim();
      throw new ConflictException(
        'Provider payment amount or currency does not match local payment record',
      );
    }

    // Check if matching refund already exists at provider
    const existingMatchingRefund = refundList.items.find((candidate) => {
      const notes = candidate.notes ?? {};
      const matchesAttempt = baseAttemptKey
        ? String(notes.eventaiRefundAttempt ?? '') === baseAttemptKey
        : false;
      const matchesBooking = String(notes.bookingId ?? '') === payment.bookingId;
      return (
        candidate.payment_id === payment.razorpayPaymentId &&
        candidate.amount === payment.amount &&
        (matchesAttempt || matchesBooking)
      );
    });

    if (existingMatchingRefund) {
      const state = await this.applyRefundStatus(
        { ...payment, refundAttemptKey: activeClaimKey },
        existingMatchingRefund,
        actorUserId,
        payment.refundRequestReason ?? 'Customer refund',
      );
      // Restore baseAttemptKey
      await this.prisma.payment
        .updateMany({
          where: { id: payment.id, refundAttemptKey: activeClaimKey },
          data: { refundAttemptKey: baseAttemptKey },
        })
        .catch(() => undefined);

      return {
        bookingId,
        refundId: existingMatchingRefund.id,
        status:
          state === 'processed'
            ? 'REFUNDED'
            : state === 'failed'
              ? 'CAPTURED'
              : 'REFUND_PENDING',
        outcome: 'reconciled_existing',
        message: 'Existing provider refund correlated and finalized.',
      };
    }

    // Check for any uncoordinated or partial refunds on the provider payment
    if (refundList.items.length > 0 || (providerPayment.amount_refunded ?? 0) > 0) {
      await releaseClaim();
      throw new ConflictException(
        'Provider payment has existing or partial refunds that cannot be safely correlated. Manual reconciliation required.',
      );
    }

    // Verify payment is in captured state
    if (providerPayment.status !== 'captured') {
      await releaseClaim();
      throw new ConflictException(
        `Provider payment is in unexpected status '${providerPayment.status}'; expected 'captured'`,
      );
    }

    // 5. Safe Refund Initiation (Correlation metadata via notes; provider idempotency not guaranteed)
    const booking = payment.booking;
    const reason = payment.refundRequestReason ?? 'Customer refund';

    let refund: { id: string; amount: number; status: string };
    try {
      refund = (await client.payments.refund(payment.razorpayPaymentId, {
        speed: 'normal',
        notes: {
          bookingId: booking.id,
          eventaiRefundAttempt: baseAttemptKey,
          reason,
        },
      })) as { id: string; amount: number; status: string };
    } catch (error) {
      const statusCode =
        typeof error === 'object' && error !== null && 'statusCode' in error
          ? Number((error as { statusCode?: unknown }).statusCode)
          : NaN;

      // DO NOT release to retryable state! Restore baseAttemptKey for reconciliation lookups.
      await this.prisma.payment
        .updateMany({
          where: {
            id: payment.id,
            status: 'REFUND_PENDING',
            refundAttemptKey: activeClaimKey,
          },
          data: { refundAttemptKey: baseAttemptKey },
        })
        .catch(() => undefined);

      await this.auditRefundOutcome(
        payment.id,
        actorUserId,
        'REFUND_RECONCILIATION_REQUIRED',
        {
          bookingId: booking.id,
          providerStatusCode: Number.isInteger(statusCode) ? statusCode : undefined,
          outcome: 'unknown',
        },
      );
      throw new ServiceUnavailableException(
        'Refund outcome is pending provider reconciliation; do not retry yet',
      );
    }

    // 6. Finalize using existing applyRefundStatus (restores inventory, tickets, status, and notifies)
    const state = await this.applyRefundStatus(
      { ...payment, status: 'REFUND_PENDING', refundAttemptKey: activeClaimKey },
      { ...refund, payment_id: payment.razorpayPaymentId },
      actorUserId,
      reason,
    );

    // Restore baseAttemptKey on the finalized record
    await this.prisma.payment
      .updateMany({
        where: { id: payment.id, refundAttemptKey: activeClaimKey },
        data: { refundAttemptKey: baseAttemptKey },
      })
      .catch(() => undefined);

    if (state === 'failed') {
      throw new BadRequestException('The payment provider could not process the refund');
    }

    return {
      booking: await this.prisma.booking.findUniqueOrThrow({
        where: { id: booking.id },
        include: {
          items: true,
          payment: true,
          tickets: {
            select: {
              id: true,
              ticketCode: true,
              holderName: true,
              status: true,
              ticketTypeId: true,
            },
          },
        },
      }),
      refundId: refund.id,
      refundAmount: refund.amount,
      refundStatus: state === 'processed' ? 'processed' : 'pending',
      outcome: 'recovered',
    };
  }

  private async applyRefundStatus(
    payment: {
      id: string;
      bookingId: string;
      amount: number;
      status: string;
      refundId: string | null;
      refundAttemptKey: string | null;
      booking: {
        id: string;
        status: string;
        items: { ticketTypeId: string; quantity: number }[];
        user: { email: string; firstName: string; lastName: string };
        event: { title: string };
      };
    },
    refund: RazorpayRefundRecord,
    actorUserId: string | null,
    reason?: string,
  ): Promise<'processed' | 'failed' | 'pending' | 'unknown'> {
    if (payment.status !== 'REFUND_PENDING') {
      return payment.status === 'REFUNDED' && payment.refundId === refund.id
        ? 'processed'
        : 'unknown';
    }
    if (refund.amount !== payment.amount) {
      await this.auditRefundOutcome(
        payment.id,
        actorUserId,
        'REFUND_RECONCILIATION_REQUIRED',
        {
          bookingId: payment.bookingId,
          refundId: refund.id,
          outcome: 'amount_mismatch',
        },
      );
      return 'unknown';
    }

    // Bind the provider refund to this pending local record before changing
    // terminal state. Competing/out-of-order results must match this ID.
    if (payment.refundId !== refund.id) {
      const bound = await this.prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: 'REFUND_PENDING',
          refundId: payment.refundId,
          refundAttemptKey: payment.refundAttemptKey,
        },
        data: { refundId: refund.id },
      });
      if (bound.count !== 1) return 'unknown';
    }

    if (refund.status !== 'processed' && refund.status !== 'failed') {
      await this.auditRefundOutcome(
        payment.id,
        actorUserId,
        'REFUND_RECONCILIATION_REQUIRED',
        {
          bookingId: payment.bookingId,
          refundId: refund.id,
          providerStatus: refund.status,
          outcome: 'pending',
        },
      );
      return 'pending';
    }

    if (refund.status === 'failed') {
      const changed = await this.prisma.$transaction(async (tx) => {
        const result = await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: 'REFUND_PENDING',
            refundId: refund.id,
            refundAttemptKey: payment.refundAttemptKey,
          },
          data: { status: 'CAPTURED', refundRequestStatus: 'FAILED' },
        });
        if (result.count === 1) {
          await tx.auditLog.create({
            data: {
              userId: actorUserId,
              action: 'REFUND_RECONCILIATION_FAILED',
              entity: 'PAYMENT',
              entityId: payment.id,
              details: {
                bookingId: payment.bookingId,
                refundId: refund.id,
                providerStatus: 'failed',
              },
            },
          });
        }
        return result.count === 1;
      });
      return changed ? 'failed' : 'unknown';
    }

    const refunded = await this.prisma.$transaction(async (tx) => {
      const paymentUpdated = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: 'REFUND_PENDING',
          refundId: refund.id,
          refundAttemptKey: payment.refundAttemptKey,
        },
        data: { status: 'REFUNDED', refundAmount: refund.amount },
      });
      if (paymentUpdated.count !== 1) return null;
      const bookingUpdated = await tx.booking.updateMany({
        where: {
          id: payment.bookingId,
          status: { in: ['CONFIRMED', 'CANCELLED', 'EXPIRED'] },
        },
        data: {
          status: 'REFUNDED',
          cancelledAt: new Date(),
          cancellationReason: reason ?? 'Customer refund',
        },
      });
      if (bookingUpdated.count !== 1) {
        throw new ConflictException(
          'Provider refund succeeded but booking state needs reconciliation',
        );
      }
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: 'REFUND_COMPLETED',
          entity: 'PAYMENT',
          entityId: payment.id,
          details: {
            bookingId: payment.bookingId,
            refundId: refund.id,
            refundAmount: refund.amount,
          },
        },
      });
      await tx.ticket.updateMany({
        where: { bookingId: payment.bookingId, status: 'VALID' },
        data: { status: 'CANCELLED' },
      });
      if (payment.booking.status === 'CONFIRMED') {
        for (const item of payment.booking.items) {
          await tx.ticketType.updateMany({
            where: { id: item.ticketTypeId },
            data: { availableQuantity: { increment: item.quantity } },
          });
        }
      }
      return tx.booking.findUniqueOrThrow({
        where: { id: payment.bookingId },
        include: {
          items: true,
          payment: true,
          tickets: {
            select: {
              id: true,
              ticketCode: true,
              holderName: true,
              status: true,
              ticketTypeId: true,
            },
          },
        },
      });
    });
    if (!refunded) return 'unknown';
    this.logger.log(`Refund reconciled as processed for payment ${payment.id}`);
    this.notifyRefund(payment.booking, refund.id, refund.amount, reason);
    return 'processed';
  }

  private async auditRefundOutcome(
    paymentId: string,
    userId: string | null,
    action: string,
    details: Record<string, string | number | undefined>,
  ) {
    const safeDetails = Object.fromEntries(
      Object.entries(details).filter(([, value]) => value !== undefined),
    );
    await this.prisma.auditLog.create({
      data: {
        userId,
        action,
        entity: 'PAYMENT',
        entityId: paymentId,
        details: safeDetails,
      },
    });
  }

  /** Fire-and-forget refund email after a successful refund. */
  private notifyRefund(
    booking: {
      id: string;
      userId?: string;
      user: { id?: string; email: string; firstName: string; lastName: string };
      event: { title: string };
    },
    refundId: string,
    refundAmount: number,
    reason?: string,
  ): void {
    void this.notifications
      .sendRefundConfirmation({
        to: booking.user.email,
        holderName:
          `${booking.user.firstName} ${booking.user.lastName}`.trim() || 'Guest',
        eventTitle: booking.event.title,
        bookingId: booking.id,
        refundAmount,
        refundId,
        reason,
      })
      .catch(() => undefined);

    const attendeeId = booking.userId ?? booking.user.id;
    if (attendeeId) {
      void this.notifications.createInAppNotification({
        userId: attendeeId,
        type: 'REFUND_PROCESSED',
        title: 'Refund settled',
        message: `Your refund of ₹${(refundAmount / 100).toLocaleString('en-IN')} for "${booking.event.title}" has been settled.`,
        data: {
          action: 'REFUND_SETTLED',
          bookingId: booking.id,
          refundId,
          link: '/tickets',
        },
      });
    }
  }

  // ── Digital ticket QR ────────────────────────────

  async getTicketQrDataUrl(userId: string, ticketId: string): Promise<string> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { qrData: true, userId: true, status: true },
    });
    if (!ticket || ticket.userId !== userId) {
      throw new NotFoundException('Ticket not found');
    }
    if (ticket.status === 'CANCELLED') {
      throw new ConflictException('This ticket has been cancelled');
    }
    return QRCode.toDataURL(ticket.qrData, { width: 320, margin: 1 });
  }

  // ── Internals ────────────────────────────────────

  /** Marks the payment captured, confirms the booking, and mints tickets. */
  private async confirmBooking(
    tx: Tx,
    input: {
      paymentId: string;
      bookingId: string;
      razorpayPaymentId: string;
      razorpaySignature: string | null;
      method: string | null;
    },
  ) {
    const bookingState = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        status: true,
        userId: true,
        expiresAt: true,
        items: { select: { ticketTypeId: true, quantity: true } },
        event: { select: { status: true } },
      },
    });
    if (!bookingState) {
      throw new NotFoundException('Booking not found');
    }

    // Compare-and-set the payment before minting tickets. Browser verification
    // and the Razorpay webhook may race; only one transaction may win capture.
    const captured = await tx.payment.updateMany({
      where: { id: input.paymentId, status: { in: ['CREATED', 'PENDING'] } },
      data: {
        status: 'CAPTURED',
        razorpayPaymentId: input.razorpayPaymentId,
        razorpaySignature: input.razorpaySignature,
        method: input.method,
        failureReason: null,
      },
    });
    if (captured.count !== 1) {
      throw new ConflictException(
        'Payment was already processed; retry to load its current status',
      );
    }

    const now = new Date();
    const bookingOpen = ['PENDING', 'PAYMENT_PENDING'].includes(bookingState.status);
    const bookingExpired =
      bookingOpen && bookingState.expiresAt !== null && bookingState.expiresAt <= now;
    if (bookingExpired) {
      const expired = await tx.booking.updateMany({
        where: {
          id: input.bookingId,
          status: { in: ['PENDING', 'PAYMENT_PENDING'] },
          expiresAt: { lte: now },
        },
        data: { status: 'EXPIRED' },
      });
      if (expired.count === 1) {
        for (const item of bookingState.items) {
          await tx.ticketType.updateMany({
            where: { id: item.ticketTypeId },
            data: { availableQuantity: { increment: item.quantity } },
          });
        }
      }
    }
    const canIssueTickets =
      bookingOpen && !bookingExpired && bookingState.event.status === 'PUBLISHED';
    if (canIssueTickets) {
      const bookingConfirmed = await tx.booking.updateMany({
        where: {
          id: input.bookingId,
          status: { in: ['PENDING', 'PAYMENT_PENDING'] },
          event: { status: 'PUBLISHED' },
        },
        data: { status: 'CONFIRMED', confirmedAt: now },
      });
      if (bookingConfirmed.count !== 1) {
        await this.queueLateCaptureRefund(
          tx,
          input.paymentId,
          input.bookingId,
          bookingState.userId,
          now,
        );
      }
    } else {
      await this.queueLateCaptureRefund(
        tx,
        input.paymentId,
        input.bookingId,
        bookingState.userId,
        now,
      );
    }

    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: input.bookingId },
      include: { items: true, user: true },
    });

    // A capture arriving after cancellation/expiry must not mint a usable ticket.
    const confirmedBooking = booking.status === 'CONFIRMED';
    const existingCount = confirmedBooking
      ? await tx.ticket.count({ where: { bookingId: booking.id } })
      : 0;
    if (confirmedBooking && existingCount === 0) {
      const holderName =
        [booking.user.firstName, booking.user.lastName].filter(Boolean).join(' ') ||
        'Guest';
      for (const item of booking.items) {
        for (let i = 0; i < item.quantity; i++) {
          const code = `TKT-${randomBytes(8).toString('hex').toUpperCase()}`;
          await tx.ticket.create({
            data: {
              bookingId: booking.id,
              bookingItemId: item.id,
              ticketTypeId: item.ticketTypeId,
              eventId: booking.eventId,
              userId: booking.userId,
              ticketCode: code,
              qrData: JSON.stringify({
                code,
                bookingId: booking.id,
                eventId: booking.eventId,
              }),
              holderName,
            },
          });
        }
      }
    }

    return tx.booking.findUniqueOrThrow({
      where: { id: input.bookingId },
      include: {
        items: true,
        payment: true,
        tickets: {
          select: {
            id: true,
            ticketCode: true,
            holderName: true,
            status: true,
            ticketTypeId: true,
          },
        },
      },
    });
  }

  private async queueLateCaptureRefund(
    tx: Tx,
    paymentId: string,
    bookingId: string,
    userId: string,
    requestedAt: Date,
  ) {
    const request = await tx.payment.updateMany({
      where: {
        id: paymentId,
        status: 'CAPTURED',
        OR: [
          { refundRequestStatus: null },
          { refundRequestStatus: 'REJECTED' },
          { refundRequestStatus: 'FAILED' },
        ],
      },
      data: {
        refundRequestStatus: 'PENDING',
        refundRequestReason:
          'Payment captured after booking or event closed; organizer review required',
        refundRequestedAt: requestedAt,
        refundReviewedAt: null,
        refundReviewedBy: null,
      },
    });
    if (request.count === 1) {
      await tx.auditLog.create({
        data: {
          userId,
          action: 'REFUND_REQUESTED',
          entity: 'PAYMENT',
          entityId: paymentId,
          details: { bookingId, outcome: 'late_capture_awaiting_approval' },
        },
      });
    }
  }

  /** Fire-and-forget ticket email and in-app notifications after a successful confirmation. */
  private notifyConfirmation(
    bookingWithEvent: {
      userId?: string;
      user: { id?: string; email: string };
      event: {
        id?: string;
        title: string;
        startDate: Date;
        organizer?: { userId: string };
      };
    },
    confirmed: {
      id: string;
      userId?: string;
      totalAmount: number;
      tickets: { ticketCode: string; holderName: string }[];
    },
  ): void {
    void this.notifications
      .sendBookingConfirmation({
        to: bookingWithEvent.user.email,
        holderName: confirmed.tickets[0]?.holderName ?? 'Guest',
        eventTitle: bookingWithEvent.event.title,
        eventStart: bookingWithEvent.event.startDate,
        bookingId: confirmed.id,
        totalAmount: confirmed.totalAmount,
        ticketCodes: confirmed.tickets.map((t) => t.ticketCode),
      })
      .catch(() => undefined);

    const attendeeId =
      confirmed.userId ?? bookingWithEvent.userId ?? bookingWithEvent.user.id;
    if (attendeeId) {
      void this.notifications.createInAppNotification({
        userId: attendeeId,
        type: 'BOOKING_CONFIRMED',
        title: 'Booking confirmed!',
        message: `Your booking for "${bookingWithEvent.event.title}" is confirmed (${confirmed.tickets.length} ticket${confirmed.tickets.length === 1 ? '' : 's'}).`,
        data: { action: 'BOOKING_CONFIRMED', bookingId: confirmed.id, link: '/tickets' },
      });
    }

    if (bookingWithEvent.event.organizer?.userId) {
      void this.notifications.createInAppNotification({
        userId: bookingWithEvent.event.organizer.userId,
        type: 'BOOKING_CONFIRMED',
        title: 'New ticket booking',
        message: `A booking for "${bookingWithEvent.event.title}" was confirmed (₹${(confirmed.totalAmount / 100).toLocaleString('en-IN')}).`,
        data: {
          action: 'ORGANIZER_TICKET_SOLD',
          bookingId: confirmed.id,
          eventId: bookingWithEvent.event.id,
          link: '/organizer/events',
        },
      });
    }
  }

  private async loadOwnBooking(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
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
      },
    });
    if (!booking || booking.userId !== userId) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  private orderResponse(orderId: string, amount: number, currency: string) {
    const keyId = process.env.RAZORPAY_KEY_ID?.trim() ?? null;
    return {
      orderId,
      amount,
      currency,
      keyId,
      mode: keyId?.startsWith('rzp_test_') ? 'test' : 'live',
    };
  }

  private currentKeyId: string | null = null;
  private currentKeySecret: string | null = null;

  private ensureClient(): Razorpay {
    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keyId || !keySecret) {
      throw new ServiceUnavailableException(
        'Payments are not configured (missing Razorpay keys)',
      );
    }
    if (!this.razorpayClient) {
      this.razorpayClient = new Razorpay({ key_id: keyId, key_secret: keySecret });
      this.currentKeyId = keyId;
      this.currentKeySecret = keySecret;
    } else if (
      this.currentKeyId !== null &&
      (this.currentKeyId !== keyId || this.currentKeySecret !== keySecret)
    ) {
      this.razorpayClient = new Razorpay({ key_id: keyId, key_secret: keySecret });
      this.currentKeyId = keyId;
      this.currentKeySecret = keySecret;
    }
    return this.razorpayClient;
  }

  private requireSecret(): string {
    const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!secret) {
      throw new ServiceUnavailableException(
        'Payments are not configured (missing Razorpay key secret)',
      );
    }
    return secret;
  }
}

/** Constant-time hex comparison; false on length mismatch. */
function safeEqualHex(expected: string, received: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const STALE_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

function parseClaimKey(key: string | null): {
  baseKey: string;
  isClaimed: boolean;
  claimToken?: string;
  claimedAt?: number;
} {
  if (!key) return { baseKey: '', isClaimed: false };
  const parts = key.split(':claim:');
  if (parts.length < 2) {
    return { baseKey: key, isClaimed: false };
  }
  const baseKey = parts[0];
  const claimMeta = parts[1].split(':');
  const claimToken = claimMeta[0];
  const claimedAt = Number(claimMeta[1]);
  return {
    baseKey,
    isClaimed: true,
    claimToken,
    claimedAt: Number.isFinite(claimedAt) ? claimedAt : undefined,
  };
}
