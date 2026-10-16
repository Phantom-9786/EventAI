import type { Server } from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { createExpressApp } from './app';
import { BookingsService } from '../modules/bookings/bookings.service';
import { PaymentsService } from '../modules/payments/payments.service';
import { AdminService } from '../modules/admin/admin.service';
import { OrganizersService } from '../modules/organizers/organizers.service';
import { ExpressModerationService } from './services/moderation.service';
import { UserRole } from '@eventai/types';
import { StructuredLogger } from '../common/logging/structured-logger';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../common/exceptions';

describe('Express Bookings, Payments, Webhooks and Refunds Modules', () => {
  let server: Server;
  let baseUrl: string;
  const JWT_SECRET = 'super-secret-jwt-key-for-testing-purposes-only-32-chars';

  let mockPrisma: any;
  let mockBookingsService: any;
  let mockPaymentsService: any;
  let mockOrganizersService: any;
  let mockModerationService: any;
  let mockAdminService: any;

  const nullLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    logWithMeta: jest.fn(),
  } as unknown as StructuredLogger;

  const customerUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'customer@example.com',
    role: UserRole.CUSTOMER,
    isActive: true,
  };

  const organizerUser = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'organizer@example.com',
    role: UserRole.ORGANIZER,
    isActive: true,
  };

  const adminUser = {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'admin@example.com',
    role: UserRole.ADMIN,
    isActive: true,
  };

  function createToken(user: { id: string; email: string; role: UserRole }): string {
    return jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
  }

  beforeAll((done) => {
    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === customerUser.id) return Promise.resolve(customerUser);
          if (where.id === organizerUser.id) return Promise.resolve(organizerUser);
          if (where.id === adminUser.id) return Promise.resolve(adminUser);
          return Promise.resolve(null);
        }),
      },
    };

    mockBookingsService = {
      create: jest.fn(),
      listOwn: jest.fn(),
      getOwn: jest.fn(),
      cancelOwn: jest.fn(),
      handleStaleBookingsCron: jest.fn(),
    };

    mockPaymentsService = {
      createOrder: jest.fn(),
      verifyPayment: jest.fn(),
      handleWebhook: jest.fn(),
      requestRefund: jest.fn(),
      getTicketQrDataUrl: jest.fn(),
      listOrganizerRefundRequests: jest.fn(),
      approveRefundRequest: jest.fn(),
      rejectRefundRequest: jest.fn(),
      reconcileOrganizerRefund: jest.fn(),
      recoverOrganizerRefund: jest.fn(),
      reconcileRefund: jest.fn(),
      recoverApprovedRefund: jest.fn(),
    };

    mockOrganizersService = {
      validateTicket: jest.fn(),
      eventTicketStats: jest.fn(),
    };

    mockModerationService = {
      getEventModerationStatus: jest.fn(),
      requireApprovedOrganizer: jest.fn(),
    };

    mockAdminService = {
      listBookings: jest.fn(),
      getBooking: jest.fn(),
    };

    const app = createExpressApp({
      prisma: mockPrisma,
      bookingsService: mockBookingsService as unknown as BookingsService,
      paymentsService: mockPaymentsService as unknown as PaymentsService,
      organizersService: mockOrganizersService as unknown as OrganizersService,
      moderationService: mockModerationService as unknown as ExpressModerationService,
      adminService: mockAdminService as unknown as AdminService,
      jwtSecret: JWT_SECRET,
      logger: nullLogger,
      rateLimit: false,
      env: {
        JWT_SECRET,
        FRONTEND_URL: 'http://localhost:3000',
        NODE_ENV: 'test',
      },
    });

    server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  afterAll((done) => {
    server.closeAllConnections?.();
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Booking Creation, Inventory Reservation & Moderation Invariant
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Booking Creation & Invariants', () => {
    const validBookingPayload = {
      eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      items: [
        {
          ticketTypeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          quantity: 2,
        },
      ],
      idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    };

    it('creates a booking successfully for an approved event', async () => {
      mockModerationService.getEventModerationStatus.mockResolvedValueOnce({ status: 'APPROVED' });
      mockBookingsService.create.mockResolvedValueOnce({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        userId: customerUser.id,
        eventId: validBookingPayload.eventId,
        totalAmount: 100000,
        status: 'PENDING',
      });

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(validBookingPayload),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.booking.id).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
      expect(data.booking.status).toBe('PENDING');
      expect(mockModerationService.getEventModerationStatus).toHaveBeenCalledWith(validBookingPayload.eventId);
      expect(mockBookingsService.create).toHaveBeenCalledWith(customerUser.id, validBookingPayload);
    });

    it('strictly blocks booking an unapproved/pending/rejected event (404 Not Found)', async () => {
      mockModerationService.getEventModerationStatus.mockResolvedValueOnce({ status: 'PENDING_APPROVAL' });

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(validBookingPayload),
      });

      expect(res.status).toBe(404);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(404);
      expect(data.message).toBe('Event not found or not open for booking');
      expect(mockBookingsService.create).not.toHaveBeenCalled();
    });

    it('handles insufficient ticket inventory (409 Conflict)', async () => {
      mockModerationService.getEventModerationStatus.mockResolvedValueOnce({ status: 'APPROVED' });
      mockBookingsService.create.mockRejectedValueOnce(
        new ConflictException('Not enough "VIP" tickets left for this booking'),
      );

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(validBookingPayload),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(409);
      expect(data.message).toContain('Not enough');
    });

    it('rejects unauthenticated booking requests with 401', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBookingPayload),
      });

      expect(res.status).toBe(401);
    });

    it('rejects invalid booking payload (400 Bad Request)', async () => {
      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          eventId: 'invalid-uuid',
          items: [],
          idempotencyKey: 'not-a-uuid',
        }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(400);
    });

    it('returns existing booking idempotently when same user submits duplicate idempotencyKey', async () => {
      mockModerationService.getEventModerationStatus.mockResolvedValueOnce({ status: 'APPROVED' });
      mockBookingsService.create.mockResolvedValueOnce({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        userId: customerUser.id,
        eventId: validBookingPayload.eventId,
        totalAmount: 100000,
        status: 'PENDING',
      });

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(validBookingPayload),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.booking.id).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    });

    it('rejects booking request with 403 when idempotencyKey was already used by another user', async () => {
      mockModerationService.getEventModerationStatus.mockResolvedValueOnce({ status: 'APPROVED' });
      mockBookingsService.create.mockRejectedValueOnce(
        new ForbiddenException('Idempotency key already in use'),
      );

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(validBookingPayload),
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(403);
      expect(data.message).toBe('Idempotency key already in use');
    });

    it('rejects booking when event has already started (409 Conflict)', async () => {
      mockModerationService.getEventModerationStatus.mockResolvedValueOnce({ status: 'APPROVED' });
      mockBookingsService.create.mockRejectedValueOnce(
        new ConflictException('This event has already started'),
      );

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(validBookingPayload),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.message).toBe('This event has already started');
    });

    it('rejects booking when ticket is outside sale window (409 Conflict)', async () => {
      mockModerationService.getEventModerationStatus.mockResolvedValueOnce({ status: 'APPROVED' });
      mockBookingsService.create.mockRejectedValueOnce(
        new ConflictException('Ticket type "VIP" is outside its sale window'),
      );

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(validBookingPayload),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.message).toContain('outside its sale window');
    });

    it('rejects booking when requested quantity exceeds maxPerBooking limit (409 Conflict)', async () => {
      mockModerationService.getEventModerationStatus.mockResolvedValueOnce({ status: 'APPROVED' });
      mockBookingsService.create.mockRejectedValueOnce(
        new ConflictException('Only 5 "VIP" tickets per booking'),
      );

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(validBookingPayload),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.message).toContain('Only 5 "VIP" tickets per booking');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Booking History, Detail & Cancellation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Booking History & Cancellation', () => {
    it('GET /api/bookings returns user bookings list with pagination', async () => {
      mockBookingsService.listOwn.mockResolvedValueOnce({
        bookings: [{ id: 'b1', totalAmount: 50000 }],
        total: 1,
        page: 1,
        limit: 20,
        pages: 1,
      });

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/bookings?page=1&limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.bookings).toHaveLength(1);
      expect(mockBookingsService.listOwn).toHaveBeenCalledWith(customerUser.id, 1, 10);
    });

    it('GET /api/bookings/:id retrieves owned booking detail', async () => {
      mockBookingsService.getOwn.mockResolvedValueOnce({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        userId: customerUser.id,
        totalAmount: 100000,
        status: 'PENDING',
      });

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/bookings/dddddddd-dddd-4ddd-8ddd-dddddddddddd`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.booking.id).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
      expect(mockBookingsService.getOwn).toHaveBeenCalledWith(
        customerUser.id,
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      );
    });

    it('GET /api/bookings/:id returns 404 when booking does not belong to user', async () => {
      mockBookingsService.getOwn.mockRejectedValueOnce(new NotFoundException('Booking not found'));

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/bookings/dddddddd-dddd-4ddd-8ddd-dddddddddddd`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(404);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(404);
    });

    it('POST /api/bookings/:id/cancel cancels unpaid booking and releases inventory', async () => {
      mockBookingsService.cancelOwn.mockResolvedValueOnce({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        status: 'CANCELLED',
      });

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/bookings/dddddddd-dddd-4ddd-8ddd-dddddddddddd/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: 'Changed my mind' }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.booking.status).toBe('CANCELLED');
      expect(mockBookingsService.cancelOwn).toHaveBeenCalledWith(
        customerUser.id,
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'Changed my mind',
      );
    });

    it('POST /api/bookings/:id/cancel returns 404 when booking does not belong to user', async () => {
      mockBookingsService.cancelOwn.mockRejectedValueOnce(new NotFoundException('Booking not found'));

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/bookings/dddddddd-dddd-4ddd-8ddd-dddddddddddd/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: 'Attempt to cancel another user booking' }),
      });

      expect(res.status).toBe(404);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(404);
      expect(data.message).toBe('Booking not found');
    });

    it('POST /api/bookings/:id/cancel returns 409 Conflict when booking is already closed', async () => {
      mockBookingsService.cancelOwn.mockRejectedValueOnce(
        new ConflictException('This booking is already closed'),
      );

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/bookings/dddddddd-dddd-4ddd-8ddd-dddddddddddd/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: 'Re-cancelling' }),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(409);
      expect(data.message).toBe('This booking is already closed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Payment Orders, Verification & Webhook Raw-Bytes Processing
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Razorpay Payment Flow & Webhooks', () => {
    it('POST /api/payments/order creates a Razorpay order for an open booking', async () => {
      mockPaymentsService.createOrder.mockResolvedValueOnce({
        orderId: 'order_test_123',
        amount: 100000,
        currency: 'INR',
        keyId: 'rzp_test_sample_key',
      });

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/payments/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bookingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.orderId).toBe('order_test_123');
      expect(data.amount).toBe(100000);
      expect(mockPaymentsService.createOrder).toHaveBeenCalledWith(
        customerUser.id,
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      );
    });

    it('POST /api/payments/order rejects order creation if booking has expired (409 Conflict)', async () => {
      mockPaymentsService.createOrder.mockRejectedValueOnce(
        new ConflictException('This booking has expired — please create a new one'),
      );

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/payments/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bookingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.message).toContain('expired');
    });

    it('POST /api/payments/order rejects order creation if booking is already paid (409 Conflict)', async () => {
      mockPaymentsService.createOrder.mockRejectedValueOnce(
        new ConflictException('This booking is already paid'),
      );

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/payments/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bookingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.message).toBe('This booking is already paid');
    });

    it('POST /api/payments/verify verifies payment and confirms booking', async () => {
      mockPaymentsService.verifyPayment.mockResolvedValueOnce({
        booking: {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          status: 'CONFIRMED',
        },
      });

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/payments/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          razorpayOrderId: 'order_test_123',
          razorpayPaymentId: 'pay_test_456',
          razorpaySignature: 'valid_signature_hash',
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.booking.status).toBe('CONFIRMED');
    });

    it('POST /api/payments/verify rejects invalid signature with 400 Bad Request', async () => {
      mockPaymentsService.verifyPayment.mockRejectedValueOnce(
        new BadRequestException('Invalid payment signature'),
      );

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/payments/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          razorpayOrderId: 'order_test_123',
          razorpayPaymentId: 'pay_test_456',
          razorpaySignature: 'tampered_signature',
        }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(400);
      expect(data.message).toBe('Invalid payment signature');
    });

    it('POST /api/payments/verify rejects payment when amount does not match booking amount (409 Conflict)', async () => {
      mockPaymentsService.verifyPayment.mockRejectedValueOnce(
        new ConflictException('Payment amount does not match booking amount'),
      );

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/payments/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          razorpayOrderId: 'order_test_123',
          razorpayPaymentId: 'pay_test_456',
          razorpaySignature: 'valid_signature_hash',
        }),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Payment amount does not match booking amount');
    });

    it('POST /api/payments/verify idempotently returns booking when payment was already captured (200 OK)', async () => {
      mockPaymentsService.verifyPayment.mockResolvedValueOnce({
        booking: {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          status: 'CONFIRMED',
        },
      });

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/payments/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          razorpayOrderId: 'order_test_123',
          razorpayPaymentId: 'pay_test_456',
          razorpaySignature: 'valid_signature_hash',
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.booking.status).toBe('CONFIRMED');
    });

    it('POST /api/payments/webhook processes webhook using raw request buffer', async () => {
      mockPaymentsService.handleWebhook.mockResolvedValueOnce({ received: true, handled: true });

      const rawPayload = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: { entity: { id: 'pay_123', order_id: 'order_123' } },
        },
      });

      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': 'webhook_signature_sample',
        },
        body: rawPayload,
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.received).toBe(true);
      expect(data.handled).toBe(true);
      expect(mockPaymentsService.handleWebhook).toHaveBeenCalledWith(
        expect.any(Buffer),
        'webhook_signature_sample',
      );
    });

    it('POST /api/payments/webhook rejects request missing signature header (400 Bad Request)', async () => {
      mockPaymentsService.handleWebhook.mockRejectedValueOnce(
        new BadRequestException('Missing x-razorpay-signature header'),
      );

      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'payment.captured' }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Missing x-razorpay-signature header');
    });

    it('POST /api/payments/webhook rejects request with invalid signature (403 Forbidden)', async () => {
      mockPaymentsService.handleWebhook.mockRejectedValueOnce(
        new ForbiddenException('Invalid webhook signature'),
      );

      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': 'invalid_forged_sig',
        },
        body: JSON.stringify({ event: 'payment.captured' }),
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Invalid webhook signature');
    });

    it('POST /api/payments/webhook ignores duplicate captured event ({ received: true, handled: false })', async () => {
      mockPaymentsService.handleWebhook.mockResolvedValueOnce({ received: true, handled: false });

      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': 'valid_sig',
        },
        body: JSON.stringify({
          event: 'payment.captured',
          payload: { payment: { entity: { id: 'pay_123', order_id: 'order_123' } } },
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.received).toBe(true);
      expect(data.handled).toBe(false);
    });

    it('POST /api/payments/webhook ignores out-of-order failed event when already captured ({ received: true, handled: false })', async () => {
      mockPaymentsService.handleWebhook.mockResolvedValueOnce({ received: true, handled: false });

      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': 'valid_sig',
        },
        body: JSON.stringify({
          event: 'payment.failed',
          payload: { payment: { entity: { id: 'pay_123', order_id: 'order_123' } } },
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.received).toBe(true);
      expect(data.handled).toBe(false);
    });

    it('POST /api/payments/webhook ignores event for unknown order ({ received: true, handled: false })', async () => {
      mockPaymentsService.handleWebhook.mockResolvedValueOnce({ received: true, handled: false });

      const res = await fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': 'valid_sig',
        },
        body: JSON.stringify({
          event: 'payment.captured',
          payload: { payment: { entity: { id: 'pay_unknown', order_id: 'order_unknown' } } },
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.received).toBe(true);
      expect(data.handled).toBe(false);
    });

    it('POST /api/payments/refund allows attendee to request refund for confirmed booking', async () => {
      mockPaymentsService.requestRefund.mockResolvedValueOnce({
        message: 'Refund requested successfully',
        refundRequest: { status: 'PENDING' },
      });

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/payments/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          reason: 'Schedule conflict',
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toContain('Refund requested');
      expect(mockPaymentsService.requestRefund).toHaveBeenCalledWith(
        customerUser.id,
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'Schedule conflict',
      );
    });

    it('GET /api/payments/tickets/:id/qr returns ticket QR data-URL', async () => {
      mockPaymentsService.getTicketQrDataUrl.mockResolvedValueOnce('data:image/png;base64,sampleQR');

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/payments/tickets/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/qr`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.dataUrl).toContain('data:image/png;base64');
    });

    it('POST /api/payments/refund returns 404 when booking does not belong to user', async () => {
      mockPaymentsService.requestRefund.mockRejectedValueOnce(new NotFoundException('Booking not found'));

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/payments/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          reason: 'Unauthorized refund request attempt',
        }),
      });

      expect(res.status).toBe(404);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(404);
      expect(data.message).toBe('Booking not found');
    });

    it('GET /api/payments/tickets/:id/qr returns 404 when ticket does not belong to user', async () => {
      mockPaymentsService.getTicketQrDataUrl.mockRejectedValueOnce(new NotFoundException('Ticket not found'));

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/payments/tickets/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/qr`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(404);
      const data = (await res.json()) as any;
      expect(data.statusCode).toBe(404);
      expect(data.message).toBe('Ticket not found');
    });
    it('POST /api/payments/refund rejects request for unpaid booking (409 Conflict)', async () => {
      mockPaymentsService.requestRefund.mockRejectedValueOnce(
        new ConflictException('Only paid (confirmed) bookings can request a refund — unpaid bookings can simply be cancelled'),
      );

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/payments/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          reason: 'Attempting to refund unpaid booking',
        }),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.message).toContain('Only paid (confirmed) bookings can request a refund');
    });

    it('POST /api/payments/refund rejects request when a refund is already pending (409 Conflict)', async () => {
      mockPaymentsService.requestRefund.mockRejectedValueOnce(
        new ConflictException('A refund request is already awaiting organizer approval'),
      );

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/payments/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          reason: 'Duplicate refund request',
        }),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.message).toBe('A refund request is already awaiting organizer approval');
    });

    it('POST /api/payments/refund rejects request when booking was already refunded (409 Conflict)', async () => {
      mockPaymentsService.requestRefund.mockRejectedValueOnce(
        new ConflictException('This booking was already refunded'),
      );

      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/payments/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookingId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          reason: 'Refund again',
        }),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.message).toBe('This booking was already refunded');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Organizer & Admin Refund Oversight Workflows
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Organizer & Admin Refund Operations', () => {
    it('Organizer lists refund requests for owned events', async () => {
      mockModerationService.requireApprovedOrganizer.mockResolvedValueOnce('org_verified_1');
      mockPaymentsService.listOrganizerRefundRequests.mockResolvedValueOnce({
        refundRequests: [{ id: 'b1', totalAmount: 50000, refundRequestReason: 'Emergency' }],
        total: 1,
        page: 1,
        limit: 20,
        pages: 1,
      });

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/organizers/refund-requests?status=PENDING`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.refundRequests).toHaveLength(1);
      expect(mockPaymentsService.listOrganizerRefundRequests).toHaveBeenCalledWith(
        'org_verified_1',
        'PENDING',
        1,
        20,
      );
    });

    it('Organizer approves a refund request (POST /api/organizers/refund-requests/:id/approve)', async () => {
      mockModerationService.requireApprovedOrganizer.mockResolvedValueOnce('org_verified_1');
      mockPaymentsService.approveRefundRequest.mockResolvedValueOnce({
        message: 'Refund approved and submitted to provider',
      });

      const token = createToken(organizerUser);
      const res = await fetch(
        `${baseUrl}/api/organizers/refund-requests/dddddddd-dddd-4ddd-8ddd-dddddddddddd/approve`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toContain('Refund approved');
      expect(mockPaymentsService.approveRefundRequest).toHaveBeenCalledWith(
        'org_verified_1',
        organizerUser.id,
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      );
    });

    it('Organizer rejects approving a refund request when no longer pending (409 Conflict)', async () => {
      mockModerationService.requireApprovedOrganizer.mockResolvedValueOnce('org_verified_1');
      mockPaymentsService.approveRefundRequest.mockRejectedValueOnce(
        new ConflictException('This refund request is no longer awaiting approval'),
      );

      const token = createToken(organizerUser);
      const res = await fetch(
        `${baseUrl}/api/organizers/refund-requests/dddddddd-dddd-4ddd-8ddd-dddddddddddd/approve`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.message).toBe('This refund request is no longer awaiting approval');
    });

    it('Organizer rejects a refund request (POST /api/organizers/refund-requests/:id/reject)', async () => {
      mockModerationService.requireApprovedOrganizer.mockResolvedValueOnce('org_verified_1');
      mockPaymentsService.rejectRefundRequest.mockResolvedValueOnce({
        message: 'Refund request rejected',
        refundRequest: { status: 'REJECTED' },
      });

      const token = createToken(organizerUser);
      const res = await fetch(
        `${baseUrl}/api/organizers/refund-requests/dddddddd-dddd-4ddd-8ddd-dddddddddddd/reject`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Refund request rejected');
      expect(mockPaymentsService.rejectRefundRequest).toHaveBeenCalledWith(
        'org_verified_1',
        organizerUser.id,
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      );
    });

    it('Organizer reconciles a refund request (POST /api/organizers/refund-requests/:id/reconcile)', async () => {
      mockModerationService.requireApprovedOrganizer.mockResolvedValueOnce('org_verified_1');
      mockPaymentsService.reconcileOrganizerRefund.mockResolvedValueOnce({
        status: 'REFUND_PENDING',
        outcome: 'provider_pending',
        message: 'Provider settlement is in progress',
      });

      const token = createToken(organizerUser);
      const res = await fetch(
        `${baseUrl}/api/organizers/refund-requests/dddddddd-dddd-4ddd-8ddd-dddddddddddd/reconcile`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.status).toBe('REFUND_PENDING');
      expect(mockPaymentsService.reconcileOrganizerRefund).toHaveBeenCalledWith(
        'org_verified_1',
        organizerUser.id,
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      );
    });

    it('Non-organizer is blocked from approving refunds (403 Forbidden)', async () => {
      const token = createToken(customerUser);
      const res = await fetch(
        `${baseUrl}/api/organizers/refund-requests/dddddddd-dddd-4ddd-8ddd-dddddddddddd/approve`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      expect(res.status).toBe(403);
    });

    it('Admin inspects and reconciles refund (POST /api/admin/bookings/:id/refund/reconcile)', async () => {
      mockPaymentsService.reconcileRefund.mockResolvedValueOnce({
        status: 'REFUNDED',
        message: 'Refund reconciled with provider',
      });

      const token = createToken(adminUser);
      const res = await fetch(
        `${baseUrl}/api/admin/bookings/dddddddd-dddd-4ddd-8ddd-dddddddddddd/refund/reconcile`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.status).toBe('REFUNDED');
      expect(mockPaymentsService.reconcileRefund).toHaveBeenCalledWith(
        adminUser.id,
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      );
    });

    it('Non-admin is blocked from admin refund reconciliation (403 Forbidden)', async () => {
      const token = createToken(organizerUser);
      const res = await fetch(
        `${baseUrl}/api/admin/bookings/dddddddd-dddd-4ddd-8ddd-dddddddddddd/refund/reconcile`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Digital Ticket Scanning & Door Validation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Digital Ticket Check-in & Door Verification', () => {
    const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    it('validates a valid ticket at the door successfully (200 OK)', async () => {
      mockModerationService.requireApprovedOrganizer.mockResolvedValueOnce('org_verified_1');
      mockOrganizersService.validateTicket.mockResolvedValueOnce({
        ticket: {
          id: 'tkt_1',
          ticketCode: 'TKT-VALID123',
          holderName: 'Alice Smith',
          status: 'USED',
          validatedAt: new Date().toISOString(),
          ticketType: { id: 'tt_1', name: 'VIP Pass' },
        },
        holder: {
          id: customerUser.id,
          firstName: 'Alice',
          lastName: 'Smith',
          email: customerUser.email,
        },
      });

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/organizers/events/${eventId}/tickets/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ticketCode: 'TKT-VALID123' }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.ticket.status).toBe('USED');
      expect(data.holder.email).toBe(customerUser.email);
      expect(mockOrganizersService.validateTicket).toHaveBeenCalledWith(
        'org_verified_1',
        eventId,
        'TKT-VALID123',
      );
    });

    it('rejects duplicate scan on already USED ticket (409 Conflict)', async () => {
      mockModerationService.requireApprovedOrganizer.mockResolvedValueOnce('org_verified_1');
      mockOrganizersService.validateTicket.mockRejectedValueOnce(
        new ConflictException('Ticket already used at 2026-10-15T18:00:00.000Z'),
      );

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/organizers/events/${eventId}/tickets/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ticketCode: 'TKT-USED123' }),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.message).toContain('Ticket already used');
    });

    it('rejects scan on CANCELLED ticket (409 Conflict)', async () => {
      mockModerationService.requireApprovedOrganizer.mockResolvedValueOnce('org_verified_1');
      mockOrganizersService.validateTicket.mockRejectedValueOnce(
        new ConflictException('Ticket is cancelled and cannot be accepted'),
      );

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/organizers/events/${eventId}/tickets/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ticketCode: 'TKT-CANCELLED123' }),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.message).toContain('cancelled and cannot be accepted');
    });

    it('rejects scan for ticket belonging to another event (404 Not Found)', async () => {
      mockModerationService.requireApprovedOrganizer.mockResolvedValueOnce('org_verified_1');
      mockOrganizersService.validateTicket.mockRejectedValueOnce(
        new NotFoundException('Ticket not found for this event'),
      );

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/organizers/events/${eventId}/tickets/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ticketCode: 'TKT-OTHER123' }),
      });

      expect(res.status).toBe(404);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Ticket not found for this event');
    });

    it('rejects ticket validation with invalid ticketCode payload (400 Bad Request)', async () => {
      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/organizers/events/${eventId}/tickets/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ticketCode: 'ab' }), // too short
      });

      expect(res.status).toBe(400);
    });

    it('rejects non-organizer attempting to validate tickets (403 Forbidden)', async () => {
      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/organizers/events/${eventId}/tickets/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ticketCode: 'TKT-VALID123' }),
      });

      expect(res.status).toBe(403);
    });

    it('fetches event check-in door stats successfully (200 OK)', async () => {
      mockModerationService.requireApprovedOrganizer.mockResolvedValueOnce('org_verified_1');
      mockOrganizersService.eventTicketStats.mockResolvedValueOnce({
        VALID: 15,
        USED: 35,
        CANCELLED: 2,
        EXPIRED: 0,
      });

      const token = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/organizers/events/${eventId}/tickets/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.VALID).toBe(15);
      expect(data.USED).toBe(35);
      expect(mockOrganizersService.eventTicketStats).toHaveBeenCalledWith(
        'org_verified_1',
        eventId,
      );
    });
  });
});
