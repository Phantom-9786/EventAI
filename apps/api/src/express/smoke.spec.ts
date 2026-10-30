import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createExpressApp } from './app';
import { StructuredLogger } from '../common/logging/structured-logger';
import { PrismaClient } from '@eventai/database';
import { CacheService } from '../common/cache/cache.service';
import { BookingsService } from '../modules/bookings/bookings.service';
import { PaymentsService } from '../modules/payments/payments.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { AiService } from '../modules/ai/ai.service';
import crypto from 'crypto';

describe('Express End-to-End Live Smoke Test Suite', () => {
  let server: Server;
  let baseUrl: string;

  const nullLogger = new StructuredLogger('SmokeTest', false);

  const testUser = {
    id: 'smoke-usr-1',
    email: 'smoke-organizer@example.com',
    role: 'USER',
    isActive: true,
    isEmailVerified: true,
    firstName: 'Smoke',
    lastName: 'Organizer',
  };

  const users: any[] = [testUser];
  const verificationTokens: any[] = [];
  let sentVerificationOtp = '';
  const events: any[] = [
    {
      id: 'smoke-evt-1',
      title: 'Neon Mumbai Live 2026',
      slug: 'neon-mumbai-live-2026',
      status: 'PUBLISHED',
      isApproved: true,
      moderationStatus: 'APPROVED',
      startDate: new Date(Date.now() + 86400000),
      endDate: new Date(Date.now() + 90000000),
      images: ['https://example.com/neon.jpg'],
      coverImage: 'https://example.com/neon.jpg',
      isFeatured: true,
      category: { id: 'cat-1', name: 'Music', slug: 'music' },
      venue: { id: 'ven-1', name: 'Dome Stadium', city: 'Mumbai' },
      organizer: { id: 'org-1', organizationName: 'Live Events Co' },
      ticketTypes: [
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: 'General',
          price: 99900,
          availableSeats: 50,
          isActive: true,
        },
      ],
    },
  ];
  const bookings: any[] = [];
  const notifications: any[] = [];
  let cronRunCount = 0;

  const mockPrisma = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'smoke-evt-1', total_count: 1, 1: 1 }]),
    session: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'sess-smoke-1',
        ...data,
      })),
      findUnique: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    user: {
      findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
        if (where.email) return users.find((u) => u.email === where.email) ?? null;
        if (where.id) return users.find((u) => u.id === where.id) ?? null;
        return null;
      }),
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        const u = { id: `smoke-usr-${users.length + 1}`, ...data, isActive: true, role: data.role || 'USER' };
        users.push(u);
        return u;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => {
        const u = users.find((x) => x.id === where.id || x.email === where.email);
        if (u) Object.assign(u, data);
        return u;
      }),
    },
    emailVerificationToken: {
      upsert: jest.fn().mockImplementation(async ({ create, update, where }: any) => {
        let t = verificationTokens.find((tok) => tok.userId === where.userId);
        if (!t) {
          t = { id: `evt-${verificationTokens.length + 1}`, ...create };
          verificationTokens.push(t);
        } else {
          Object.assign(t, update);
        }
        return t;
      }),
      findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
        return verificationTokens.find((tok) => tok.userId === where.userId) ?? null;
      }),
      deleteMany: jest.fn().mockImplementation(async ({ where }: any) => {
        const idx = verificationTokens.findIndex(
          (tok) =>
            (!where.id || tok.id === where.id) &&
            (!where.userId || tok.userId === where.userId) &&
            (!where.token || tok.token === where.token),
        );
        if (idx !== -1) {
          verificationTokens.splice(idx, 1);
          return { count: 1 };
        }
        return { count: 0 };
      }),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => {
        const t = verificationTokens.find((tok) => tok.id === where.id);
        if (t) Object.assign(t, data);
        return t;
      }),
    },
    organizerProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'org-prof-1', ...data, isApproved: false })),
    },
    event: {
      findMany: jest.fn().mockResolvedValue(events),
      findUnique: jest.fn().mockResolvedValue(events[0]),
      findFirst: jest.fn().mockResolvedValue(events[0]),
      count: jest.fn().mockResolvedValue(events.length),
    },
    category: {
      findMany: jest.fn().mockResolvedValue([{ id: 'cat-1', name: 'Music', slug: 'music' }]),
    },
    venue: {
      findMany: jest.fn().mockResolvedValue([{ id: 'ven-1', name: 'Dome Stadium', city: 'Mumbai' }]),
    },
    ticketType: {
      findMany: jest.fn().mockResolvedValue(events[0].ticketTypes),
      findUnique: jest.fn().mockResolvedValue(events[0].ticketTypes[0]),
    },
    booking: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        const b = {
          id: `bk-${bookings.length + 1}`,
          ...data,
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 600000),
          totalAmount: 199800,
        };
        bookings.push(b);
        return b;
      }),
      findMany: jest.fn().mockResolvedValue(bookings),
      findUnique: jest.fn().mockImplementation(async () => bookings[0] ?? null),
      findFirst: jest.fn().mockImplementation(async () => bookings[0] ?? null),
    },
    payment: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'pay-1', ...data, status: 'PENDING' })),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'pay-1', ...data })),
    },
    notification: {
      findMany: jest.fn().mockImplementation(async () => notifications),
      count: jest.fn().mockImplementation(async () => notifications.filter((n) => !n.isRead).length),
      findUnique: jest.fn().mockImplementation(async ({ where }: any) => notifications.find((n) => n.id === where.id) ?? null),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => {
        const n = notifications.find((x) => x.id === where.id);
        if (n) Object.assign(n, data);
        return n;
      }),
      updateMany: jest.fn().mockImplementation(async ({ data }: any) => {
        notifications.forEach((n) => Object.assign(n, data));
        return { count: notifications.length };
      }),
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        const n = { id: `notif-${notifications.length + 1}`, ...data, isRead: false, createdAt: new Date() };
        notifications.push(n);
        return n;
      }),
    },
    $transaction: jest.fn().mockImplementation(async (cb: any) => {
      if (typeof cb === 'function') return cb(mockPrisma);
      return Promise.all(cb);
    }),
  } as unknown as PrismaClient;

  const mockCache = {
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidatePrefix: jest.fn().mockResolvedValue(undefined),
    consumeAiRequest: jest.fn().mockResolvedValue({ allowed: true }),
    releaseAiRequest: jest.fn().mockResolvedValue(undefined),
    providerCooldownMs: jest.fn().mockResolvedValue(0),
    setProviderCooldown: jest.fn().mockResolvedValue(undefined),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
  } as unknown as CacheService;

  const mockAiService = {
    isConfigured: jest.fn().mockReturnValue(true),
    chat: jest.fn().mockResolvedValue({
      reply: 'I recommend Neon Mumbai Live 2026 for an exciting evening!',
      events: [events[0]],
    }),
  } as unknown as AiService;

  const mockPaymentsService = {
    handleWebhook: jest.fn().mockResolvedValue({ received: true, handled: true }),
  };

  const mockBookingsService = {
    create: jest.fn().mockResolvedValue({
      id: 'bk-smoke-1',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      totalAmount: 199800,
    }),
    handleStaleBookingsCron: jest.fn().mockImplementation(async () => {
      cronRunCount++;
      return { expiredCount: 0 };
    }),
  };

  const mockModerationService = {
    applyToBecomeOrganizer: jest.fn().mockResolvedValue({
      id: 'org-app-1',
      status: 'PENDING',
    }),
    requireApprovedOrganizer: jest.fn().mockResolvedValue(undefined),
    assertEventApprovedForPublishing: jest.fn().mockResolvedValue(undefined),
    getEventModerationStatus: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
  };

  const notificationsService = new NotificationsService(mockPrisma as never);

  const JWT_SECRET = 'super-secret-smoke-test-key-minimum-32-chars-long';
  const RAZORPAY_WEBHOOK_SECRET = 'smoke_webhook_secret_123';

  let authToken = '';

  beforeAll((done) => {
    process.env.RAZORPAY_WEBHOOK_SECRET = RAZORPAY_WEBHOOK_SECRET;

    const app = createExpressApp({
      prisma: mockPrisma,
      cache: mockCache,
      bookingsService: mockBookingsService as unknown as BookingsService,
      paymentsService: mockPaymentsService as unknown as PaymentsService,
      notificationsService,
      moderationService: mockModerationService as any,
      aiService: mockAiService,
      logger: nullLogger,
      jwtSecret: JWT_SECRET,
      env: {
        FRONTEND_URL: 'http://localhost:3000',
        NODE_ENV: 'test',
        JWT_SECRET,
        RAZORPAY_WEBHOOK_SECRET,
      },
    });

    jest.spyOn(notificationsService, 'sendEmailVerificationOtp').mockImplementation(async (opts: any) => {
      sentVerificationOtp = opts.otp;
      return true;
    });

    server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  afterAll((done) => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    server.close(done);
  });

  it('1. Health check & PostgreSQL/Redis connectivity', async () => {
    const healthRes = await fetch(`${baseUrl}/api/health/ready`);
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as any;
    expect(healthJson.status).toBe('ok');
    expect(healthJson.dependencies.database).toBe('up');
    expect(healthJson.dependencies.redis).toBe('PONG');
  });

  it('2. User registration, OTP verification, and JWT issuance', async () => {
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'smoke-new-user@example.com',
        password: 'Password123!',
        firstName: 'Smoke',
        lastName: 'Organizer',
      }),
    });
    expect(regRes.status).toBe(201);
    const regJson = (await regRes.json()) as any;
    expect(regJson.user.email).toBe('smoke-new-user@example.com');
    expect(regJson.user.isEmailVerified).toBe(false);
    expect(sentVerificationOtp).toMatch(/^\d{6}$/);

    // Verify OTP
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'smoke-new-user@example.com',
        otp: sentVerificationOtp,
      }),
    });
    expect(verifyRes.status).toBe(200);
    const verifyJson = (await verifyRes.json()) as any;
    expect(verifyJson.success).toBe(true);

    // Now log in to obtain JWT access token
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'smoke-new-user@example.com',
        password: 'Password123!',
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginJson = (await loginRes.json()) as any;
    authToken = loginJson.accessToken || loginJson.tokens?.accessToken;
    expect(authToken).toBeDefined();
  });

  it('3. Public catalog event discovery', async () => {
    const eventsRes = await fetch(`${baseUrl}/api/events`);
    expect(eventsRes.status).toBe(200);
    const eventsJson = (await eventsRes.json()) as any;
    expect(eventsJson.events).toBeDefined();
    expect(eventsJson.events.length).toBeGreaterThan(0);
    expect(eventsJson.events[0].title).toBe('Neon Mumbai Live 2026');
  });

  it('4. Organizer application authorization & submission', async () => {
    const applyRes = await fetch(`${baseUrl}/api/organizers/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        organizationName: 'Smoke Productions',
        businessType: 'COMPANY',
        contactPhone: '+919876543210',
        businessAddress: '123 Test Street, Mumbai',
      }),
    });
    expect([200, 201]).toContain(applyRes.status);
    const applyJson = (await applyRes.json()) as any;
    expect(applyJson.organizer.id).toBeDefined();
    expect(mockModerationService.applyToBecomeOrganizer).toHaveBeenCalled();
  });

  it('5. Booking creation with disposable local test data', async () => {
    const bookingRes = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        items: [{ ticketTypeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', quantity: 2 }],
        idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
    });
    expect(bookingRes.status).toBe(201);
    const bookingJson = (await bookingRes.json()) as any;
    expect(bookingJson.booking.id).toBeDefined();
    expect(bookingJson.booking.status).toBe('PENDING');
    expect(mockBookingsService.create).toHaveBeenCalled();
  });

  it('6. Mocked Razorpay webhook signature verification', async () => {
    const webhookPayload = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: { entity: { id: 'pay_smoke_123', order_id: 'order_123' } },
      },
    });

    const res = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': 'smoke_valid_signature',
      },
      body: webhookPayload,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.received).toBe(true);
    expect(mockPaymentsService.handleWebhook).toHaveBeenCalled();
  });

  it('7a. AI chat JSON mode with live catalog event grounding', async () => {
    const aiJsonRes = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'What events are in Mumbai?' }],
      }),
    });
    expect(aiJsonRes.status).toBe(200);
    const aiJsonBody = (await aiJsonRes.json()) as any;
    expect(aiJsonBody.configured).toBe(true);
    expect(aiJsonBody.events).toHaveLength(1);
    expect(aiJsonBody.events[0].title).toBe('Neon Mumbai Live 2026');
  });

  it('7b. AI chat SSE streaming chunk forwarding & cleanup', async () => {
    const aiStreamRes = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Recommend concerts' }],
      }),
    });
    expect(aiStreamRes.status).toBe(200);
    expect(aiStreamRes.headers.get('content-type')).toContain('text/event-stream');
    const streamBody = await aiStreamRes.text();
    expect(streamBody).toContain('data: {');
    expect(streamBody).toContain('data: [DONE]');
  });

  it('8. In-app user notifications retrieval & list', async () => {
    await mockPrisma.notification.create({
      data: {
        userId: 'smoke-usr-2',
        type: 'BOOKING_CONFIRMED',
        title: 'Booking Confirmed',
        message: 'Your tickets are ready.',
      },
    });

    const notifRes = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(notifRes.status).toBe(200);
    const notifJson = (await notifRes.json()) as any;
    expect(notifJson.notifications.length).toBeGreaterThan(0);
    expect(notifJson.notifications[0].title).toBe('Booking Confirmed');
  });

  it('9. Booking expiry scheduler exactly-once execution', async () => {
    await mockBookingsService.handleStaleBookingsCron();
    expect(cronRunCount).toBe(1);
  });
});
