import type { Request, Response, NextFunction } from 'express';
import { TicketsService } from '../../../modules/tickets/tickets.service';
import { ExpressModerationService } from '../../services/moderation.service';
import { UnauthorizedError } from '../../types';

export class ExpressTicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly moderationService: ExpressModerationService,
  ) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const ticketType = await this.ticketsService.create(organizerId, req.params.idOrSlug, req.body);
      res.status(201).json({ ticketType });
    } catch (err) {
      next(err);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const ticketTypes = await this.ticketsService.listForOrganizer(organizerId, req.params.idOrSlug);
      res.status(200).json({ ticketTypes });
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const ticketType = await this.ticketsService.update(organizerId, req.params.id, req.body);
      res.status(200).json({ ticketType });
    } catch (err) {
      next(err);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const result = await this.ticketsService.remove(organizerId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };
}
