import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: {
    booking: { findUnique: jest.Mock; update: jest.Mock; findUniqueOrThrow: jest.Mock };
    payment: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    ticket: { count: jest.Mock; create: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock };
    ticketType: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let ordersCreate: jest.Mock;
  let refundsCreate: jest.Mock;
  let sendRefundConfirmation: jest.Mock;

  const keyId = 'rzp_test_key';
  const keySecret = 'test_secret_16chars';

  const userId = 'user-1';
  const bookingId = 'booking-1';

  const booking = {
    id: bookingId,
    userId,
    eventId: 'event-1',
    status: 'PENDING',
    totalAmount: 300000,
    currency: 'INR',
    expiresAt: new Date(Date.now() + 300000),
    items: [
      { id: 'item-1', ticketTypeId: 'tt-1', quantity: 2, unitPrice: 150000 },
    ],
    user: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    event: {
      id: 'event-1',
      title: 'Summer Gig',
      startDate: new Date(Date.now() + 30 * 86400000),
    },
  };

  const payment = {
    id: 'pay-row-1',
    bookingId,
    userId,
    razorpayOrderId: 'order_123',
    status: 'CREATED',
    amount: 300000,
    currency: 'INR',
    booking,
  };

  beforeAll(() => {
    process.env.RAZORPAY_KEY_ID = keyId;
    process.env.RAZORPAY_KEY_SECRET = keySecret;
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
  });

  afterAll(() => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  beforeEach(async () => {
    prisma = {
      booking: { findUnique: jest.fn(), update: jest.fn(), findUniqueOrThrow: jest.fn() },
      payment: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      ticket: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      ticketType: { updateMany: jest.fn() },
      $transaction: jest.fn(),
    };
    ordersCreate = jest.fn();
    refundsCreate = jest.fn();
    sendRefundConfirmation = jest.fn().mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: NotificationsService,
          useValue: {
            sendEmail: jest.fn().mockResolvedValue(true),
            sendBookingConfirmation: jest.fn().mockResolvedValue(true),
            sendBookingCancellation: jest.fn().mockResolvedValue(true),
            sendRefundConfirmation,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(PaymentsService);
    // Inject a stubbed Razorpay client
    (service as unknown as { razorpayClient: unknown }).razorpayClient = {
      orders: { create: ordersCreate },
      payments: { refund: refundsCreate },
    };
  });

  describe('createOrder', () => {
    it('reuses the open order on retry (idempotent)', async () => {
      prisma.booking.findUnique.mockResolvedValue(booking);
      prisma.payment.findUnique.mockResolvedValue(payment);

      const result = await service.createOrder(userId, bookingId);

      expect(result).toEqual({
        orderId: 'order_123',
        amount: 300000,
        currency: 'INR',
        keyId,
      });
      expect(ordersCreate).not.toHaveBeenCalled();
    });

    it('creates a Razorpay order and a payment row for a new booking', async () => {
      prisma.booking.findUnique.mockResolvedValue(booking);
      prisma.payment.findUnique.mockResolvedValue(null);
      ordersCreate.mockResolvedValue({ id: 'order_new', amount: 300000, currency: 'INR' });
      prisma.payment.create.mockResolvedValue({ ...payment, razorpayOrderId: 'order_new' });

      const result = await service.createOrder(userId, bookingId);

      expect(ordersCreate).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 300000, receipt: bookingId }),
      );
      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bookingId,
          razorpayOrderId: 'order_new',
          status: 'CREATED',
          idempotencyKey: `order:${bookingId}`,
        }),
      });
      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: bookingId },
        data: { status: 'PAYMENT_PENDING' },
      });
      expect(result.orderId).toBe('order_new');
    });

    it('refuses to create an order for an already-paid booking', async () => {
      prisma.booking.findUnique.mockResolvedValue({ ...booking, status: 'CONFIRMED' });

      await expect(service.createOrder(userId, bookingId)).rejects.toThrow(ConflictException);
      expect(ordersCreate).not.toHaveBeenCalled();
    });

    it('refuses to create an order for an expired booking', async () => {
      prisma.booking.findUnique.mockResolvedValue({
        ...booking,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.createOrder(userId, bookingId)).rejects.toThrow(ConflictException);
    });
  });

  describe('verifyPayment', () => {
    const sign = (payload: string) =>
      createHmac('sha256', keySecret).update(payload).digest('hex');

    it('confirms the booking and mints tickets on a valid signature', async () => {
      prisma.payment.findUnique.mockResolvedValue(payment);
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.payment.update.mockResolvedValue(payment);
      prisma.booking.update.mockResolvedValue({ ...booking, status: 'CONFIRMED' });
      prisma.booking.findUniqueOrThrow
        .mockResolvedValueOnce({ ...booking, status: 'CONFIRMED' }) // load for minting
        .mockResolvedValueOnce({ ...booking, status: 'CONFIRMED', tickets: [] }); // final return

      const { booking: confirmed } = await service.verifyPayment(userId, {
        bookingId,
        razorpayOrderId: 'order_123',
        razorpayPaymentId: 'pay_abc',
        razorpaySignature: sign('order_123|pay_abc'),
      });

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-row-1' },
        data: expect.objectContaining({ status: 'CAPTURED' }),
      });
      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: bookingId },
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      });
      // quantity 2 → two tickets with holder "Ada Lovelace"
      expect(prisma.ticket.create).toHaveBeenCalledTimes(2);
      expect(prisma.ticket.create.mock.calls[0][0].data.holderName).toBe('Ada Lovelace');
      expect(confirmed.status).toBe('CONFIRMED');
    });

    it('rejects a tampered signature', async () => {
      prisma.payment.findUnique.mockResolvedValue(payment);

      await expect(
        service.verifyPayment(userId, {
          bookingId,
          razorpayOrderId: 'order_123',
          razorpayPaymentId: 'pay_abc',
          razorpaySignature: sign('order_123|pay_TAMPERED'),
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns the confirmed booking idempotently when already captured', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...payment,
        status: 'CAPTURED',
      });
      prisma.booking.findUnique.mockResolvedValue({ ...booking, status: 'CONFIRMED' });

      const { booking: confirmed } = await service.verifyPayment(userId, {
        bookingId,
        razorpayOrderId: 'order_123',
        razorpayPaymentId: 'pay_abc',
        razorpaySignature: 'whatever',
      });

      expect(confirmed.status).toBe('CONFIRMED');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('hides payments that belong to other users', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...payment,
        booking: { ...booking, userId: 'someone-else' },
      });

      await expect(
        service.verifyPayment('intruder', {
          bookingId,
          razorpayOrderId: 'order_123',
          razorpayPaymentId: 'pay_abc',
          razorpaySignature: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('handleWebhook', () => {
    const body = (event: string, entity: Record<string, unknown>) =>
      Buffer.from(JSON.stringify({ event, payload: { payment: { entity } } }));
    const signBody = (b: Buffer) =>
      createHmac('sha256', 'whsec_test').update(b).digest('hex');

    it('confirms the booking on payment.captured', async () => {
      const b = body('payment.captured', { id: 'pay_x', order_id: 'order_123', method: 'upi' });
      prisma.payment.findUnique.mockResolvedValue(payment);
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.payment.update.mockResolvedValue(payment);
      prisma.booking.update.mockResolvedValue(booking);
      prisma.booking.findUniqueOrThrow
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce({ ...booking, tickets: [] });

      const result = await service.handleWebhook(b, signBody(b));

      expect(result).toEqual({ received: true, handled: true });
      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: bookingId },
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      });
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ method: 'upi' }),
        }),
      );
    });

    it('marks the payment failed on payment.failed', async () => {
      const b = body('payment.failed', {
        id: 'pay_x',
        order_id: 'order_123',
        error_description: 'Insufficient funds',
      });
      prisma.payment.findUnique.mockResolvedValue(payment);
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));

      const result = await service.handleWebhook(b, signBody(b));

      expect(result).toEqual({ received: true, handled: true });
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-row-1' },
        data: expect.objectContaining({ status: 'FAILED', failureReason: 'Insufficient funds' }),
      });
    });

    it('rejects an invalid webhook signature', async () => {
      const b = body('payment.captured', { id: 'pay_x', order_id: 'order_123' });

      await expect(service.handleWebhook(b, 'bad-signature')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    });

    it('is idempotent for duplicate captured webhooks', async () => {
      const b = body('payment.captured', { id: 'pay_x', order_id: 'order_123' });
      prisma.payment.findUnique.mockResolvedValue({ ...payment, status: 'CAPTURED' });

      const result = await service.handleWebhook(b, signBody(b));

      expect(result).toEqual({ received: true, handled: false });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('ignores captured events for orders it does not know', async () => {
      const b = body('payment.captured', { id: 'pay_x', order_id: 'order_unknown' });
      prisma.payment.findUnique.mockResolvedValue(null);

      const result = await service.handleWebhook(b, signBody(b));

      expect(result).toEqual({ received: true, handled: false });
    });
  });

  describe('refundBooking', () => {
    const paidPayment = {
      id: 'pay-row-1',
      bookingId,
      userId,
      status: 'CAPTURED',
      razorpayPaymentId: 'pay_abc',
      booking: { ...booking, status: 'CONFIRMED' },
    };

    it('refunds via Razorpay and closes the booking with tickets cancelled', async () => {
      prisma.payment.findUnique.mockResolvedValue(paidPayment);
      refundsCreate.mockResolvedValue({ id: 'rfnd_1', amount: 300000, status: 'processed' });
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.payment.findUnique.mockResolvedValueOnce(paidPayment); // load
      prisma.payment.findUnique.mockResolvedValueOnce({ status: 'CAPTURED' }); // tx re-check
      prisma.payment.update.mockResolvedValue(paidPayment);
      prisma.booking.update.mockResolvedValue({ ...booking, status: 'REFUNDED' });
      prisma.ticket.updateMany.mockResolvedValue({ count: 2 });
      prisma.booking.findUniqueOrThrow.mockResolvedValue({
        ...booking,
        status: 'REFUNDED',
        tickets: [],
      });

      const result = await service.refundBooking(userId, bookingId, 'changed plans');

      expect(refundsCreate).toHaveBeenCalledWith(
        'pay_abc',
        expect.objectContaining({ speed: 'normal' }),
      );
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-row-1' },
        data: expect.objectContaining({ status: 'REFUNDED', refundId: 'rfnd_1' }),
      });
      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: bookingId },
        data: expect.objectContaining({ status: 'REFUNDED' }),
      });
      expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
        where: { bookingId, status: 'VALID' },
        data: { status: 'CANCELLED' },
      });
      expect(prisma.ticketType.updateMany).toHaveBeenCalledWith({
        where: { id: 'tt-1' },
        data: { availableQuantity: { increment: 2 } },
      });
      expect(result.refundId).toBe('rfnd_1');
      expect(result.booking.status).toBe('REFUNDED');
      expect(sendRefundConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'ada@example.com',
          eventTitle: 'Summer Gig',
          bookingId,
          refundId: 'rfnd_1',
          refundAmount: 300000,
        }),
      );
    });

    it('refuses to refund an unpaid booking', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...paidPayment,
        status: 'CREATED',
        razorpayPaymentId: null,
        booking: { ...booking, status: 'PAYMENT_PENDING' },
      });

      await expect(service.refundBooking(userId, bookingId)).rejects.toThrow(ConflictException);
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('refuses a second refund', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...paidPayment,
        booking: { ...booking, status: 'REFUNDED' },
      });

      await expect(service.refundBooking(userId, bookingId)).rejects.toThrow(/already refunded/i);
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('hides other users’ bookings', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...paidPayment,
        booking: { ...booking, userId: 'someone-else' },
      });

      await expect(service.refundBooking('intruder', bookingId)).rejects.toThrow(NotFoundException);
      expect(refundsCreate).not.toHaveBeenCalled();
    });
  });

  describe('getTicketQrDataUrl', () => {
    it('returns a PNG data URL for an own ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        qrData: JSON.stringify({ code: 'TKT-1' }),
        userId,
        status: 'VALID',
      });

      const dataUrl = await service.getTicketQrDataUrl(userId, 'ticket-1');

      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it('hides other users’ tickets', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        qrData: 'x',
        userId: 'someone-else',
        status: 'VALID',
      });

      await expect(service.getTicketQrDataUrl(userId, 'ticket-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
