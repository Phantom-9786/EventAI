import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '../../common/exceptions';
import { Test } from '../../common/testing';
import { createHmac } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: {
    booking: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock; findUniqueOrThrow: jest.Mock };
    payment: { findUnique: jest.Mock; findFirst: jest.Mock; create: jest.Mock; update: jest.Mock; updateMany: jest.Mock; count: jest.Mock; findMany: jest.Mock };
    ticket: { count: jest.Mock; create: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock };
    ticketType: { updateMany: jest.Mock };
    auditLog: { create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let ordersCreate: jest.Mock;
  let refundsCreate: jest.Mock;
  let refundsFetch: jest.Mock;
  let refundsList: jest.Mock;
  let paymentsFetch: jest.Mock;
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
      booking: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
      payment: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn(), findMany: jest.fn() },
      ticket: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      ticketType: { updateMany: jest.fn() },
      auditLog: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    prisma.booking.findUnique.mockResolvedValue({
      status: 'PENDING',
      userId,
      event: { status: 'PUBLISHED' },
    });
    prisma.booking.updateMany.mockResolvedValue({ count: 1 });
    ordersCreate = jest.fn();
    refundsCreate = jest.fn();
    refundsFetch = jest.fn();
    refundsList = jest.fn();
    paymentsFetch = jest.fn();
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
            createInAppNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(PaymentsService);
    // Inject a stubbed Razorpay client
    (service as unknown as { razorpayClient: unknown }).razorpayClient = {
      orders: { create: ordersCreate },
      payments: {
        refund: refundsCreate,
        fetchRefund: refundsFetch,
        fetchMultipleRefund: refundsList,
        fetch: paymentsFetch,
      },
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
        mode: 'test',
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

    it('throws ServiceUnavailableException with actionable message when Razorpay auth fails', async () => {
      prisma.booking.findUnique.mockResolvedValue(booking);
      prisma.payment.findUnique.mockResolvedValue(null);
      const authErr = new Error('Authentication failed');
      (authErr as any).statusCode = 401;
      ordersCreate.mockRejectedValue(authErr);

      await expect(service.createOrder(userId, bookingId)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('verifyPayment', () => {
    const sign = (payload: string) =>
      createHmac('sha256', keySecret).update(payload).digest('hex');

    it('throws ConflictException when payment amount does not match booking amount', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...payment,
        amount: 200000,
        booking: { ...booking, totalAmount: 300000 },
      });

      await expect(
        service.verifyPayment(userId, {
          bookingId,
          razorpayOrderId: 'order_123',
          razorpayPaymentId: 'pay_abc',
          razorpaySignature: sign('order_123|pay_abc'),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('confirms the booking and mints tickets on a valid signature', async () => {
      prisma.payment.findUnique.mockResolvedValue(payment);
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.booking.updateMany.mockResolvedValue({ count: 1 });
      prisma.booking.findUniqueOrThrow
        .mockResolvedValueOnce({ ...booking, status: 'CONFIRMED' }) // load for minting
        .mockResolvedValueOnce({ ...booking, status: 'CONFIRMED', tickets: [] }); // final return

      const { booking: confirmed } = await service.verifyPayment(userId, {
        bookingId,
        razorpayOrderId: 'order_123',
        razorpayPaymentId: 'pay_abc',
        razorpaySignature: sign('order_123|pay_abc'),
      });

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'pay-row-1', status: { in: ['CREATED', 'PENDING'] } },
        data: expect.objectContaining({ status: 'CAPTURED' }),
      });
      expect(prisma.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          id: bookingId,
          status: { in: ['PENDING', 'PAYMENT_PENDING'] },
          event: { status: 'PUBLISHED' },
        }),
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      }));
      // quantity 2 → two tickets with holder "Ada Lovelace"
      expect(prisma.ticket.create).toHaveBeenCalledTimes(2);
      expect(prisma.ticket.create.mock.calls[0][0].data.holderName).toBe('Ada Lovelace');
      expect(confirmed.status).toBe('CONFIRMED');
    });

    it('does not mint tickets when another callback already claimed capture', async () => {
      prisma.payment.findUnique.mockResolvedValue(payment);
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.verifyPayment(userId, {
        bookingId,
        razorpayOrderId: 'order_123',
        razorpayPaymentId: 'pay_abc',
        razorpaySignature: sign('order_123|pay_abc'),
      })).rejects.toThrow(/already processed/i);
      expect(prisma.ticket.create).not.toHaveBeenCalled();
    });

    it('records a late capture for organizer refund approval without confirming or issuing tickets', async () => {
      prisma.payment.findUnique.mockResolvedValue(payment);
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.booking.findUnique.mockResolvedValue({
        status: 'CANCELLED',
        userId,
        event: { status: 'PUBLISHED' },
      });
      prisma.payment.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 1 });
      prisma.booking.updateMany.mockResolvedValue({ count: 0 });
      prisma.booking.findUniqueOrThrow.mockResolvedValue({
        ...booking,
        status: 'CANCELLED',
        tickets: [],
      });

      const { booking: captured } = await service.verifyPayment(userId, {
        bookingId,
        razorpayOrderId: 'order_123',
        razorpayPaymentId: 'pay_late',
        razorpaySignature: sign('order_123|pay_late'),
      });

      expect(captured.status).toBe('CANCELLED');
      expect(prisma.payment.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          refundRequestStatus: 'PENDING',
          refundRequestReason: expect.stringContaining('captured after'),
        }),
      }));
      expect(prisma.ticket.create).not.toHaveBeenCalled();
      expect(sendRefundConfirmation).not.toHaveBeenCalled();
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

    it('rejects a callback whose order id matches no payment row', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyPayment(userId, {
          bookingId,
          razorpayOrderId: 'order_UNKNOWN',
          razorpayPaymentId: 'pay_abc',
          razorpaySignature: sign('order_UNKNOWN|pay_abc'),
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a callback whose bookingId does not match the order booking', async () => {
      prisma.payment.findUnique.mockResolvedValue(payment);

      await expect(
        service.verifyPayment(userId, {
          bookingId: 'bc99562e-2a31-4b8a-9f17-37ef3d5f34a0', // different booking
          razorpayOrderId: 'order_123',
          razorpayPaymentId: 'pay_abc',
          razorpaySignature: sign('order_123|pay_abc'),
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
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
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.booking.update.mockResolvedValue(booking);
      prisma.booking.findUniqueOrThrow
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce({ ...booking, tickets: [] });

      const result = await service.handleWebhook(b, signBody(b));

      expect(result).toEqual({ received: true, handled: true });
      expect(prisma.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: bookingId, event: { status: 'PUBLISHED' } }),
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      }));
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ method: 'upi' }) }),
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

    it('accepts only a verified refund webhook for the current pending attempt', async () => {
      const refund = {
        id: 'rfnd_1', payment_id: 'pay_abc', amount: 300000, status: 'processed',
        notes: { eventaiRefundAttempt: 'current-attempt' },
      };
      const b = Buffer.from(JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: refund } } }));
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-row-1', bookingId, amount: 300000, status: 'REFUND_PENDING', refundId: null,
        refundAttemptKey: 'current-attempt',
        booking: { ...booking, status: 'CONFIRMED' },
      });
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.booking.updateMany.mockResolvedValue({ count: 1 });
      prisma.ticket.updateMany.mockResolvedValue({ count: 2 });
      prisma.booking.findUniqueOrThrow.mockResolvedValue({ ...booking, status: 'REFUNDED', tickets: [] });

      const result = await service.handleWebhook(b, signBody(b));
      expect(result).toEqual({ received: true, handled: true });
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ refundAttemptKey: 'current-attempt' }),
      }));
    });

    it('ignores a correctly signed stale refund webhook for an older attempt', async () => {
      const refund = {
        id: 'rfnd_old', payment_id: 'pay_abc', amount: 300000, status: 'failed',
        notes: { eventaiRefundAttempt: 'old-attempt' },
      };
      const b = Buffer.from(JSON.stringify({ event: 'refund.failed', payload: { refund: { entity: refund } } }));
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-row-1', status: 'REFUND_PENDING', refundId: null,
        refundAttemptKey: 'current-attempt',
      });

      const result = await service.handleWebhook(b, signBody(b));
      expect(result).toEqual({ received: true, handled: false });
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('refund requests and approval', () => {
    const paidPayment = {
      id: 'pay-row-1',
      bookingId,
      userId,
      status: 'CAPTURED',
      amount: 300000,
      refundId: null,
      refundRequestStatus: null,
      razorpayPaymentId: 'pay_abc',
      booking: {
        ...booking,
        status: 'CONFIRMED',
        event: { ...booking.event, organizerId: 'organizer-1' },
      },
    };

    it('records an attendee request without calling Razorpay', async () => {
      prisma.payment.findUnique.mockResolvedValue(paidPayment);
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.requestRefund(userId, bookingId, 'changed plans');

      expect(result.refundRequest).toMatchObject({
        bookingId,
        status: 'PENDING',
        reason: 'changed plans',
      });
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'pay-row-1', status: 'CAPTURED' }),
        data: expect.objectContaining({ refundRequestStatus: 'PENDING' }),
      }));
      expect(refundsCreate).not.toHaveBeenCalled();
      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
    });

    it('initiates the refund only after the event organizer approves', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...paidPayment,
        refundRequestStatus: 'PENDING',
        refundRequestReason: 'changed plans',
      });
      refundsCreate.mockResolvedValue({ id: 'rfnd_1', amount: 300000, status: 'processed' });
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.booking.updateMany.mockResolvedValue({ count: 1 });
      prisma.ticket.updateMany.mockResolvedValue({ count: 2 });
      prisma.booking.findUniqueOrThrow.mockResolvedValue({
        ...booking,
        status: 'REFUNDED',
        tickets: [],
      });

      const result = await service.approveRefundRequest('organizer-1', 'organizer-user-1', bookingId);

      expect(refundsCreate).toHaveBeenCalledWith('pay_abc', expect.objectContaining({
        speed: 'normal',
        notes: expect.objectContaining({ bookingId, reason: 'changed plans' }),
      }));
      expect(prisma.payment.updateMany.mock.invocationCallOrder[0])
        .toBeLessThan(refundsCreate.mock.invocationCallOrder[0]);
      expect(prisma.payment.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          id: 'pay-row-1',
          status: 'REFUND_PENDING',
          refundId: 'rfnd_1',
        }),
        data: { status: 'REFUNDED', refundAmount: 300000 },
      }));
      expect(prisma.booking.updateMany).toHaveBeenCalledWith({
        where: { id: bookingId, status: { in: ['CONFIRMED', 'CANCELLED', 'EXPIRED'] } },
        data: expect.objectContaining({ status: 'REFUNDED' }),
      });
      expect(prisma.ticketType.updateMany).toHaveBeenCalledWith({
        where: { id: 'tt-1' },
        data: { availableQuantity: { increment: 2 } },
      });
      expect(result.refundId).toBe('rfnd_1');
      expect(sendRefundConfirmation).toHaveBeenCalled();
    });

    it('does not call Razorpay when another organizer already claimed approval', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...paidPayment,
        refundRequestStatus: 'PENDING',
      });
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.approveRefundRequest('organizer-1', 'organizer-user-1', bookingId))
        .rejects.toThrow(/already reviewed or processed/i);
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('does not approve a request when local Razorpay configuration is missing', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...paidPayment,
        refundRequestStatus: 'PENDING',
      });
      const previousKeyId = process.env.RAZORPAY_KEY_ID;
      const previousKeySecret = process.env.RAZORPAY_KEY_SECRET;
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
      try {
        await expect(service.approveRefundRequest('organizer-1', 'organizer-user-1', bookingId))
          .rejects.toThrow(/not configured/i);
      } finally {
        process.env.RAZORPAY_KEY_ID = previousKeyId;
        process.env.RAZORPAY_KEY_SECRET = previousKeySecret;
      }
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('keeps an ambiguous approved refund pending to prevent a duplicate provider request', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...paidPayment,
        refundRequestStatus: 'PENDING',
      });
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      refundsCreate.mockRejectedValue({ statusCode: 500 });

      await expect(service.approveRefundRequest('organizer-1', 'organizer-user-1', bookingId))
        .rejects.toThrow(/pending provider reconciliation/i);
      expect(prisma.payment.updateMany).toHaveBeenCalledTimes(1);
    });

    it('keeps an approved provider-pending response pending and stores its refund ID', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...paidPayment,
        refundRequestStatus: 'PENDING',
      });
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      refundsCreate.mockResolvedValue({ id: 'rfnd_wait', amount: 300000, status: 'pending' });

      const result = await service.approveRefundRequest('organizer-1', 'organizer-user-1', bookingId);

      expect(result).toMatchObject({
        refundId: 'rfnd_wait',
        refundStatus: 'pending',
        reconciliationRequired: true,
      });
      expect(prisma.payment.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'pay-row-1', status: 'REFUND_PENDING', refundId: null, refundAttemptKey: expect.any(String) },
        data: { refundId: 'rfnd_wait' },
      });
      expect(prisma.ticketType.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to request a refund for an unpaid booking', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...paidPayment,
        status: 'CREATED',
        razorpayPaymentId: null,
        booking: { ...paidPayment.booking, status: 'PAYMENT_PENDING' },
      });

      await expect(service.requestRefund(userId, bookingId)).rejects.toThrow(ConflictException);
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('refuses a request for an already-refunded booking', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...paidPayment,
        booking: { ...paidPayment.booking, status: 'REFUNDED' },
      });

      await expect(service.requestRefund(userId, bookingId)).rejects.toThrow(/already refunded/i);
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('hides other users’ bookings', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...paidPayment,
        booking: { ...paidPayment.booking, userId: 'someone-else' },
      });

      await expect(service.requestRefund('intruder', bookingId)).rejects.toThrow(NotFoundException);
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('hides another organizer’s refund request', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...paidPayment,
        refundRequestStatus: 'PENDING',
        booking: {
          ...paidPayment.booking,
          event: { ...paidPayment.booking.event, organizerId: 'different-organizer' },
        },
      });

      await expect(service.approveRefundRequest('organizer-1', 'organizer-user-1', bookingId))
        .rejects.toThrow(NotFoundException);
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('rejects a request without calling Razorpay', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...paidPayment,
        refundRequestStatus: 'PENDING',
      });
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.rejectRefundRequest('organizer-1', 'organizer-user-1', bookingId);

      expect(result.status).toBe('REJECTED');
      expect(refundsCreate).not.toHaveBeenCalled();
    });
  });

  describe('reconcileRefund', () => {
    const pendingPayment = {
      id: 'pay-row-1',
      bookingId,
      userId,
      status: 'REFUND_PENDING',
      amount: 300000,
      refundId: null,
      refundAttemptKey: 'attempt-current',
      razorpayPaymentId: 'pay_abc',
      booking: { ...booking, status: 'CONFIRMED' },
    };
    const providerRefund = {
      id: 'rfnd_1', payment_id: 'pay_abc', amount: 300000,
      status: 'processed', notes: { bookingId, eventaiRefundAttempt: 'attempt-current' },
    };

    beforeEach(() => {
      prisma.payment.findUnique.mockResolvedValue(pendingPayment);
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      paymentsFetch.mockResolvedValue({ id: 'pay_abc', status: 'captured', amount: 300000, currency: 'INR', amount_refunded: 0 });
      refundsList.mockResolvedValue({ items: [providerRefund] });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.booking.updateMany.mockResolvedValue({ count: 1 });
      prisma.ticket.updateMany.mockResolvedValue({ count: 2 });
      prisma.booking.findUniqueOrThrow.mockResolvedValue({ ...booking, status: 'REFUNDED', tickets: [] });
    });

    it('applies an authoritative processed status once and restores inventory', async () => {
      const result = await service.reconcileRefund('admin-1', bookingId);
      expect(result).toMatchObject({ bookingId, status: 'REFUNDED', outcome: 'processed', refundId: 'rfnd_1' });
      expect(prisma.booking.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.ticket.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.ticketType.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: 'REFUND_COMPLETED', userId: 'admin-1' }),
      }));
    });

    it('restores retryable payment state only for provider-confirmed failure', async () => {
      refundsList.mockResolvedValue({ items: [{ ...providerRefund, status: 'failed' }] });
      const result = await service.reconcileRefund('admin-1', bookingId);
      expect(result).toMatchObject({ bookingId, status: 'CAPTURED', outcome: 'failed' });
      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
      expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
      expect(prisma.payment.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'pay-row-1', status: 'REFUND_PENDING', refundId: 'rfnd_1', refundAttemptKey: 'attempt-current' },
        data: { status: 'CAPTURED', refundRequestStatus: 'FAILED' },
      });
    });

    it('retains pending state when the provider has no correlated refund', async () => {
      refundsList.mockResolvedValue({ count: 0, items: [] });
      const result = await service.reconcileRefund('admin-1', bookingId);
      expect(result).toMatchObject({ bookingId, status: 'REFUND_PENDING', outcome: 'no_provider_refund' });
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
    });

    it('retains pending state when the fetched refund ID differs from the locally recorded ID', async () => {
      prisma.payment.findUnique.mockResolvedValue({ ...pendingPayment, refundId: 'rfnd_expected' });
      refundsFetch.mockResolvedValue({ ...providerRefund, id: 'rfnd_other' });

      const result = await service.reconcileRefund('admin-1', bookingId);

      expect(refundsFetch).toHaveBeenCalledWith('pay_abc', 'rfnd_expected');
      expect(result).toMatchObject({ status: 'REFUND_PENDING', outcome: 'unknown' });
      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
      expect(prisma.ticketType.updateMany).not.toHaveBeenCalled();
    });

    it('does not process duplicate reconciliation after the payment is terminal', async () => {
      prisma.payment.findUnique.mockResolvedValue({ ...pendingPayment, status: 'REFUNDED', refundId: 'rfnd_1' });
      const result = await service.reconcileRefund('admin-1', bookingId);
      expect(result).toMatchObject({ status: 'REFUNDED', outcome: 'not_pending' });
      expect(refundsList).not.toHaveBeenCalled();
      expect(prisma.ticketType.updateMany).not.toHaveBeenCalled();
    });

    it('allows only one concurrent reconciliation to finalize and restore stock', async () => {
      prisma.payment.findUnique.mockResolvedValue(pendingPayment);
      prisma.payment.updateMany
        .mockResolvedValueOnce({ count: 1 }) // bind the provider refund ID
        .mockResolvedValueOnce({ count: 0 }); // competing reconciler loses the bind
      const results = await Promise.all([
        service.reconcileRefund('admin-1', bookingId),
        service.reconcileRefund('admin-2', bookingId),
      ]);
      expect(results.filter((result) => result.outcome === 'processed')).toHaveLength(1);
      expect(prisma.booking.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.ticketType.updateMany).toHaveBeenCalledTimes(1);
    });

    it('returns provider_pending when provider reports pending settlement status', async () => {
      refundsList.mockResolvedValue({ items: [{ ...providerRefund, status: 'pending' }] });
      const result = await service.reconcileRefund('admin-1', bookingId);
      expect(result).toMatchObject({
        bookingId,
        status: 'REFUND_PENDING',
        outcome: 'provider_pending',
      });
      expect(result.message).toContain('in progress');
      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
    });

    it('returns provider_error when provider rejects authentication (HTTP 401/403)', async () => {
      refundsList.mockRejectedValue({ statusCode: 401, error: { description: 'Authentication failed' } });
      const result = await service.reconcileRefund('admin-1', bookingId);
      expect(result).toMatchObject({
        bookingId,
        status: 'REFUND_PENDING',
        outcome: 'provider_error',
      });
      expect(result.message).toContain('authentication failed');
      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
    });

    it('returns provider_unavailable when provider returns 5xx or network failure', async () => {
      refundsList.mockRejectedValue({ statusCode: 503, message: 'Service Unavailable' });
      const result = await service.reconcileRefund('admin-1', bookingId);
      expect(result).toMatchObject({
        bookingId,
        status: 'REFUND_PENDING',
        outcome: 'provider_unavailable',
      });
      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
    });

    it('returns missing_configuration when keys are not configured in environment', async () => {
      const savedKey = process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_ID;
      try {
        const result = await service.reconcileRefund('admin-1', bookingId);
        expect(result).toMatchObject({
          bookingId,
          status: 'REFUND_PENDING',
          outcome: 'missing_configuration',
        });
      } finally {
        process.env.RAZORPAY_KEY_ID = savedKey;
      }
    });
  });

  describe('listOrganizerRefundRequests', () => {
    it('returns filtered refund requests with real status counts and pagination', async () => {
      prisma.payment.count
        .mockResolvedValueOnce(3) // PENDING
        .mockResolvedValueOnce(2) // APPROVED
        .mockResolvedValueOnce(5) // REFUNDED
        .mockResolvedValueOnce(1) // REJECTED
        .mockResolvedValueOnce(0) // FAILED
        .mockResolvedValueOnce(11) // ALL
        .mockResolvedValueOnce(3); // total for query

      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'pay-1',
          bookingId: 'bk-1',
          amount: 50000,
          status: 'REFUND_PENDING',
          refundRequestStatus: 'APPROVED',
          refundId: 'rfnd_1',
          booking: {
            id: 'bk-1',
            status: 'REFUND_PENDING',
            user: { id: 'usr-1', firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
            event: { id: 'ev-1', title: 'Tech Expo', slug: 'tech-expo' },
            items: [{ quantity: 1, ticketType: { name: 'VIP' } }],
          },
        },
      ]);

      const result = await service.listOrganizerRefundRequests('org-1', 'APPROVED', 1, 10);
      expect(result.counts).toEqual({
        PENDING: 3,
        APPROVED: 2,
        REFUNDED: 5,
        REJECTED: 1,
        FAILED: 0,
        ALL: 11,
      });
      expect(result.total).toBe(3);
      expect(result.refundRequests).toHaveLength(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('queries all refund requests when status is ALL', async () => {
      prisma.payment.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(3);

      prisma.payment.findMany.mockResolvedValue([]);

      const result = await service.listOrganizerRefundRequests('org-1', 'ALL', 1, 20);
      expect(result.counts.ALL).toBe(3);
      expect(result.total).toBe(3);
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            booking: { event: { organizerId: 'org-1' } },
            OR: expect.any(Array),
          }),
        }),
      );
    });
  });

  describe('reconcileOrganizerRefund', () => {
    const orgPendingPayment = {
      ...payment,
      status: 'REFUND_PENDING',
      refundId: null,
      refundAttemptKey: 'attempt-org',
      razorpayPaymentId: 'pay_abc',
    };

    it('validates organizer ownership and delegates to reconcileRefund', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...orgPendingPayment,
        booking: {
          ...booking,
          event: { id: 'ev-1', title: 'Concert', organizerId: 'organizer-1', status: 'PUBLISHED' },
        },
      });
      refundsList.mockResolvedValue({
        items: [
          {
            id: 'rfnd_1',
            payment_id: 'pay_abc',
            amount: 300000,
            status: 'processed',
            notes: { eventaiRefundAttempt: 'attempt-org' },
          },
        ],
      });
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.booking.updateMany.mockResolvedValue({ count: 1 });
      prisma.ticketType.updateMany.mockResolvedValue({ count: 1 });
      prisma.booking.findUniqueOrThrow.mockResolvedValue({ ...booking, status: 'REFUNDED', tickets: [] });

      const result = await service.reconcileOrganizerRefund('organizer-1', 'user-1', bookingId);
      expect(result.bookingId).toBe(bookingId);
      expect(result.outcome).toBe('processed');
    });

    it('rejects reconciliation if payment does not belong to the organizer', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...orgPendingPayment,
        booking: {
          ...booking,
          event: { id: 'ev-1', title: 'Concert', organizerId: 'different-org', status: 'PUBLISHED' },
        },
      });

      await expect(
        service.reconcileOrganizerRefund('organizer-1', 'user-1', bookingId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('recoverApprovedRefund', () => {
    const recoverablePayment = {
      id: 'pay-row-1',
      bookingId,
      userId,
      status: 'REFUND_PENDING',
      refundRequestStatus: 'APPROVED',
      amount: 300000,
      currency: 'INR',
      refundId: null,
      refundAttemptKey: 'attempt-key-1',
      razorpayPaymentId: 'pay_captured_1',
      refundRequestReason: 'Event rescheduled',
      booking: { ...booking, status: 'CONFIRMED' },
    };

    const providerCapturedPayment = {
      id: 'pay_captured_1',
      status: 'captured',
      amount: 300000,
      currency: 'INR',
      amount_refunded: 0,
      refund_status: null,
    };

    const definitiveFailureAuditLog = {
      id: 'audit-1',
      action: 'REFUND_RECONCILIATION_REQUIRED',
      entity: 'PAYMENT',
      entityId: 'pay-row-1',
      details: {
        bookingId,
        providerStatusCode: 401,
        outcome: 'unknown',
      },
      createdAt: new Date(),
    };

    beforeEach(() => {
      prisma.payment.findUnique.mockResolvedValue(recoverablePayment);
      prisma.auditLog.findMany.mockResolvedValue([definitiveFailureAuditLog]);
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      paymentsFetch.mockResolvedValue(providerCapturedPayment);
      refundsList.mockResolvedValue({ count: 0, items: [] });
      refundsCreate.mockResolvedValue({ id: 'rfnd_new_1', amount: 300000, status: 'processed' });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.booking.updateMany.mockResolvedValue({ count: 1 });
      prisma.ticket.updateMany.mockResolvedValue({ count: 2 });
      prisma.booking.findUniqueOrThrow.mockResolvedValue({ ...booking, status: 'REFUNDED', tickets: [] });
    });

    it('safely recovers an approved refund when provider has zero refunds and audit shows definitive 401 failure', async () => {
      const result = await service.recoverApprovedRefund('admin-1', bookingId);

      expect(paymentsFetch).toHaveBeenCalledWith('pay_captured_1');
      expect(refundsList).toHaveBeenCalledWith('pay_captured_1', { count: 100 });
      expect(refundsCreate).toHaveBeenCalledWith('pay_captured_1', {
        speed: 'normal',
        notes: {
          bookingId,
          eventaiRefundAttempt: 'attempt-key-1',
          reason: 'Event rescheduled',
        },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'REFUND_RECOVERY_STARTED',
            entityId: 'pay-row-1',
          }),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'REFUND_COMPLETED',
            entityId: 'pay-row-1',
          }),
        }),
      );
      expect(prisma.ticketType.updateMany).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        refundId: 'rfnd_new_1',
        refundAmount: 300000,
        refundStatus: 'processed',
        outcome: 'recovered',
      });
    });

    it('throws ConflictException on stale or already terminal state (REFUNDED)', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...recoverablePayment,
        status: 'REFUNDED',
      });

      await expect(service.recoverApprovedRefund('admin-1', bookingId)).rejects.toThrow(
        ConflictException,
      );
      expect(paymentsFetch).not.toHaveBeenCalled();
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('throws ConflictException if payment already has a refundId (reconciliation required)', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...recoverablePayment,
        refundId: 'rfnd_existing_1',
      });

      await expect(service.recoverApprovedRefund('admin-1', bookingId)).rejects.toThrow(
        ConflictException,
      );
      expect(paymentsFetch).not.toHaveBeenCalled();
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('throws ConflictException if refundRequestStatus is not APPROVED', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...recoverablePayment,
        refundRequestStatus: 'PENDING',
      });

      await expect(service.recoverApprovedRefund('admin-1', bookingId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('returns ambiguous_provider_state when previous failure was ambiguous and within 10-minute cooldown', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'audit-2',
          action: 'REFUND_RECONCILIATION_REQUIRED',
          entity: 'PAYMENT',
          entityId: 'pay-row-1',
          details: { bookingId, outcome: 'unknown' }, // no 4xx providerStatusCode
          createdAt: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
        },
      ]);

      const result = await service.recoverApprovedRefund('admin-1', bookingId);

      expect(result).toMatchObject({
        bookingId,
        status: 'REFUND_PENDING',
        outcome: 'ambiguous_provider_state',
      });
      expect(paymentsFetch).not.toHaveBeenCalled();
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('allows recovery after ambiguous failure once 10-minute cooldown has elapsed', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'audit-2',
          action: 'REFUND_RECONCILIATION_REQUIRED',
          entity: 'PAYMENT',
          entityId: 'pay-row-1',
          details: { bookingId, outcome: 'unknown' },
          createdAt: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago (> 10 min)
        },
      ]);

      const result = await service.recoverApprovedRefund('admin-1', bookingId);

      expect(result).toMatchObject({
        refundId: 'rfnd_new_1',
        outcome: 'recovered',
      });
      expect(refundsCreate).toHaveBeenCalledTimes(1);
    });

    it('returns provider_error when provider rejects authentication (HTTP 401/403) on pre-check', async () => {
      paymentsFetch.mockRejectedValue({ statusCode: 401, error: { description: 'Authentication failed' } });

      const result = await service.recoverApprovedRefund('admin-1', bookingId);

      expect(result).toMatchObject({
        bookingId,
        status: 'REFUND_PENDING',
        outcome: 'provider_error',
      });
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('returns provider_unavailable when provider returns 5xx on pre-check', async () => {
      paymentsFetch.mockRejectedValue({ statusCode: 503, message: 'Service Unavailable' });

      const result = await service.recoverApprovedRefund('admin-1', bookingId);

      expect(result).toMatchObject({
        bookingId,
        status: 'REFUND_PENDING',
        outcome: 'provider_unavailable',
      });
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('ensures only one of two simultaneous recovery requests can initiate a refund', async () => {
      let claimTaken = false;
      prisma.payment.updateMany.mockImplementation(async (args) => {
        if (args?.data?.refundAttemptKey && String(args.data.refundAttemptKey).includes(':claim:')) {
          if (!claimTaken) {
            claimTaken = true;
            return { count: 1 };
          }
          return { count: 0 };
        }
        return { count: 1 };
      });

      const [res1, res2] = await Promise.allSettled([
        service.recoverApprovedRefund('admin-1', bookingId),
        service.recoverApprovedRefund('admin-2', bookingId),
      ]);

      expect(res1.status).toBe('fulfilled');
      expect(res2.status).toBe('rejected');
      if (res2.status === 'rejected') {
        expect(res2.reason).toBeInstanceOf(ConflictException);
      }
      expect(refundsCreate).toHaveBeenCalledTimes(1);
    });

    it('ensures only one winner between concurrent organizer and admin recovery attempts', async () => {
      const orgPayment = {
        ...recoverablePayment,
        booking: {
          ...booking,
          status: 'CONFIRMED',
          event: { id: 'ev-1', title: 'Concert', organizerId: 'organizer-1', status: 'PUBLISHED' },
        },
      };
      prisma.payment.findUnique.mockResolvedValue(orgPayment);
      let claimTaken = false;
      prisma.payment.updateMany.mockImplementation(async (args) => {
        if (args?.data?.refundAttemptKey && String(args.data.refundAttemptKey).includes(':claim:')) {
          if (!claimTaken) {
            claimTaken = true;
            return { count: 1 };
          }
          return { count: 0 };
        }
        return { count: 1 };
      });

      const [orgResult, adminResult] = await Promise.allSettled([
        service.recoverOrganizerRefund('organizer-1', 'user-1', bookingId),
        service.recoverApprovedRefund('admin-1', bookingId),
      ]);

      const statuses = [orgResult.status, adminResult.status].sort();
      expect(statuses).toEqual(['fulfilled', 'rejected']);
      const rejected = orgResult.status === 'rejected' ? orgResult : adminResult;
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      expect(refundsCreate).toHaveBeenCalledTimes(1);
    });


    it('blocks subsequent request when an active non-stale claim is already in progress, failing closed', async () => {
      const recentTimestamp = Date.now() - 30 * 1000; // 30 seconds ago (< 5 min timeout)
      prisma.payment.findUnique.mockResolvedValue({
        ...recoverablePayment,
        refundAttemptKey: `attempt-key-1:claim:token123:${recentTimestamp}`,
      });

      await expect(service.recoverApprovedRefund('admin-1', bookingId)).rejects.toThrow(
        ConflictException,
      );
      expect(paymentsFetch).not.toHaveBeenCalled();
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('fails closed on a stale claim (>5 min) and requires provider reconciliation instead of blind takeover', async () => {
      const staleTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago (> 5 min timeout)
      prisma.payment.findUnique.mockResolvedValue({
        ...recoverablePayment,
        refundAttemptKey: `attempt-key-1:claim:deadToken:${staleTimestamp}`,
      });

      // Must fail closed, never take over or call Razorpay payments.refund
      await expect(service.recoverApprovedRefund('admin-1', bookingId)).rejects.toThrow(
        ConflictException,
      );
      expect(paymentsFetch).not.toHaveBeenCalled();
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('handles delayed provider request overlapping with stale claim via reconcileRefund without duplicate refund', async () => {
      const staleTimestamp = Date.now() - 8 * 60 * 1000;
      const delayedRefund = {
        id: 'rfnd_delayed_win',
        payment_id: 'pay_captured_1',
        amount: 300000,
        status: 'processed',
        notes: { bookingId, eventaiRefundAttempt: 'attempt-key-1' },
      };
      prisma.payment.findUnique.mockResolvedValue({
        ...recoverablePayment,
        refundAttemptKey: `attempt-key-1:claim:deadToken:${staleTimestamp}`,
      });
      paymentsFetch.mockResolvedValue({
        id: 'pay_captured_1',
        status: 'captured',
        amount: 300000,
        currency: 'INR',
        amount_refunded: 300000,
      });
      refundsList.mockResolvedValue({ count: 1, items: [delayedRefund] });

      const result = await service.reconcileRefund('admin-1', bookingId);

      expect(refundsCreate).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        bookingId,
        refundId: 'rfnd_delayed_win',
        status: 'REFUNDED',
        outcome: 'processed',
      });
      expect(prisma.booking.updateMany).toHaveBeenCalledTimes(1);
    });

    it('handles process interruption after claim is acquired: reconcileRefund clears stale claim only after verifying 0 refunds at provider', async () => {
      const staleTimestamp = Date.now() - 10 * 60 * 1000;
      prisma.payment.findUnique.mockResolvedValue({
        ...recoverablePayment,
        refundAttemptKey: `attempt-key-1:claim:deadToken:${staleTimestamp}`,
      });
      paymentsFetch.mockResolvedValue({
        id: 'pay_captured_1',
        status: 'captured',
        amount: 300000,
        currency: 'INR',
        amount_refunded: 0,
      });
      refundsList.mockResolvedValue({ count: 0, items: [] });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.reconcileRefund('admin-1', bookingId);

      expect(result).toMatchObject({
        bookingId,
        status: 'REFUND_PENDING',
        outcome: 'stale_claim_released',
      });
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'pay-row-1',
          status: 'REFUND_PENDING',
          refundAttemptKey: `attempt-key-1:claim:deadToken:${staleTimestamp}`,
        },
        data: {
          refundAttemptKey: 'attempt-key-1',
        },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'STALE_RECOVERY_CLAIM_RELEASED',
            entityId: 'pay-row-1',
          }),
        }),
      );
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('reconcileRefund refuses to release an active non-stale claim while within processing window', async () => {
      const recentTimestamp = Date.now() - 45 * 1000; // 45s ago (< 5 min)
      prisma.payment.findUnique.mockResolvedValue({
        ...recoverablePayment,
        refundAttemptKey: `attempt-key-1:claim:activeToken:${recentTimestamp}`,
      });
      paymentsFetch.mockResolvedValue({
        id: 'pay_captured_1',
        status: 'captured',
        amount: 300000,
        currency: 'INR',
        amount_refunded: 0,
      });
      refundsList.mockResolvedValue({ count: 0, items: [] });

      const result = await service.reconcileRefund('admin-1', bookingId);

      expect(result).toMatchObject({
        bookingId,
        status: 'REFUND_PENDING',
        outcome: 'recovery_in_progress',
      });
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it('prevents unsafe retry and retains pending state when provider outcome is unknown during execution', async () => {
      refundsCreate.mockRejectedValue({ statusCode: 503, message: 'Gateway Timeout' });

      await expect(service.recoverApprovedRefund('admin-1', bookingId)).rejects.toThrow(
        ServiceUnavailableException,
      );

      // Verifies reconciliation log was recorded with unknown outcome
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'REFUND_RECONCILIATION_REQUIRED',
            entityId: 'pay-row-1',
            details: expect.objectContaining({
              outcome: 'unknown',
              providerStatusCode: 503,
            }),
          }),
        }),
      );
      // Verifies base attempt key was restored for subsequent reconciliation
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { refundAttemptKey: 'attempt-key-1' },
        }),
      );
    });

    it('correlates existing matching provider refund instead of issuing duplicate refund', async () => {
      const existingRefund = {
        id: 'rfnd_already_created',
        payment_id: 'pay_captured_1',
        amount: 300000,
        status: 'processed',
        notes: { bookingId, eventaiRefundAttempt: 'attempt-key-1' },
      };
      refundsList.mockResolvedValue({ count: 1, items: [existingRefund] });

      const result = await service.recoverApprovedRefund('admin-1', bookingId);

      expect(refundsCreate).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        bookingId,
        refundId: 'rfnd_already_created',
        status: 'REFUNDED',
        outcome: 'reconciled_existing',
      });
      expect(prisma.ticketType.updateMany).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException if unexpected or unmatched refunds exist at provider', async () => {
      const unknownRefund = {
        id: 'rfnd_unknown_999',
        payment_id: 'pay_captured_1',
        amount: 150000,
        status: 'processed',
        notes: { bookingId: 'some-other-booking' },
      };
      refundsList.mockResolvedValue({ count: 1, items: [unknownRefund] });

      await expect(service.recoverApprovedRefund('admin-1', bookingId)).rejects.toThrow(
        ConflictException,
      );
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('throws ConflictException if provider payment status is not captured', async () => {
      paymentsFetch.mockResolvedValue({ ...providerCapturedPayment, status: 'failed' });

      await expect(service.recoverApprovedRefund('admin-1', bookingId)).rejects.toThrow(
        ConflictException,
      );
      expect(refundsCreate).not.toHaveBeenCalled();
    });
  });

  describe('recoverOrganizerRefund', () => {
    it('validates organizer ownership and delegates to recoverApprovedRefund', async () => {
      const orgPayment = {
        id: 'pay-row-1',
        bookingId,
        userId,
        status: 'REFUND_PENDING',
        refundRequestStatus: 'APPROVED',
        amount: 300000,
        currency: 'INR',
        refundId: null,
        refundAttemptKey: 'attempt-org',
        razorpayPaymentId: 'pay_captured_1',
        booking: {
          ...booking,
          status: 'CONFIRMED',
          event: { id: 'ev-1', title: 'Concert', organizerId: 'organizer-1', status: 'PUBLISHED' },
        },
      };

      prisma.payment.findUnique.mockResolvedValue(orgPayment);
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'audit-1',
          action: 'REFUND_RECONCILIATION_REQUIRED',
          entity: 'PAYMENT',
          entityId: 'pay-row-1',
          details: { providerStatusCode: 401 },
          createdAt: new Date(),
        },
      ]);
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
      paymentsFetch.mockResolvedValue({
        id: 'pay_captured_1',
        status: 'captured',
        amount: 300000,
        currency: 'INR',
        amount_refunded: 0,
      });
      refundsList.mockResolvedValue({ count: 0, items: [] });
      refundsCreate.mockResolvedValue({ id: 'rfnd_new_org', amount: 300000, status: 'processed' });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.booking.updateMany.mockResolvedValue({ count: 1 });
      prisma.ticket.updateMany.mockResolvedValue({ count: 2 });
      prisma.booking.findUniqueOrThrow.mockResolvedValue({ ...booking, status: 'REFUNDED', tickets: [] });

      const result = await service.recoverOrganizerRefund('organizer-1', 'user-1', bookingId);
      expect(result).toMatchObject({ outcome: 'recovered', refundId: 'rfnd_new_org' });
    });

    it('rejects access when the organizer does not own the event', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'pay-row-1',
        bookingId,
        booking: {
          ...booking,
          event: { id: 'ev-1', title: 'Concert', organizerId: 'other-organizer', status: 'PUBLISHED' },
        },
      });

      await expect(
        service.recoverOrganizerRefund('organizer-1', 'user-1', bookingId),
      ).rejects.toThrow(NotFoundException);
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
