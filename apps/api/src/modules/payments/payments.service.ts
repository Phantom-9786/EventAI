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

type Tx = Prisma.TransactionClient;

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

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private razorpayClient: Razorpay | null = null;

  constructor(private readonly prisma: PrismaService) {}

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

    const order = await this.ensureClient().orders.create({
      amount: booking.totalAmount, // paise
      currency: booking.currency,
      receipt: booking.id,
      notes: { bookingId: booking.id, userId },
    }) as RazorpayOrder;

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
    return { booking: confirmed };
  }

  // ── Webhooks ─────────────────────────────────────

  async handleWebhook(rawBody: Buffer | string, signature: string | undefined) {
    if (!signature) {
      throw new BadRequestException('Missing x-razorpay-signature header');
    }
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException('Webhook secret is not configured');
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!safeEqualHex(expected, signature)) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    let parsed: { event: string; payload?: { payment?: { entity?: RazorpayWebhookPayment } } };
    try {
      parsed = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Webhook body is not valid JSON');
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
      await this.prisma.$transaction(async (tx) =>
        this.confirmBooking(tx, {
          paymentId: payment.id,
          bookingId: payment.bookingId,
          razorpayPaymentId: entity.id,
          razorpaySignature: null, // webhook secret already authenticated the payload
          method: entity.method ?? null,
        }),
      );
      this.logger.log(`Booking ${payment.bookingId} confirmed via webhook capture`);
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
    await tx.payment.update({
      where: { id: input.paymentId },
      data: {
        status: 'CAPTURED',
        razorpayPaymentId: input.razorpayPaymentId,
        razorpaySignature: input.razorpaySignature,
        method: input.method,
        failureReason: null,
      },
    });

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
      keyId: process.env.RAZORPAY_KEY_ID ?? null,
    };
  }

  private ensureClient(): Razorpay {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
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
    const secret = process.env.RAZORPAY_KEY_SECRET;
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
