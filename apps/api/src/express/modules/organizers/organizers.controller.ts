import type { Request, Response, NextFunction } from 'express';
import { OrganizersService } from '../../../modules/organizers/organizers.service';
import { PaymentsService } from '../../../modules/payments/payments.service';
import { ExpressModerationService } from '../../services/moderation.service';
import { UnauthorizedError, ForbiddenError } from '../../types';

export class ExpressOrganizersController {
  constructor(
    private readonly organizersService: OrganizersService,
    private readonly moderationService: ExpressModerationService,
    private readonly paymentsService?: PaymentsService,
  ) {}

  becomeOrganizer = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizer = await this.moderationService.applyToBecomeOrganizer(
        userId,
        req.body,
      );
      res.status(201).json({ organizer });
    } catch (err) {
      next(err);
    }
  };

  getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const profile = await this.organizersService.getOwnOrganizerProfile(userId);
      const appStatus = await this.moderationService.getOrganizerApplicationStatus(
        profile.id,
      );

      res.status(200).json({
        organizer: {
          ...profile,
          applicationStatus: appStatus.status,
          rejectionReason: appStatus.rejectionReason,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  updateMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');
      const organizer = await this.organizersService.updateOwnProfile(userId, req.body);
      res.status(200).json({ organizer });
    } catch (error) {
      next(error);
    }
  };

  leaveOrganizer = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const result = await this.organizersService.leaveOrganizer(userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  listOwnEvents = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const page = req.query.page
        ? Math.max(1, parseInt(String(req.query.page), 10) || 1)
        : 1;
      const limit = req.query.limit
        ? Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20))
        : 20;

      let profile = null;
      try {
        profile = await this.organizersService.getOwnOrganizerProfile(userId);
      } catch {
        profile = null;
      }

      if (!profile) {
        throw new ForbiddenError(
          'You must have an organizer profile to view organizer events',
        );
      }

      let appStatus: { status?: string } | null = null;
      try {
        appStatus = await this.moderationService.getOrganizerApplicationStatus(
          profile.id,
        );
      } catch {
        appStatus = null;
      }
      const isApproved = Boolean(profile.isVerified || appStatus?.status === 'APPROVED');

      if (!isApproved) {
        res.status(200).json({ events: [], total: 0, page, limit });
        return;
      }

      const organizerId = profile.id;
      const result = await this.organizersService.listOwnEvents(organizerId, page, limit);
      const eventsWithModeration = await Promise.all(
        result.events.map(async (event) => {
          const moderation = await this.moderationService.getEventModerationStatus(
            event.id,
          );
          return { ...event, moderation };
        }),
      );
      res.status(200).json({ ...result, events: eventsWithModeration });
    } catch (err) {
      next(err);
    }
  };

  getDashboardStats = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      let profile = null;
      try {
        profile = await this.organizersService.getOwnOrganizerProfile(userId);
      } catch {
        profile = null;
      }

      if (!profile) {
        throw new ForbiddenError(
          'You must have an organizer profile to view organizer stats',
        );
      }

      let appStatus: { status?: string } | null = null;
      try {
        appStatus = await this.moderationService.getOrganizerApplicationStatus(
          profile.id,
        );
      } catch {
        appStatus = null;
      }
      const isApproved = Boolean(profile.isVerified || appStatus?.status === 'APPROVED');

      if (!isApproved) {
        res.status(200).json({
          events: {
            total: 0,
            DRAFT: 0,
            PUBLISHED: 0,
            CANCELLED: 0,
            COMPLETED: 0,
            SOLDOUT: 0,
          },
          revenue: 0,
          confirmedBookings: 0,
          refundedBookings: 0,
          ticketsIssued: 0,
          checkedIn: 0,
        });
        return;
      }

      const organizerId = profile.id;
      const stats = await this.organizersService.getDashboardStats(organizerId);
      res.status(200).json(stats);
    } catch (err) {
      next(err);
    }
  };

  createVenue = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const venue = await this.organizersService.createVenue(organizerId, req.body);
      res.status(201).json({ venue });
    } catch (err) {
      next(err);
    }
  };

  listOwnVenues = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const venues = await this.organizersService.listOwnVenues(organizerId);
      res.status(200).json({ venues });
    } catch (err) {
      next(err);
    }
  };

  updateVenue = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const venue = await this.organizersService.updateVenue(
        organizerId,
        req.params.venueId,
        req.body,
      );
      res.status(200).json({ venue });
    } catch (err) {
      next(err);
    }
  };

  deleteVenue = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const result = await this.organizersService.deleteVenue(
        organizerId,
        req.params.venueId,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  createSeatSection = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const section = await this.organizersService.createSeatSection(
        organizerId,
        req.params.venueId,
        req.body,
      );
      res.status(201).json({ section });
    } catch (err) {
      next(err);
    }
  };

  listSeatSections = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const sections = await this.organizersService.listSeatSections(
        organizerId,
        req.params.venueId,
      );
      res.status(200).json({ sections });
    } catch (err) {
      next(err);
    }
  };

  validateTicket = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const result = await this.organizersService.validateTicket(
        organizerId,
        req.params.eventId,
        req.body.ticketCode,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  eventTicketStats = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const result = await this.organizersService.eventTicketStats(
        organizerId,
        req.params.eventId,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  eventAttendees = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const page = req.query.page
        ? Math.max(1, parseInt(String(req.query.page), 10) || 1)
        : 1;
      const limit = req.query.limit
        ? Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20))
        : 20;

      const result = await this.organizersService.eventAttendees(
        organizerId,
        req.params.eventId,
        page,
        limit,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  refundRequests = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const page = req.query.page
        ? Math.max(1, parseInt(String(req.query.page), 10) || 1)
        : 1;
      const limit = req.query.limit
        ? Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20))
        : 20;
      const status = req.query.status as string | undefined;

      if (!this.paymentsService) {
        res.status(200).json({ refundRequests: [], total: 0, page, limit, pages: 0 });
        return;
      }

      const result = await this.paymentsService.listOrganizerRefundRequests(
        organizerId,
        status,
        page,
        limit,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  approveRefundRequest = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      if (!this.paymentsService) {
        throw new UnauthorizedError('Payments service unavailable');
      }

      const result = await this.paymentsService.approveRefundRequest(
        organizerId,
        userId,
        req.params.bookingId,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  rejectRefundRequest = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      if (!this.paymentsService) {
        throw new UnauthorizedError('Payments service unavailable');
      }

      const result = await this.paymentsService.rejectRefundRequest(
        organizerId,
        userId,
        req.params.bookingId,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  reconcileRefundRequest = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      if (!this.paymentsService) {
        throw new UnauthorizedError('Payments service unavailable');
      }

      const result = await this.paymentsService.reconcileOrganizerRefund(
        organizerId,
        userId,
        req.params.bookingId,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  recoverRefundRequest = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      if (!this.paymentsService) {
        throw new UnauthorizedError('Payments service unavailable');
      }

      const result = await this.paymentsService.recoverOrganizerRefund(
        organizerId,
        userId,
        req.params.bookingId,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };
}
