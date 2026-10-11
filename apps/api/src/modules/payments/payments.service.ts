import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
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
        event: { select: { title: true; organizerId: true } };
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
      return this.orderResponse(existing.razorpayOrderId, booking.totalAmount, existing.currency);
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
      this.logger.error(
        `Razorpay order creation failed${Number.isInteger(statusCode) ? ` (HTTP ${statusCode})` : ''}`,
      );
      throw new BadRequestException('Payment gateway error: unable to create payment order');
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
    if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') {
      throw new ConflictException('This booking is closed — please create a new one');
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

    this.logger.log(`Booking ${booking.id} confirmed via checkout verification`);
    this.notifyConfirmation(booking, confirmed);
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
      parsed = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
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
      this.logger.log(`Booking ${payment.bookingId} confirmed via webhook capture`);
      this.notifyConfirmation(payment.booking, webhookConfirmed);
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
            event: { select: { title: true, organizerId: true } },
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
    if (payment.status === 'REFUND_PENDING' || payment.refundRequestStatus === 'APPROVED') {
      throw new ConflictException('A refund is already approved or being processed');
    }
    if (payment.refundRequestStatus === 'PENDING') {
      throw new ConflictException('A refund request is already awaiting organizer approval');
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
      throw new ConflictException('A refund request is already open or this payment is no longer eligible');
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

  async listOrganizerRefundRequests(organizerId: string) {
    return this.prisma.payment.findMany({
      where: {
        refundRequestStatus: 'PENDING',
        booking: { event: { organizerId } },
      },
      orderBy: { refundRequestedAt: 'asc' },
      select: {
        bookingId: true,
        amount: true,
        currency: true,
        refundRequestReason: true,
        refundRequestedAt: true,
        booking: {
          select: {
            totalAmount: true,
            createdAt: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
            event: { select: { id: true, title: true, slug: true, startDate: true } },
            items: {
              select: { quantity: true, ticketType: { select: { name: true } } },
            },
          },
        },
      },
    });
  }

  async approveRefundRequest(organizerId: string, actorUserId: string, bookingId: string) {
    const payment = await this.loadOrganizerRefundPayment(organizerId, bookingId);
    if (payment.refundRequestStatus !== 'PENDING') {
      throw new ConflictException('This refund request is no longer awaiting approval');
    }
    if (
      payment.status !== 'CAPTURED' ||
      payment.booking.status !== 'CONFIRMED' ||
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
      throw new ConflictException('This refund request was already reviewed or processed');
    }

    return this.initiateApprovedRefund(
      { ...payment, status: 'REFUND_PENDING', refundRequestStatus: 'APPROVED', refundAttemptKey },
      actorUserId,
      razorpay,
      refundAttemptKey,
    );
  }

  async rejectRefundRequest(
    organizerId: string,
    actorUserId: string,
    bookingId: string,
  ) {
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
      throw new ConflictException('This refund request was already reviewed or processed');
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
            user: { select: { email: true, firstName: true, lastName: true } },
            event: { select: { title: true, organizerId: true } },
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
      refund = (await razorpay.payments.refund(
        razorpayPaymentId,
        {
          speed: 'normal',
          notes: {
            bookingId: booking.id,
            eventaiRefundAttempt: refundAttemptKey,
            reason,
          },
        },
      )) as { id: string; amount: number; status: string };
    } catch (error) {
      const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : NaN;
      // Any transport/provider exception is ambiguous: even a 4xx surfaced by
      // an intermediary must not release the claim without authoritative data.
      await this.auditRefundOutcome(payment.id, actorUserId, 'REFUND_RECONCILIATION_REQUIRED', {
        bookingId: booking.id,
        providerStatusCode: Number.isInteger(statusCode) ? statusCode : undefined,
        outcome: 'unknown',
      });
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
    if (state === 'unknown') {
      return {
        booking: await this.prisma.booking.findUniqueOrThrow({
          where: { id: booking.id },
          include: {
            items: true,
            payment: true,
            tickets: { select: { id: true, ticketCode: true, holderName: true, status: true, ticketTypeId: true } },
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
          tickets: { select: { id: true, ticketCode: true, holderName: true, status: true, ticketTypeId: true } },
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
        refund = await client.payments.fetchRefund(
          payment.razorpayPaymentId,
          payment.refundId,
        ) as RazorpayRefundRecord;
      } else {
        const result = await client.payments.fetchMultipleRefund(payment.razorpayPaymentId, { count: 100 });
        const matches = result.items.filter((candidate) =>
          candidate.payment_id === payment.razorpayPaymentId &&
          candidate.amount === payment.amount &&
          (payment.refundAttemptKey
            ? String(candidate.notes?.eventaiRefundAttempt ?? '') === payment.refundAttemptKey
            : String(candidate.notes?.bookingId ?? '') === payment.bookingId),
        );
        if (matches.length === 1) refund = matches[0] as RazorpayRefundRecord;
      }
      if (
        !refund ||
        refund.payment_id !== payment.razorpayPaymentId ||
        (payment.refundId !== null && refund.id !== payment.refundId)
      ) {
        await this.auditRefundOutcome(payment.id, adminUserId, 'REFUND_RECONCILIATION_REQUIRED', {
          bookingId: payment.bookingId,
          outcome: 'unknown',
        });
        return { bookingId, status: 'REFUND_PENDING', outcome: 'unknown' };
      }
    } catch {
      await this.auditRefundOutcome(payment.id, adminUserId, 'REFUND_RECONCILIATION_REQUIRED', {
        bookingId: payment.bookingId,
        outcome: 'provider_unavailable',
      });
      return { bookingId, status: 'REFUND_PENDING', outcome: 'provider_unavailable' };
    }
    const state = await this.applyRefundStatus(payment, refund, adminUserId);
    return {
      bookingId,
      refundId: refund.id,
      status: state === 'processed' ? 'REFUNDED' : state === 'failed' ? 'CAPTURED' : 'REFUND_PENDING',
      outcome: state,
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
        items: { ticketTypeId: string; quantity: number }[];
        user: { email: string; firstName: string; lastName: string };
        event: { title: string };
      };
    },
    refund: RazorpayRefundRecord,
    actorUserId: string | null,
    reason?: string,
  ): Promise<'processed' | 'failed' | 'unknown'> {
    if (payment.status !== 'REFUND_PENDING') {
      return payment.status === 'REFUNDED' && payment.refundId === refund.id
        ? 'processed'
        : 'unknown';
    }
    if (refund.amount !== payment.amount) {
      await this.auditRefundOutcome(payment.id, actorUserId, 'REFUND_RECONCILIATION_REQUIRED', {
        bookingId: payment.bookingId,
        refundId: refund.id,
        outcome: 'amount_mismatch',
      });
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
      await this.auditRefundOutcome(payment.id, actorUserId, 'REFUND_RECONCILIATION_REQUIRED', {
        bookingId: payment.bookingId,
        refundId: refund.id,
        providerStatus: refund.status,
        outcome: 'pending',
      });
      return 'unknown';
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
              details: { bookingId: payment.bookingId, refundId: refund.id, providerStatus: 'failed' },
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
        where: { id: payment.bookingId, status: 'CONFIRMED' },
        data: {
          status: 'REFUNDED',
          cancelledAt: new Date(),
          cancellationReason: reason ?? 'Customer refund',
        },
      });
      if (bookingUpdated.count !== 1) {
        throw new ConflictException('Provider refund succeeded but booking state needs reconciliation');
      }
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: 'REFUND_COMPLETED',
          entity: 'PAYMENT',
          entityId: payment.id,
          details: { bookingId: payment.bookingId, refundId: refund.id, refundAmount: refund.amount },
        },
      });
      await tx.ticket.updateMany({
        where: { bookingId: payment.bookingId, status: 'VALID' },
        data: { status: 'CANCELLED' },
      });
      for (const item of payment.booking.items) {
        await tx.ticketType.updateMany({
          where: { id: item.ticketTypeId },
          data: { availableQuantity: { increment: item.quantity } },
        });
      }
      return tx.booking.findUniqueOrThrow({
        where: { id: payment.bookingId },
        include: {
          items: true,
          payment: true,
          tickets: { select: { id: true, ticketCode: true, holderName: true, status: true, ticketTypeId: true } },
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
    const safeDetails = Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
    await this.prisma.auditLog.create({
      data: { userId, action, entity: 'PAYMENT', entityId: paymentId, details: safeDetails },
    });
  }

  /** Fire-and-forget refund email after a successful refund. */
  private notifyRefund(
    booking: {
      id: string;
      user: { email: string; firstName: string; lastName: string };
      event: { title: string };
    },
    refundId: string,
    refundAmount: number,
    reason?: string,
  ): void {
    void this.notifications
      .sendRefundConfirmation({
        to: booking.user.email,
        holderName: `${booking.user.firstName} ${booking.user.lastName}`.trim() || 'Guest',
        eventTitle: booking.event.title,
        bookingId: booking.id,
        refundAmount,
        refundId,
        reason,
      })
      .catch(() => undefined);
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
      throw new ConflictException('Payment was already processed; retry to load its current status');
    }

    await tx.booking.update({
      where: { id: input.bookingId },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });

    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: input.bookingId },
      include: { items: true, user: true },
    });

    // Mint one digital ticket per unit (idempotent: skip if already minted)
    const existingCount = await tx.ticket.count({ where: { bookingId: booking.id } });
    if (existingCount === 0) {
      const holderName =
        [booking.user.firstName, booking.user.lastName].filter(Boolean).join(' ') || 'Guest';
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

  /** Fire-and-forget ticket email after a successful confirmation. */
  private notifyConfirmation(
    bookingWithEvent: { user: { email: string }; event: { title: string; startDate: Date } },
    confirmed: {
      id: string;
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
  }

  private async loadOwnBooking(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.userId !== userId) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  private orderResponse(orderId: string, amount: number, currency: string) {
    return {
      orderId,
      amount,
      currency,
      keyId: process.env.RAZORPAY_KEY_ID?.trim() ?? null,
    };
  }

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
