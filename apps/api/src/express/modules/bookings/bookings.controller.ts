import type { Request, Response, NextFunction } from 'express';
import { BookingsService } from '../../../modules/bookings/bookings.service';
import { ExpressModerationService } from '../../services/moderation.service';
import { NotFoundError, UnauthorizedError } from '../../types';

export class ExpressBookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly moderationService: ExpressModerationService,
  ) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      // Enforce event moderation status: only approved events can be booked
      const moderation = await this.moderationService.getEventModerationStatus(req.body.eventId);
      if (moderation.status !== 'APPROVED') {
        throw new NotFoundError('Event not found or not open for booking');
      }

      const booking = await this.bookingsService.create(userId, req.body);
      res.status(201).json({ booking });
    } catch (err) {
      next(err);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const page = req.query.page ? Math.max(1, parseInt(String(req.query.page), 10) || 1) : 1;
      const limit = req.query.limit
        ? Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20))
        : 20;

      const result = await this.bookingsService.listOwn(userId, page, limit);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  detail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const booking = await this.bookingsService.getOwn(userId, req.params.id);
      res.status(200).json({ booking });
    } catch (err) {
      next(err);
    }
  };

  cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const booking = await this.bookingsService.cancelOwn(
        userId,
        req.params.id,
        req.body?.reason,
      );
      res.status(200).json({ booking });
    } catch (err) {
      next(err);
    }
  };
}
