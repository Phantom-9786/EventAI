import type { Request, Response, NextFunction } from 'express';
import { NotificationsService } from '../../../modules/notifications/notifications.service';
import { BadRequestError, UnauthorizedError } from '../../types';

export class ExpressNotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  getNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Unauthorized');
      }

      const limitQuery = req.query.limit as string | undefined;
      const limitNum = limitQuery
        ? Math.min(100, Math.max(1, parseInt(limitQuery, 10) || 30))
        : 30;

      const result = await this.notificationsService.getUserNotifications(userId, limitNum);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  markRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Unauthorized');
      }

      const { id } = req.params;
      if (!id || typeof id !== 'string') {
        throw new BadRequestError('Invalid notification ID');
      }

      const notification = await this.notificationsService.markAsRead(userId, id);
      res.status(200).json({ notification });
    } catch (err) {
      next(err);
    }
  };

  markAllRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Unauthorized');
      }

      const result = await this.notificationsService.markAllAsRead(userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  clearAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Unauthorized');
      }

      const result = await this.notificationsService.clearAll(userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  clearNotification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Unauthorized');
      }

      const { id } = req.params;
      if (!id || typeof id !== 'string') {
        throw new BadRequestError('Invalid notification ID');
      }

      const result = await this.notificationsService.clearNotification(userId, id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };
}
