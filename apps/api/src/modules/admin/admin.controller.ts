import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  adminEventListSchema,
  adminBookingListSchema,
  adminModerateEventSchema,
  adminOrganizerListSchema,
  adminSetOrganizerVerificationSchema,
  adminSetUserStatusSchema,
  adminUserListSchema,
  idParamSchema,
} from '@eventai/validation';
import { AdminService } from './admin.service';
import { PaymentsService } from '../payments/payments.service';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Roles('ADMIN')
  @Get('stats')
  @ApiOperation({ summary: 'Platform-wide statistics (admin only)' })
  async stats() {
    return this.adminService.platformStats();
  }

  // ── User management ──────────────────────────────

  @Roles('ADMIN')
  @Get('users')
  @ApiOperation({ summary: 'List/search users (admin only)' })
  async listUsers(
    @Query(new ZodValidationPipe(adminUserListSchema)) query: Record<string, unknown>,
  ) {
    return this.adminService.listUsers(query as never);
  }

  @Roles('ADMIN')
  @Get('bookings')
  @ApiOperation({ summary: 'Search bookings and payment status (admin only)' })
  async listBookings(
    @Query(new ZodValidationPipe(adminBookingListSchema)) query: Record<string, unknown>,
  ) {
    return this.adminService.listBookings(query as never);
  }

  @Roles('ADMIN')
  @Get('bookings/:id')
  @ApiOperation({ summary: 'View booking and payment oversight details (admin only)' })
  async bookingDetail(@Param(new ZodValidationPipe(idParamSchema)) params: { id: string }) {
    return { booking: await this.adminService.getBooking(params.id) };
  }

  @Roles('ADMIN')
  @Post('bookings/:id/refund/reconcile')
  @ApiOperation({ summary: 'Safely inspect and reconcile a pending Razorpay refund (admin only)' })
  async reconcileRefund(
    @CurrentUser('id') adminUserId: string,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.paymentsService.reconcileRefund(adminUserId, params.id);
  }

  @Roles('ADMIN')
  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Activate/deactivate a user (admin only)' })
  async setUserStatus(
    @CurrentUser('id') adminUserId: string,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(adminSetUserStatusSchema)) body: { isActive: boolean },
  ) {
    return this.adminService.setUserStatus(adminUserId, params.id, body);
  }

  // ── Event moderation ─────────────────────────────

  @Roles('ADMIN')
  @Get('events')
  @ApiOperation({ summary: 'List/search all events regardless of status (admin only)' })
  async listEvents(
    @Query(new ZodValidationPipe(adminEventListSchema)) query: Record<string, unknown>,
  ) {
    return this.adminService.listEvents(query as never);
  }

  @Roles('ADMIN')
  @Post('events/:id/moderate')
  @ApiOperation({ summary: 'Moderate an event (cancel published events; admin only)' })
  async moderateEvent(
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(adminModerateEventSchema)) body: {
      action: 'CANCEL';
      reason?: string;
    },
  ) {
    return this.adminService.moderateEvent(params.id, body);
  }

  // ── Organizer management ─────────────────────────

  @Roles('ADMIN')
  @Get('organizers')
  @ApiOperation({ summary: 'List/search organizers (admin only)' })
  async listOrganizers(
    @Query(new ZodValidationPipe(adminOrganizerListSchema)) query: Record<string, unknown>,
  ) {
    return this.adminService.listOrganizers(query as never);
  }

  @Roles('ADMIN')
  @Patch('organizers/:id/verification')
  @ApiOperation({ summary: 'Set the organizer verified badge (admin only)' })
  async setOrganizerVerification(
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(adminSetOrganizerVerificationSchema)) body: { isVerified: boolean },
  ) {
    return this.adminService.setOrganizerVerification(params.id, body);
  }
}
