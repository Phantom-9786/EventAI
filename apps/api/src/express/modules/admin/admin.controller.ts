import type { Request, Response, NextFunction } from 'express';
import { AdminService } from '../../../modules/admin/admin.service';
import { PaymentsService } from '../../../modules/payments/payments.service';
import { ExpressModerationService } from '../../services/moderation.service';
import { SystemControlsService } from '../../../modules/admin/system-controls.service';
import { UnauthorizedError } from '../../types';

export class ExpressAdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly moderationService: ExpressModerationService,
    private readonly paymentsService?: PaymentsService,
    private readonly systemControlsService?: SystemControlsService,
  ) {}

  stats = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.adminService.platformStats();
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  listUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.adminService.listUsers(req.query as never);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  setUserStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminUserId = req.authUser?.id ?? req.user?.id;
      if (!adminUserId) throw new UnauthorizedError('Unauthorized');

      const result = await this.adminService.setUserStatus(adminUserId, req.params.id, req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  listBookings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.adminService.listBookings(req.query as never);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  bookingDetail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const booking = await this.adminService.getBooking(req.params.id);
      res.status(200).json({ booking });
    } catch (err) {
      next(err);
    }
  };

  reconcileRefund = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminUserId = req.authUser?.id ?? req.user?.id;
      if (!adminUserId) throw new UnauthorizedError('Unauthorized');
      if (!this.paymentsService) throw new UnauthorizedError('Payments service unavailable');

      const result = await this.paymentsService.reconcileRefund(adminUserId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  recoverRefund = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminUserId = req.authUser?.id ?? req.user?.id;
      if (!adminUserId) throw new UnauthorizedError('Unauthorized');
      if (!this.paymentsService) throw new UnauthorizedError('Payments service unavailable');

      const result = await this.paymentsService.recoverApprovedRefund(adminUserId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  listOrganizers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.adminService.listOrganizers(req.query as never);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  listPendingApplications = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const applications = await this.moderationService.listPendingOrganizerApplications();
      res.status(200).json({ applications });
    } catch (err) {
      next(err);
    }
  };

  setOrganizerVerification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminUserId = req.authUser?.id ?? req.user?.id;
      if (!adminUserId) throw new UnauthorizedError('Unauthorized');

      const result = await this.adminService.setOrganizerVerification(adminUserId, req.params.id, req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  approveOrganizer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminUserId = req.authUser?.id ?? req.user?.id;
      if (!adminUserId) throw new UnauthorizedError('Unauthorized');

      const result = await this.moderationService.approveOrganizerApplication(adminUserId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  rejectOrganizer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminUserId = req.authUser?.id ?? req.user?.id;
      if (!adminUserId) throw new UnauthorizedError('Unauthorized');

      const result = await this.moderationService.rejectOrganizerApplication(
        adminUserId,
        req.params.id,
        req.body?.reason,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  listEvents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.adminService.listEvents(req.query as never);
      const eventsWithModeration = await Promise.all(
        result.events.map(async (event) => {
          const moderation = await this.moderationService.getEventModerationStatus(event.id);
          return { ...event, moderation };
        }),
      );
      res.status(200).json({ ...result, events: eventsWithModeration });
    } catch (err) {
      next(err);
    }
  };

  getEventDetail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const event = await this.adminService.getEventDetail(req.params.id);
      res.status(200).json({ event });
    } catch (err) {
      next(err);
    }
  };

  moderateEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminUserId = req.authUser?.id ?? req.user?.id;
      if (!adminUserId) throw new UnauthorizedError('Unauthorized');

      const result = await this.adminService.moderateEvent(adminUserId, req.params.id, req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  reviewEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminUserId = req.authUser?.id ?? req.user?.id;
      if (!adminUserId) throw new UnauthorizedError('Unauthorized');

      const { action, reason } = req.body;
      const moderation = await this.moderationService.reviewEvent(adminUserId, req.params.id, {
        action,
        reason,
      });
      await this.adminService.invalidateEventCache();

      const actionWord = String(action).toUpperCase() === 'APPROVE' ? 'approved' : 'rejected';
      res.status(200).json({
        message: `Event ${actionWord} successfully`,
        moderation,
      });
    } catch (err) {
      next(err);
    }
  };

  listAuditLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.adminService.listAuditLogs(req.query as never);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  getSystemControls = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!this.systemControlsService) {
        res.status(200).json({
          websiteMaintenance: false,
          websiteMaintenanceMessage: 'EventPoint is temporarily undergoing maintenance. Please check back soon.',
          aiMaintenance: false,
          aiMaintenanceMessage: 'AI Assistant is temporarily unavailable for maintenance. Please try again later.',
          eventCreationMaintenance: false,
          eventCreationMaintenanceMessage: 'New event creation is temporarily unavailable. Existing events remain accessible.',
        });
        return;
      }
      const settings = await this.systemControlsService.getSettings();
      res.status(200).json(settings);
    } catch (err) {
      next(err);
    }
  };

  updateSystemControls = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminUserId = req.authUser?.id ?? req.user?.id;
      if (!adminUserId) throw new UnauthorizedError('Unauthorized');

      if (!this.systemControlsService) {
        res.status(200).json(req.body);
        return;
      }

      const settings = await this.systemControlsService.updateSettings(
        adminUserId,
        req.body,
        {
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        },
      );
      res.status(200).json(settings);
    } catch (err) {
      next(err);
    }
  };
}
