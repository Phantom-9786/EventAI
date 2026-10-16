import type { Server } from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { createExpressApp } from './app';
import { AdminService } from '../modules/admin/admin.service';
import { PaymentsService } from '../modules/payments/payments.service';
import { ExpressModerationService } from './services/moderation.service';
import { UserRole } from '@eventai/types';
import { StructuredLogger } from '../common/logging/structured-logger';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('Express Admin Module & Authorization Security', () => {
  let server: Server;
  let baseUrl: string;
  const JWT_SECRET = 'super-secret-admin-test-jwt-key-32-chars-long';

  const nullLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    logWithMeta: jest.fn(),
  } as unknown as StructuredLogger;

  const validUuid = '11111111-2222-4333-8444-555555555555';
  const adminId = '33333333-3333-4333-8333-333333333333';
  const organizerId = '22222222-2222-4222-8222-222222222222';
  const customerId = '11111111-1111-4111-8111-111111111111';

  const customerUser = {
    id: customerId,
    email: 'customer@example.com',
    role: UserRole.CUSTOMER,
    isActive: true,
  };

  const organizerUser = {
    id: organizerId,
    email: 'organizer@example.com',
    role: UserRole.ORGANIZER,
    isActive: true,
  };

  const adminUser = {
    id: adminId,
    email: 'admin@example.com',
    role: UserRole.ADMIN,
    isActive: true,
  };

  let mockPrisma: any;
  let mockAdminService: any;
  let mockPaymentsService: any;
  let mockModerationService: any;

  function createToken(
    user: { id: string; email: string; role: UserRole },
    expiresIn = '1h',
  ): string {
    return jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn },
    );
  }

  beforeAll((done) => {
    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === customerUser.id) return Promise.resolve(customerUser);
          if (where.id === organizerUser.id) return Promise.resolve(organizerUser);
          if (where.id === adminUser.id) return Promise.resolve(adminUser);
          return Promise.resolve(null);
        }),
      },
    };

    mockAdminService = {
      platformStats: jest.fn().mockResolvedValue({ users: 42, revenue: 100000 }),
      invalidateEventCache: jest.fn().mockResolvedValue(undefined),
      listUsers: jest.fn().mockResolvedValue({ users: [], total: 0 }),
      setUserStatus: jest.fn().mockImplementation((adminUserId, targetUserId, input) => {
        if (adminUserId === targetUserId && !input.isActive) {
          throw new BadRequestException('You cannot deactivate your own admin account');
        }
        return Promise.resolve({ id: targetUserId, isActive: input.isActive });
      }),
      listBookings: jest.fn().mockResolvedValue({ bookings: [], total: 0 }),
      getBooking: jest.fn().mockResolvedValue({ id: validUuid, totalAmount: 5000 }),
      listOrganizers: jest.fn().mockResolvedValue({ organizers: [], total: 0 }),
      setOrganizerVerification: jest.fn().mockResolvedValue({ id: validUuid, isVerified: true }),
      listEvents: jest.fn().mockResolvedValue({ events: [], total: 0 }),
      moderateEvent: jest.fn().mockResolvedValue({ id: validUuid, status: 'CANCELLED' }),
      listAuditLogs: jest.fn().mockResolvedValue({ logs: [], total: 0 }),
    };

    mockPaymentsService = {
      reconcileRefund: jest.fn().mockResolvedValue({ bookingId: validUuid, status: 'REFUNDED' }),
      recoverApprovedRefund: jest.fn().mockResolvedValue({ booking: { id: validUuid } }),
    };

    mockModerationService = {
      listPendingOrganizerApplications: jest.fn().mockResolvedValue([]),
      approveOrganizerApplication: jest.fn().mockResolvedValue({ id: validUuid, isVerified: true }),
      rejectOrganizerApplication: jest.fn().mockResolvedValue({ id: validUuid, isVerified: false }),
      reviewEvent: jest.fn().mockResolvedValue({ id: validUuid, status: 'APPROVED' }),
      getEventModerationStatus: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
    };

    const app = createExpressApp({
      prisma: mockPrisma,
      adminService: mockAdminService as unknown as AdminService,
      paymentsService: mockPaymentsService as unknown as PaymentsService,
      moderationService: mockModerationService as unknown as ExpressModerationService,
      jwtSecret: JWT_SECRET,
      logger: nullLogger,
      env: {
        JWT_SECRET,
        FRONTEND_URL: 'http://localhost:3000',
        NODE_ENV: 'test',
      },
    });

    server = app.listen(0, () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Unauthenticated and Invalid JWT Access', () => {
    it('rejects unauthenticated requests to /api/admin/stats with 401 Unauthorized', async () => {
      const res = await fetch(`${baseUrl}/api/admin/stats`);
      expect(res.status).toBe(401);
      const body = (await res.json()) as any;
      expect(body.success).toBe(false);
      expect(body.statusCode).toBe(401);
      expect(mockAdminService.platformStats).not.toHaveBeenCalled();
    });

    it('rejects requests with malformed Authorization header with 401', async () => {
      const res = await fetch(`${baseUrl}/api/admin/stats`, {
        headers: { Authorization: 'NotBearer token123' },
      });
      expect(res.status).toBe(401);
    });

    it('rejects requests with an expired JWT token with 401', async () => {
      const expiredToken = createToken(adminUser, '-1s');
      const res = await fetch(`${baseUrl}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${expiredToken}` },
      });
      expect(res.status).toBe(401);
    });

    it('rejects requests with a JWT signed with an untrusted secret with 401', async () => {
      const untrustedToken = jwt.sign(
        { sub: adminId, email: adminUser.email, role: 'ADMIN' },
        'completely-different-and-untrusted-secret-key-32',
      );
      const res = await fetch(`${baseUrl}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${untrustedToken}` },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Role-Based Access Control (RBAC) Enforcement', () => {
    it('blocks ordinary CUSTOMER users from accessing /api/admin/stats with 403 Forbidden', async () => {
      const customerToken = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${customerToken}` },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      expect(body.success).toBe(false);
      expect(body.statusCode).toBe(403);
      expect(body.message).toContain('do not have permission');
      expect(mockAdminService.platformStats).not.toHaveBeenCalled();
    });

    it('blocks ORGANIZER users from accessing /api/admin/users with 403 Forbidden', async () => {
      const organizerToken = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/admin/users`, {
        headers: { Authorization: `Bearer ${organizerToken}` },
      });
      expect(res.status).toBe(403);
      expect(mockAdminService.listUsers).not.toHaveBeenCalled();
    });

    it('blocks ORGANIZER users from moderating events with 403 Forbidden', async () => {
      const organizerToken = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/admin/events/${validUuid}/moderate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${organizerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'CANCEL', reason: 'Attempted privilege escalation' }),
      });
      expect(res.status).toBe(403);
      expect(mockAdminService.moderateEvent).not.toHaveBeenCalled();
    });

    it('blocks CUSTOMER users from accessing audit logs with 403 Forbidden', async () => {
      const customerToken = createToken(customerUser);
      const res = await fetch(`${baseUrl}/api/admin/audit-logs`, {
        headers: { Authorization: `Bearer ${customerToken}` },
      });
      expect(res.status).toBe(403);
      expect(mockAdminService.listAuditLogs).not.toHaveBeenCalled();
    });
  });

  describe('Authorized Admin Operations & Parameter Validation', () => {
    let adminToken: string;

    beforeAll(() => {
      adminToken = createToken(adminUser);
    });

    it('allows ADMIN to access /api/admin/stats', async () => {
      const res = await fetch(`${baseUrl}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.users).toBe(42);
      expect(mockAdminService.platformStats).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid non-UUID parameters with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/admin/users/not-a-uuid/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: false }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.success).toBe(false);
      expect(body.message).toBe('Validation failed (uuid is expected)');
    });

    it('prevents administrator from deactivating their own admin account', async () => {
      const res = await fetch(`${baseUrl}/api/admin/users/${adminId}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: false }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.message).toContain('You cannot deactivate your own admin account');
    });

    it('allows administrator to activate or deactivate another user', async () => {
      const res = await fetch(`${baseUrl}/api/admin/users/${validUuid}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: false }),
      });
      expect(res.status).toBe(200);
      expect(mockAdminService.setUserStatus).toHaveBeenCalledWith(adminId, validUuid, {
        isActive: false,
      });
    });

    it('allows administrator to inspect booking detail', async () => {
      const res = await fetch(`${baseUrl}/api/admin/bookings/${validUuid}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.booking.id).toBe(validUuid);
      expect(mockAdminService.getBooking).toHaveBeenCalledWith(validUuid);
    });

    it('allows administrator to reconcile a refund', async () => {
      const res = await fetch(`${baseUrl}/api/admin/bookings/${validUuid}/refund/reconcile`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      expect(mockPaymentsService.reconcileRefund).toHaveBeenCalledWith(adminId, validUuid);
    });

    it('allows administrator to recover an approved refund', async () => {
      const res = await fetch(`${baseUrl}/api/admin/bookings/${validUuid}/refund/recover`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      expect(mockPaymentsService.recoverApprovedRefund).toHaveBeenCalledWith(adminId, validUuid);
    });

    it('allows administrator to approve an organizer application', async () => {
      const res = await fetch(`${baseUrl}/api/admin/organizers/${validUuid}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      expect(mockModerationService.approveOrganizerApplication).toHaveBeenCalledWith(
        adminId,
        validUuid,
      );
    });

    it('allows administrator to reject an organizer application with reason', async () => {
      const res = await fetch(`${baseUrl}/api/admin/organizers/${validUuid}/reject`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Incomplete documentation' }),
      });
      expect(res.status).toBe(200);
      expect(mockModerationService.rejectOrganizerApplication).toHaveBeenCalledWith(
        adminId,
        validUuid,
        'Incomplete documentation',
      );
    });

    it('allows administrator to list audit logs', async () => {
      const res = await fetch(`${baseUrl}/api/admin/audit-logs?entity=USER`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      expect(mockAdminService.listAuditLogs).toHaveBeenCalled();
    });

    it('allows administrator to list pending organizer applications', async () => {
      mockModerationService.listPendingOrganizerApplications.mockResolvedValueOnce([
        { id: validUuid, organizationName: 'Tech Events Co' },
      ]);

      const res = await fetch(`${baseUrl}/api/admin/organizers/applications/pending`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.applications).toHaveLength(1);
      expect(mockModerationService.listPendingOrganizerApplications).toHaveBeenCalled();
    });

    it('allows administrator to set organizer verification status', async () => {
      const res = await fetch(`${baseUrl}/api/admin/organizers/${validUuid}/verification`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isVerified: true }),
      });
      expect(res.status).toBe(200);
      expect(mockAdminService.setOrganizerVerification).toHaveBeenCalledWith(adminId, validUuid, {
        isVerified: true,
      });
    });

    it('allows administrator to list events with moderation status', async () => {
      mockAdminService.listEvents.mockResolvedValueOnce({
        events: [{ id: validUuid, title: 'Sample Summit' }],
        total: 1,
      });
      mockModerationService.getEventModerationStatus.mockResolvedValueOnce({
        status: 'PENDING_APPROVAL',
      });

      const res = await fetch(`${baseUrl}/api/admin/events`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.events).toHaveLength(1);
      expect(body.events[0].moderation.status).toBe('PENDING_APPROVAL');
    });

    it('allows administrator to review event with approve action (POST /api/admin/events/:id/review)', async () => {
      mockModerationService.reviewEvent.mockResolvedValueOnce({
        id: validUuid,
        status: 'APPROVED',
      });

      const res = await fetch(`${baseUrl}/api/admin/events/${validUuid}/review`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'APPROVE', reason: 'Verified venue and details' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.message).toContain('approved');
      expect(mockModerationService.reviewEvent).toHaveBeenCalledWith(adminId, validUuid, {
        action: 'APPROVE',
        reason: 'Verified venue and details',
      });
    });

    it('allows administrator to review event with reject action (POST /api/admin/events/:id/review)', async () => {
      mockModerationService.reviewEvent.mockResolvedValueOnce({
        id: validUuid,
        status: 'REJECTED',
      });

      const res = await fetch(`${baseUrl}/api/admin/events/${validUuid}/review`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'REJECT', reason: 'Insufficient ticket info' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.message).toContain('rejected');
    });

    it('allows administrator to moderate event status directly (POST /api/admin/events/:id/moderate)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/events/${validUuid}/moderate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'CANCEL', reason: 'Policy violation' }),
      });
      expect(res.status).toBe(200);
      expect(mockAdminService.moderateEvent).toHaveBeenCalledWith(adminId, validUuid, {
        action: 'CANCEL',
        reason: 'Policy violation',
      });
    });

    it('returns 404 Not Found when inspecting non-existent booking', async () => {
      mockAdminService.getBooking.mockRejectedValueOnce(new NotFoundException('Booking not found'));

      const res = await fetch(`${baseUrl}/api/admin/bookings/${validUuid}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.message).toBe('Booking not found');
    });

    it('blocks non-admin users from reviewing events with 403 Forbidden', async () => {
      const organizerToken = createToken(organizerUser);
      const res = await fetch(`${baseUrl}/api/admin/events/${validUuid}/review`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${organizerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'APPROVE' }),
      });
      expect(res.status).toBe(403);
    });
  });
});
