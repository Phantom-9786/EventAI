import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createExpressApp } from './app';
import { StructuredLogger } from '../common/logging/structured-logger';
import { PrismaClient } from '@eventai/database';
import { CacheService } from '../common/cache/cache.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import jwt from 'jsonwebtoken';

describe('Express Notifications Module', () => {
  let server: Server;
  let baseUrl: string;

  const JWT_SECRET = 'test-secret-at-least-32-chars-long-notifications';
  const testUser = {
    id: 'user-notif-1',
    email: 'notif-user@example.com',
    role: 'USER',
    name: 'Notification Tester',
    avatar: null,
    isActive: true,
  };

  const userToken = jwt.sign(
    { sub: testUser.id, email: testUser.email, role: testUser.role },
    JWT_SECRET,
    { expiresIn: '1h' },
  );

  const nullLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    logWithMeta: jest.fn(),
  } as unknown as StructuredLogger;

  const mockPrisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
    user: {
      findUnique: jest.fn().mockResolvedValue(testUser),
    },
    notification: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  } as unknown as PrismaClient;

  const mockCache = {
    ping: jest.fn().mockResolvedValue('PONG'),
  } as unknown as CacheService;

  let mockNotificationsService: {
    getUserNotifications: jest.Mock;
    markAsRead: jest.Mock;
    markAllAsRead: jest.Mock;
  };

  beforeAll((done) => {
    mockNotificationsService = {
      getUserNotifications: jest.fn().mockResolvedValue({
        notifications: [
          {
            id: 'notif-1',
            userId: testUser.id,
            type: 'BOOKING_CONFIRMED',
            title: 'Booking Confirmed!',
            message: 'Your booking has been confirmed.',
            isRead: false,
            createdAt: new Date().toISOString(),
          },
        ],
        unreadCount: 1,
      }),
      markAsRead: jest.fn().mockResolvedValue({
        id: 'notif-1',
        userId: testUser.id,
        isRead: true,
        readAt: new Date().toISOString(),
      }),
      markAllAsRead: jest.fn().mockResolvedValue({ success: true }),
    };

    const app = createExpressApp({
      prisma: mockPrisma,
      cache: mockCache,
      notificationsService: mockNotificationsService as unknown as NotificationsService,
      logger: nullLogger,
      jwtSecret: JWT_SECRET,
      env: {
        FRONTEND_URL: 'http://localhost:3000',
        NODE_ENV: 'test',
        JWT_SECRET,
      },
    });

    server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await fetch(`${baseUrl}/api/notifications`);
    expect(res.status).toBe(401);
  });

  it('lists notifications for authenticated user on GET /api/notifications', async () => {
    const res = await fetch(`${baseUrl}/api/notifications?limit=10`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.unreadCount).toBe(1);
    expect(json.notifications).toHaveLength(1);
    expect(mockNotificationsService.getUserNotifications).toHaveBeenCalledWith(testUser.id, 10);
  });

  it('marks a notification as read on PATCH /api/notifications/:id/read', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/notif-1/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${userToken}` },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.notification.isRead).toBe(true);
    expect(mockNotificationsService.markAsRead).toHaveBeenCalledWith(testUser.id, 'notif-1');
  });

  it('rejects unauthenticated requests on PATCH /api/notifications/:id/read with 401', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/notif-1/read`, { method: 'PATCH' });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated requests on POST /api/notifications/read-all with 401', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/read-all`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('marks all notifications as read on POST /api/notifications/read-all', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/read-all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(mockNotificationsService.markAllAsRead).toHaveBeenCalledWith(testUser.id);
  });

  it('applies default limit of 30 when limit is omitted on GET /api/notifications', async () => {
    const res = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });

    expect(res.status).toBe(200);
    expect(mockNotificationsService.getUserNotifications).toHaveBeenCalledWith(testUser.id, 30);
  });

  it('clamps limit to max 100 when excessive limit is requested on GET /api/notifications', async () => {
    const res = await fetch(`${baseUrl}/api/notifications?limit=500`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });

    expect(res.status).toBe(200);
    expect(mockNotificationsService.getUserNotifications).toHaveBeenCalledWith(testUser.id, 100);
  });

  it('handles empty notifications list cleanly ({ notifications: [], unreadCount: 0 })', async () => {
    mockNotificationsService.getUserNotifications.mockResolvedValueOnce({
      notifications: [],
      unreadCount: 0,
    });

    const res = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.unreadCount).toBe(0);
    expect(json.notifications).toHaveLength(0);
  });

  it('returns 404 Not Found when marking non-existent or unowned notification as read', async () => {
    const { NotFoundException } = await import('../common/exceptions');
    mockNotificationsService.markAsRead.mockRejectedValueOnce(
      new NotFoundException('Notification not found'),
    );

    const res = await fetch(`${baseUrl}/api/notifications/notif-missing/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${userToken}` },
    });

    expect(res.status).toBe(404);
    const json = (await res.json()) as any;
    expect(json.message).toBe('Notification not found');
  });
});
