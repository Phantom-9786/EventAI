import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PaymentsService } from '../payments/payments.service';
import {
  adminAuditLogListSchema,
  adminBookingListSchema,
  adminEventListSchema,
  adminModerateEventSchema,
  adminOrganizerListSchema,
  adminSetOrganizerVerificationSchema,
  adminSetUserStatusSchema,
  adminUserListSchema,
  idParamSchema,
} from '@eventai/validation';

describe('AdminController', () => {
  let controller: AdminController;
  let adminService: {
    platformStats: jest.Mock;
    listUsers: jest.Mock;
    listBookings: jest.Mock;
    getBooking: jest.Mock;
    setUserStatus: jest.Mock;
    listEvents: jest.Mock;
    moderateEvent: jest.Mock;
    listOrganizers: jest.Mock;
    setOrganizerVerification: jest.Mock;
    listAuditLogs: jest.Mock;
  };
  let paymentsService: {
    reconcileRefund: jest.Mock;
    recoverApprovedRefund: jest.Mock;
  };
  let reflector: Reflector;
  let rolesGuard: RolesGuard;

  const validUuid = '11111111-2222-3333-4444-555555555555';

  beforeEach(async () => {
    adminService = {
      platformStats: jest.fn().mockResolvedValue({ users: 10 }),
      listUsers: jest.fn().mockResolvedValue({ users: [], total: 0 }),
      listBookings: jest.fn().mockResolvedValue({ bookings: [], total: 0 }),
      getBooking: jest.fn().mockResolvedValue({ id: validUuid, totalAmount: 1000 }),
      setUserStatus: jest.fn().mockResolvedValue({ id: validUuid, isActive: false }),
      listEvents: jest.fn().mockResolvedValue({ events: [], total: 0 }),
      moderateEvent: jest.fn().mockResolvedValue({ id: validUuid, status: 'CANCELLED' }),
      listOrganizers: jest.fn().mockResolvedValue({ organizers: [], total: 0 }),
      setOrganizerVerification: jest.fn().mockResolvedValue({ id: validUuid, isVerified: true }),
      listAuditLogs: jest.fn().mockResolvedValue({ logs: [], total: 0 }),
    };

    paymentsService = {
      reconcileRefund: jest.fn().mockResolvedValue({ bookingId: validUuid, status: 'REFUNDED' }),
      recoverApprovedRefund: jest.fn().mockResolvedValue({ booking: { id: validUuid } }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: adminService },
        { provide: PaymentsService, useValue: paymentsService },
        Reflector,
        RolesGuard,
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
    reflector = module.get<Reflector>(Reflector);
    rolesGuard = module.get<RolesGuard>(RolesGuard);
  });

  // ── Endpoint delegation ─────────────────────────────

  describe('endpoint delegations', () => {
    it('delegates stats() to AdminService.platformStats', async () => {
      const result = await controller.stats();
      expect(adminService.platformStats).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ users: 10 });
    });

    it('delegates listUsers() to AdminService.listUsers', async () => {
      const query = { page: 1, limit: 10 };
      await controller.listUsers(query);
      expect(adminService.listUsers).toHaveBeenCalledWith(query);
    });

    it('delegates listBookings() to AdminService.listBookings', async () => {
      const query = { page: 1, limit: 10, status: 'CONFIRMED' };
      await controller.listBookings(query);
      expect(adminService.listBookings).toHaveBeenCalledWith(query);
    });

    it('delegates bookingDetail() to AdminService.getBooking', async () => {
      const result = await controller.bookingDetail({ id: validUuid });
      expect(adminService.getBooking).toHaveBeenCalledWith(validUuid);
      expect(result).toEqual({ booking: { id: validUuid, totalAmount: 1000 } });
    });

    it('delegates reconcileRefund() to PaymentsService.reconcileRefund', async () => {
      const result = await controller.reconcileRefund('admin-id', { id: validUuid });
      expect(paymentsService.reconcileRefund).toHaveBeenCalledWith('admin-id', validUuid);
      expect(result).toEqual({ bookingId: validUuid, status: 'REFUNDED' });
    });

    it('delegates recoverRefund() to PaymentsService.recoverApprovedRefund', async () => {
      const result = await controller.recoverRefund('admin-id', { id: validUuid });
      expect(paymentsService.recoverApprovedRefund).toHaveBeenCalledWith('admin-id', validUuid);
      expect(result).toEqual({ booking: { id: validUuid } });
    });

    it('delegates setUserStatus() to AdminService.setUserStatus', async () => {
      const body = { isActive: false };
      const result = await controller.setUserStatus('admin-id', { id: validUuid }, body);
      expect(adminService.setUserStatus).toHaveBeenCalledWith('admin-id', validUuid, body);
      expect(result).toEqual({ id: validUuid, isActive: false });
    });

    it('delegates listEvents() to AdminService.listEvents', async () => {
      const query = { page: 1, limit: 20 };
      await controller.listEvents(query);
      expect(adminService.listEvents).toHaveBeenCalledWith(query);
    });

    it('delegates moderateEvent() to AdminService.moderateEvent', async () => {
      const body = { action: 'CANCEL' as const, reason: 'Fraudulent activity' };
      const result = await controller.moderateEvent('admin-id', { id: validUuid }, body);
      expect(adminService.moderateEvent).toHaveBeenCalledWith('admin-id', validUuid, body);
      expect(result).toEqual({ id: validUuid, status: 'CANCELLED' });
    });

    it('delegates listOrganizers() to AdminService.listOrganizers', async () => {
      const query = { page: 1, limit: 10 };
      await controller.listOrganizers(query);
      expect(adminService.listOrganizers).toHaveBeenCalledWith(query);
    });

    it('delegates setOrganizerVerification() to AdminService.setOrganizerVerification', async () => {
      const body = { isVerified: true };
      const result = await controller.setOrganizerVerification('admin-id', { id: validUuid }, body);
      expect(adminService.setOrganizerVerification).toHaveBeenCalledWith('admin-id', validUuid, body);
      expect(result).toEqual({ id: validUuid, isVerified: true });
    });

    it('delegates listAuditLogs() to AdminService.listAuditLogs', async () => {
      const query = { page: 1, limit: 10, entity: 'USER' };
      await controller.listAuditLogs(query);
      expect(adminService.listAuditLogs).toHaveBeenCalledWith(query);
    });
  });

  // ── Authorization & RBAC metadata ───────────────────

  describe('authorization metadata and RBAC', () => {
    const endpoints: (keyof AdminController)[] = [
      'stats',
      'listUsers',
      'listBookings',
      'bookingDetail',
      'reconcileRefund',
      'recoverRefund',
      'setUserStatus',
      'listEvents',
      'moderateEvent',
      'listOrganizers',
      'setOrganizerVerification',
      'listAuditLogs',
    ];

    it.each(endpoints)('%s requires ADMIN role metadata', (methodName) => {
      const handler = controller[methodName];
      const roles = reflector.get<string[]>(ROLES_KEY, handler);
      expect(roles).toEqual(['ADMIN']);
    });

    it.each(endpoints)('%s is never decorated with @Public()', (methodName) => {
      const handler = controller[methodName];
      const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, handler);
      expect(isPublic).toBeUndefined();
    });

    // eslint-disable-next-line @typescript-eslint/ban-types
    const createMockExecutionContext = (user: unknown, handler: Function) => {
      return {
        getHandler: () => handler,
        getClass: () => AdminController,
        switchToHttp: () => ({
          getRequest: () => ({ user }),
        }),
      } as any;
    };

    it('blocks anonymous requests without authenticated user with 403', () => {
      const ctx = createMockExecutionContext(undefined, controller.stats);
      expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('blocks authenticated CUSTOMER users with 403', () => {
      const customerUser = { id: 'cust-1', email: 'cust@test.com', role: 'CUSTOMER' };
      const ctx = createMockExecutionContext(customerUser, controller.listUsers);
      expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('blocks authenticated ORGANIZER users with 403', () => {
      const organizerUser = { id: 'org-1', email: 'org@test.com', role: 'ORGANIZER' };
      const ctx = createMockExecutionContext(organizerUser, controller.recoverRefund);
      expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('permits authenticated ADMIN users', () => {
      const adminUser = { id: 'admin-1', email: 'admin@eventai.test', role: 'ADMIN' };
      const ctx = createMockExecutionContext(adminUser, controller.bookingDetail);
      expect(rolesGuard.canActivate(ctx)).toBe(true);
    });
  });

  // ── Request validation schemas ──────────────────────

  describe('request validation schemas', () => {
    it('validates UUID idParamSchema', () => {
      expect(idParamSchema.safeParse({ id: validUuid }).success).toBe(true);
      expect(idParamSchema.safeParse({ id: 'invalid-id' }).success).toBe(false);
      expect(idParamSchema.safeParse({}).success).toBe(false);
    });

    it('validates adminSetUserStatusSchema', () => {
      expect(adminSetUserStatusSchema.safeParse({ isActive: true }).success).toBe(true);
      expect(adminSetUserStatusSchema.safeParse({ isActive: false }).success).toBe(true);
      expect(adminSetUserStatusSchema.safeParse({ isActive: 'true' }).success).toBe(false);
    });

    it('validates adminModerateEventSchema', () => {
      expect(adminModerateEventSchema.safeParse({ action: 'CANCEL' }).success).toBe(true);
      expect(adminModerateEventSchema.safeParse({ action: 'CANCEL', reason: 'TOS violation' }).success).toBe(true);
      expect(adminModerateEventSchema.safeParse({ action: 'DELETE' }).success).toBe(false);
    });

    it('validates adminSetOrganizerVerificationSchema', () => {
      expect(adminSetOrganizerVerificationSchema.safeParse({ isVerified: true }).success).toBe(true);
      expect(adminSetOrganizerVerificationSchema.safeParse({ isVerified: false }).success).toBe(true);
      expect(adminSetOrganizerVerificationSchema.safeParse({}).success).toBe(false);
    });

    it('validates adminAuditLogListSchema', () => {
      const parsed = adminAuditLogListSchema.safeParse({
        page: '2',
        limit: '15',
        entity: 'USER',
        action: 'USER_DEACTIVATED',
        search: 'admin@eventai.test',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.page).toBe(2);
        expect(parsed.data.limit).toBe(15);
        expect(parsed.data.entity).toBe('USER');
      }
    });

    it('validates adminBookingListSchema', () => {
      expect(adminBookingListSchema.safeParse({ status: 'CONFIRMED' }).success).toBe(true);
      expect(adminBookingListSchema.safeParse({ status: 'INVALID_STATUS' }).success).toBe(false);
    });

    it('validates adminEventListSchema', () => {
      expect(adminEventListSchema.safeParse({ status: 'PUBLISHED' }).success).toBe(true);
      expect(adminEventListSchema.safeParse({ status: 'UNKNOWN' }).success).toBe(false);
    });

    it('validates adminOrganizerListSchema', () => {
      const parsed = adminOrganizerListSchema.safeParse({ isVerified: 'true' });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.isVerified).toBe(true);
      }
    });

    it('validates adminUserListSchema', () => {
      const parsed = adminUserListSchema.safeParse({ role: 'ADMIN', isActive: 'false' });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.role).toBe('ADMIN');
        expect(parsed.data.isActive).toBe(false);
      }
    });
  });

  // ── Error handling propagation ──────────────────────

  describe('error handling propagation', () => {
    it('propagates NotFoundException from bookingDetail', async () => {
      adminService.getBooking.mockRejectedValueOnce(new NotFoundException('Booking not found'));
      await expect(controller.bookingDetail({ id: validUuid })).rejects.toThrow(NotFoundException);
    });

    it('propagates ConflictException from recoverRefund', async () => {
      paymentsService.recoverApprovedRefund.mockRejectedValueOnce(
        new ConflictException('Payment is not in an approved pending refund state eligible for recovery'),
      );
      await expect(controller.recoverRefund('admin-id', { id: validUuid })).rejects.toThrow(ConflictException);
    });

    it('propagates ServiceUnavailableException from recoverRefund on provider ambiguity', async () => {
      paymentsService.recoverApprovedRefund.mockRejectedValueOnce(
        new ServiceUnavailableException('Refund outcome is pending provider reconciliation; do not retry yet'),
      );
      await expect(controller.recoverRefund('admin-id', { id: validUuid })).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('propagates BadRequestException from setUserStatus', async () => {
      adminService.setUserStatus.mockRejectedValueOnce(
        new BadRequestException('You cannot deactivate your own admin account'),
      );
      await expect(controller.setUserStatus('admin-id', { id: validUuid }, { isActive: false })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
