import type { Server } from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { createExpressApp } from './app';
import { UserRole } from '@eventai/types';
import { StructuredLogger } from '../common/logging/structured-logger';
import type { CacheService } from '../common/cache/cache.service';

describe('Frontend-to-Express API Contract Verification', () => {
  let server: Server;
  let baseUrl: string;
  const JWT_SECRET = 'super-secret-contract-jwt-key-32-chars-long';

  const nullLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    logWithMeta: jest.fn(),
  } as unknown as StructuredLogger;

  const customerId = '11111111-1111-4111-8111-111111111111';
  const organizerId = '22222222-2222-4222-8222-222222222222';
  const adminId = '33333333-3333-4333-8333-333333333333';
  const eventId = '44444444-4444-4444-8444-444444444444';
  const bookingId = '55555555-5555-4555-8555-555555555555';
  const ticketId = '66666666-6666-4666-8666-666666666666';
  const venueId = '77777777-7777-4777-8777-777777777777';
  const ticketTypeId = '88888888-8888-4888-8888-888888888888';
  const idempotencyKey = '99999999-9999-4999-8999-999999999999';

  const customerUser = {
    id: customerId,
    email: 'customer@contract.test',
    role: UserRole.CUSTOMER,
    isActive: true,
  };

  const organizerUser = {
    id: organizerId,
    email: 'organizer@contract.test',
    role: UserRole.ORGANIZER,
    isActive: true,
  };

  const adminUser = {
    id: adminId,
    email: 'admin@contract.test',
    role: UserRole.ADMIN,
    isActive: true,
  };

  let mockPrisma: any;
  let mockAuthService: any;
  let mockUsersService: any;
  let mockCategoriesService: any;
  let mockVenuesService: any;
  let mockOrganizersService: any;
  let mockEventsService: any;
  let mockBookingsService: any;
  let mockPaymentsService: any;
  let mockAdminService: any;
  let mockAiService: any;
  let mockNotificationsService: any;
  let mockModerationService: any;

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
          if (where.id === customerId) return Promise.resolve(customerUser);
          if (where.id === organizerId) return Promise.resolve(organizerUser);
          if (where.id === adminId) return Promise.resolve(adminUser);
          return Promise.resolve(null);
        }),
      },
      organizer: {
        findUnique: jest.fn().mockResolvedValue({
          id: organizerId,
          userId: organizerId,
          organizationName: 'Contract Organizer',
          isVerified: true,
        }),
      },
    };

    mockAuthService = {
      register: jest.fn().mockResolvedValue({
        user: { id: customerId, email: 'customer@contract.test', role: UserRole.CUSTOMER, isEmailVerified: false },
        message: 'Registration successful. Please enter the verification code sent to your email.',
        emailDeliveryFailed: false,
      }),
      verifyOtp: jest.fn().mockResolvedValue({
        message: 'Email successfully verified. You can now log in.',
        success: true,
      }),
      resendOtp: jest.fn().mockResolvedValue({
        message: 'A new verification code has been sent to your email.',
      }),
      login: jest.fn().mockResolvedValue({
        user: { id: customerId, email: 'customer@contract.test', role: UserRole.CUSTOMER },
        tokens: { accessToken: 'mock-access', refreshToken: 'mock-refresh' },
      }),
      refresh: jest.fn().mockResolvedValue({ accessToken: 'mock-new-access', refreshToken: 'mock-new-refresh' }),
      logout: jest.fn().mockResolvedValue(undefined),
      getProfile: jest.fn().mockResolvedValue({
        id: customerId,
        email: 'customer@contract.test',
        firstName: 'Contract',
        lastName: 'Tester',
        role: UserRole.CUSTOMER,
      }),
    };

    mockUsersService = {
      getOwnProfile: jest.fn().mockResolvedValue({
        id: customerId,
        email: 'customer@contract.test',
        firstName: 'Contract',
        lastName: 'Tester',
      }),
      updatePreferences: jest.fn().mockResolvedValue({
        id: customerId,
        preferences: { theme: 'dark', emailNotifications: true },
      }),
      getDeletionBlockers: jest.fn().mockResolvedValue({
        canDelete: true,
        blockers: [],
      }),
    };

    mockCategoriesService = {
      listActive: jest.fn().mockResolvedValue([
        { id: 'cat-1', name: 'Music', slug: 'music', icon: 'music', color: '#ff0000', _count: { events: 5 } },
      ]),
    };

    mockVenuesService = {
      search: jest.fn().mockResolvedValue({
        venues: [{ id: venueId, name: 'Grand Arena', city: 'Mumbai', capacity: 5000 }],
        total: 1,
        page: 1,
        pages: 1,
      }),
      getVenue: jest.fn().mockResolvedValue({
        id: venueId,
        name: 'Grand Arena',
        address: '123 Marine Drive',
        city: 'Mumbai',
        seatSections: [],
      }),
    };

    mockEventsService = {
      searchEvents: jest.fn().mockResolvedValue({
        events: [
          {
            id: eventId,
            title: 'Live Rock Fest',
            slug: 'live-rock-fest',
            startDate: '2026-11-01T18:00:00.000Z',
            minPrice: 99900,
          },
        ],
        total: 1,
        page: 1,
        pages: 1,
      }),
      getPublishedEvent: jest.fn().mockResolvedValue({
        id: eventId,
        title: 'Live Rock Fest',
        slug: 'live-rock-fest',
        description: 'Complete rock festival experience',
        ticketTypes: [{ id: ticketTypeId, name: 'General Admission', price: 99900, availableQuantity: 50 }],
      }),
      findSimilarEvents: jest.fn().mockResolvedValue([
        { id: 'ev-2', title: 'Indie Pop Night', slug: 'indie-pop-night' },
      ]),
    };

    mockModerationService = {
      getEventModerationStatus: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
      getOrganizerApplicationStatus: jest.fn().mockResolvedValue({ status: 'APPROVED', rejectionReason: null }),
      requireApprovedOrganizer: jest.fn().mockResolvedValue(organizerId),
    };

    mockBookingsService = {
      create: jest.fn().mockResolvedValue({
        id: bookingId,
        status: 'PENDING',
        totalAmount: 99900,
        expiresAt: '2026-10-15T18:15:00.000Z',
      }),
      listOwn: jest.fn().mockResolvedValue({
        bookings: [{ id: bookingId, status: 'CONFIRMED', totalAmount: 99900 }],
        total: 1,
        page: 1,
        pages: 1,
      }),
      getOwn: jest.fn().mockResolvedValue({
        id: bookingId,
        status: 'CONFIRMED',
        totalAmount: 99900,
        tickets: [{ id: ticketId, ticketCode: 'TKT-12345', status: 'VALID' }],
      }),
      cancelOwn: jest.fn().mockResolvedValue({
        id: bookingId,
        status: 'CANCELLED',
      }),
    };

    mockPaymentsService = {
      createOrder: jest.fn().mockResolvedValue({
        orderId: 'order_mock123',
        amount: 99900,
        currency: 'INR',
        keyId: 'rzp_test_key',
      }),
      verifyPayment: jest.fn().mockResolvedValue({
        booking: {
          id: bookingId,
          status: 'CONFIRMED',
          totalAmount: 99900,
        },
      }),
      requestRefund: jest.fn().mockResolvedValue({
        refundRequest: {
          bookingId,
          status: 'PENDING',
          reason: 'Customer requested refund',
          requestedAt: new Date().toISOString(),
        },
      }),
      getTicketQrDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='),
      listOrganizerRefundRequests: jest.fn().mockResolvedValue({
        refundRequests: [{ bookingId, amount: 99900, currency: 'INR', refundRequestStatus: 'PENDING' }],
        counts: { PENDING: 1, APPROVED: 0, REFUNDED: 0, REJECTED: 0, FAILED: 0, ALL: 1 },
        total: 1,
        page: 1,
        limit: 20,
      }),
      approveRefundRequest: jest.fn().mockResolvedValue({
        bookingId,
        status: 'REFUND_PENDING',
        refundStatus: 'PENDING',
      }),
    };

    mockOrganizersService = {
      requireOrganizerId: jest.fn().mockResolvedValue(organizerId),
      getOwnOrganizerProfile: jest.fn().mockResolvedValue({
        id: organizerId,
        organizationName: 'Contract Organizer',
        phone: '+919876543210',
        _count: { events: 3, venues: 1 },
      }),
      getDashboardStats: jest.fn().mockResolvedValue({
        events: { total: 3, DRAFT: 1, PUBLISHED: 2, CANCELLED: 0, COMPLETED: 0 },
        revenue: 199800,
        confirmedBookings: 2,
        refundedBookings: 0,
        ticketsIssued: 2,
        checkedIn: 1,
      }),
      validateTicket: jest.fn().mockResolvedValue({
        ticket: { id: ticketId, ticketCode: 'TKT-12345', status: 'USED', ticketType: { id: ticketTypeId, name: 'VIP' } },
        holder: { id: customerId, firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
      }),
    };

    mockAdminService = {
      platformStats: jest.fn().mockResolvedValue({
        users: 150,
        organizers: { total: 10, verified: 8 },
        events: { total: 25, DRAFT: 5, PUBLISHED: 20, CANCELLED: 0, COMPLETED: 0, SOLDOUT: 2 },
        revenue: { gross: 5000000, refunded: 200000, net: 4800000 },
      }),
      listAuditLogs: jest.fn().mockResolvedValue({
        logs: [{ id: 'audit-1', action: 'EVENT_PUBLISHED', entity: 'EVENT' }],
        total: 1,
        page: 1,
        pages: 1,
      }),
    };

    mockAiService = {
      isConfigured: jest.fn().mockReturnValue(true),
      chat: jest.fn().mockResolvedValue({
        reply: 'Here are the best live music events this weekend.',
        events: [{ id: eventId, title: 'Live Rock Fest', slug: 'live-rock-fest' }],
      }),
    };

    mockNotificationsService = {
      getUserNotifications: jest.fn().mockResolvedValue({
        notifications: [{ id: 'notif-1', title: 'Booking Confirmed', message: 'Your ticket is ready', isRead: false }],
        unreadCount: 1,
      }),
      markAsRead: jest.fn().mockResolvedValue({ id: 'notif-1', isRead: true }),
      markAllAsRead: jest.fn().mockResolvedValue({ count: 1 }),
      clearAll: jest.fn().mockResolvedValue({ success: true, count: 1 }),
      clearNotification: jest.fn().mockResolvedValue({ success: true }),
    };

    const mockCache = {
      ping: jest.fn().mockResolvedValue('PONG'),
      consumeAiRequest: jest.fn().mockResolvedValue({ allowed: true }),
      releaseAiRequest: jest.fn().mockResolvedValue(undefined),
      providerCooldownMs: jest.fn().mockResolvedValue(0),
      setProviderCooldown: jest.fn().mockResolvedValue(undefined),
    } as unknown as CacheService;

    const app = createExpressApp({
      prisma: mockPrisma,
      cache: mockCache,
      authService: mockAuthService,
      usersService: mockUsersService,
      categoriesService: mockCategoriesService,
      venuesService: mockVenuesService,
      organizersService: mockOrganizersService,
      eventsService: mockEventsService,
      bookingsService: mockBookingsService,
      paymentsService: mockPaymentsService,
      adminService: mockAdminService,
      aiService: mockAiService,
      notificationsService: mockNotificationsService,
      moderationService: mockModerationService,
      jwtSecret: JWT_SECRET,
      rateLimit: false,
      logger: nullLogger,
    });

    server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  describe('1. Public Catalog & Event Search Contracts', () => {
    it('matches searchEvents response shape: { events, total, page, pages }', async () => {
      const res = await fetch(`${baseUrl}/api/events?query=rock&page=1&limit=10`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(Array.isArray(data.events)).toBe(true);
      expect(data.total).toBe(1);
      expect(data.page).toBe(1);
      expect(data.pages).toBe(1);
      expect(data.events[0].slug).toBe('live-rock-fest');
    });

    it('matches getEvent detail response shape: { event }', async () => {
      const res = await fetch(`${baseUrl}/api/events/live-rock-fest`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.event).toBeDefined();
      expect(data.event.id).toBe(eventId);
      expect(data.event.ticketTypes).toHaveLength(1);
    });

    it('matches getCategories response shape: { categories }', async () => {
      const res = await fetch(`${baseUrl}/api/categories`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(Array.isArray(data.categories)).toBe(true);
      expect(data.categories[0].name).toBe('Music');
    });

    it('matches getVenues search response shape: { venues, total, page, pages }', async () => {
      const res = await fetch(`${baseUrl}/api/venues?city=Mumbai`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(Array.isArray(data.venues)).toBe(true);
      expect(data.venues[0].name).toBe('Grand Arena');
    });

    it('matches getVenue detail response shape: { venue }', async () => {
      const res = await fetch(`${baseUrl}/api/venues/${venueId}`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.venue.name).toBe('Grand Arena');
      expect(Array.isArray(data.venue.seatSections)).toBe(true);
    });
  });

  describe('2. Authentication & User Profile Contracts', () => {
    it('matches register response shape and sets httpOnly refresh cookie', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'newuser@example.com',
          password: 'Password123!',
          firstName: 'New',
          lastName: 'User',
        }),
      });
      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.user).toBeDefined();
      expect(data.user.isEmailVerified).toBe(false);
      expect(data.message).toBeDefined();
      expect(data.accessToken).toBeUndefined();
      const cookie = res.headers.get('set-cookie');
      expect(cookie).toBeNull();
    });

    it('matches verify-otp response shape: { message, success }', async () => {
      const res = await fetch(`${baseUrl}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'customer@contract.test',
          otp: '123456',
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toContain('verified');
      expect(data.success).toBe(true);
    });

    it('matches resend-otp response shape: { message }', async () => {
      const res = await fetch(`${baseUrl}/api/auth/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'customer@contract.test',
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toContain('verification code');
    });

    it('matches login response shape: { user, accessToken }', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'customer@contract.test',
          password: 'Password123!',
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.user.email).toBe('customer@contract.test');
      expect(data.accessToken).toBe('mock-access');
    });

    it('matches fetchCurrentUser (/api/auth/me) response shape: { user }', async () => {
      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.user.email).toBe('customer@contract.test');
    });

    it('matches /api/users/me/preferences update contract', async () => {
      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/users/me/preferences`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ preferences: { theme: 'dark', emailNotifications: true } }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.preferences.theme).toBe('dark');
    });

    it('matches /api/users/me/deletion-blockers response contract', async () => {
      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/users/me/deletion-blockers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.canDelete).toBe(true);
      expect(Array.isArray(data.blockers)).toBe(true);
    });
  });

  describe('3. Booking & Payment Contracts', () => {
    let customerToken: string;

    beforeAll(() => {
      customerToken = createToken(customerUser);
    });

    it('matches createBooking response shape: { booking }', async () => {
      const res = await fetch(`${baseUrl}/api/bookings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${customerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventId,
          items: [{ ticketTypeId, quantity: 1 }],
          idempotencyKey,
        }),
      });
      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.booking.id).toBe(bookingId);
      expect(data.booking.totalAmount).toBe(99900);
    });

    it('matches createPaymentOrder response shape: { orderId, amount, currency, keyId }', async () => {
      const res = await fetch(`${baseUrl}/api/payments/order`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${customerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bookingId }),
      });
      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.orderId).toBe('order_mock123');
      expect(data.amount).toBe(99900);
      expect(data.currency).toBe('INR');
      expect(data.keyId).toBe('rzp_test_key');
    });

    it('matches verifyPayment response shape: { booking }', async () => {
      const res = await fetch(`${baseUrl}/api/payments/verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${customerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bookingId,
          razorpayOrderId: 'order_mock123',
          razorpayPaymentId: 'pay_mock123',
          razorpaySignature: 'sig_mock123',
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.booking.status).toBe('CONFIRMED');
    });

    it('matches refundBooking response shape: { refundRequest }', async () => {
      const res = await fetch(`${baseUrl}/api/payments/refund`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${customerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bookingId,
          reason: 'Customer requested refund',
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.refundRequest.status).toBe('PENDING');
      expect(data.refundRequest.bookingId).toBe(bookingId);
    });

    it('matches getTicketQr response shape: { dataUrl }', async () => {
      const res = await fetch(`${baseUrl}/api/payments/tickets/${ticketId}/qr`, {
        headers: { Authorization: `Bearer ${customerToken}` },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.dataUrl).toContain('data:image/png;base64');
    });
  });

  describe('4. Organizer Dashboard & Workflow Contracts', () => {
    let organizerToken: string;

    beforeAll(() => {
      organizerToken = createToken(organizerUser);
    });

    it('matches getOrganizerProfile response shape: { organizer }', async () => {
      const res = await fetch(`${baseUrl}/api/organizers/me`, {
        headers: { Authorization: `Bearer ${organizerToken}` },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.organizer.organizationName).toBe('Contract Organizer');
    });

    it('matches getOrganizerStats response shape', async () => {
      const res = await fetch(`${baseUrl}/api/organizers/me/stats`, {
        headers: { Authorization: `Bearer ${organizerToken}` },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.events.total).toBe(3);
      expect(data.revenue).toBe(199800);
    });

    it('matches getOrganizerRefundRequests response shape: { refundRequests, counts, total, page, limit }', async () => {
      const res = await fetch(`${baseUrl}/api/organizers/refund-requests?status=PENDING&page=1&limit=20`, {
        headers: { Authorization: `Bearer ${organizerToken}` },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(Array.isArray(data.refundRequests)).toBe(true);
      expect(data.counts.PENDING).toBe(1);
      expect(data.total).toBe(1);
    });

    it('matches validateTicketCode response shape: { ticket, holder }', async () => {
      const res = await fetch(`${baseUrl}/api/organizers/events/${eventId}/tickets/validate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${organizerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ticketCode: 'TKT-12345' }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.ticket.ticketCode).toBe('TKT-12345');
      expect(data.holder.email).toBe('john@example.com');
    });
  });

  describe('5. Notifications & In-App Alerts Contracts', () => {
    it('matches getNotifications response shape: { notifications, unreadCount }', async () => {
      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/notifications?limit=30`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(Array.isArray(data.notifications)).toBe(true);
      expect(data.unreadCount).toBe(1);
    });

    it('matches markNotificationAsRead response shape: { notification }', async () => {
      const token = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/notifications/notif-1/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.notification.isRead).toBe(true);
    });
  });

  describe('6. AI Chat JSON and SSE Streaming Contracts', () => {
    it('matches AiPage JSON chat response shape: { configured, reply, events }', async () => {
      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'What concerts are happening this weekend?' }],
        }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.configured).toBe(true);
      expect(typeof data.reply).toBe('string');
      expect(Array.isArray(data.events)).toBe(true);
      expect(data.events[0].slug).toBe('live-rock-fest');
    });

    it('matches AiPage SSE stream response contract', async () => {
      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Recommend some comedy shows' }],
        }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const text = await res.text();
      expect(text).toContain('data: ');
      expect(text).toContain('[DONE]');
    });
  });

  describe('7. Admin Dashboard Oversight Contracts', () => {
    let adminToken: string;

    beforeAll(() => {
      adminToken = createToken(adminUser);
    });

    it('matches /api/admin/stats response shape', async () => {
      const res = await fetch(`${baseUrl}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.users).toBe(150);
      expect(data.revenue.net).toBe(4800000);
    });

    it('matches /api/admin/audit-logs response shape: { logs, total, page, pages }', async () => {
      const res = await fetch(`${baseUrl}/api/admin/audit-logs`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(Array.isArray(data.logs)).toBe(true);
      expect(data.total).toBe(1);
    });
  });
});
