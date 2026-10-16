import type { Request, Response, NextFunction } from 'express';
import { EventsService } from '../../../modules/events/events.service';
import { EventMediaService } from '../../../modules/events/event-media.service';
import { ExpressModerationService } from '../../services/moderation.service';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../types';

export class ExpressEventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly mediaService: EventMediaService,
    private readonly moderationService: ExpressModerationService,
  ) {}

  search = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.eventsService.searchEvents(req.query as never);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  getPublished = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const event = await this.eventsService.getPublishedEvent(req.params.idOrSlug);
      const moderation = await this.moderationService.getEventModerationStatus(event.id);
      if (moderation.status !== 'APPROVED') {
        throw new NotFoundError('Event not found');
      }
      res.status(200).json({ event });
    } catch (err) {
      next(err);
    }
  };

  similar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = Number.parseInt(String(req.query.limit ?? ''), 10);
      const limit = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 8) : 4;
      const events = await this.eventsService.findSimilarEvents(req.params.idOrSlug, limit);
      res.status(200).json({ events });
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const event = await this.eventsService.createEvent(organizerId, req.body);
      res.status(201).json({ event, moderation: { status: 'DRAFT' } });
    } catch (err) {
      next(err);
    }
  };

  getForManage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const event = await this.eventsService.getEventForManage(organizerId, req.params.idOrSlug);
      const moderation = await this.moderationService.getEventModerationStatus(event.id);
      res.status(200).json({ event: { ...event, moderation } });
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      let updated = await this.eventsService.updateEvent(organizerId, req.params.idOrSlug, req.body);

      const materialFields = ['title', 'startDate', 'endDate', 'venueId'].filter(
        (field) => (req.body as Record<string, unknown>)[field] !== undefined,
      );
      if (materialFields.length > 0) {
        await this.moderationService.handleMaterialEventChange(userId, updated.id, materialFields);
        await this.eventsService.invalidateEventCache();
        updated = await this.eventsService.getEventForManage(organizerId, updated.id);
      }

      const moderation = await this.moderationService.getEventModerationStatus(updated.id);
      res.status(200).json({ event: updated, moderation });
    } catch (err) {
      next(err);
    }
  };

  submitForReview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const event = await this.eventsService.getEventForManage(organizerId, req.params.idOrSlug);
      const moderation = await this.moderationService.submitEventForReview(organizerId, event.id);

      res.status(200).json({
        message: 'Event submitted for review',
        eventId: event.id,
        moderation,
      });
    } catch (err) {
      next(err);
    }
  };

  publish = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const event = await this.eventsService.getEventForManage(organizerId, req.params.idOrSlug);

      await this.moderationService.assertEventApprovedForPublishing(event.id);
      const published = await this.eventsService.publishEvent(organizerId, req.params.idOrSlug);

      res.status(200).json({ event: published });
    } catch (err) {
      next(err);
    }
  };

  cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const cancelled = await this.eventsService.cancelEvent(organizerId, req.params.idOrSlug);
      res.status(200).json(cancelled);
    } catch (err) {
      next(err);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const organizerId = await this.moderationService.requireApprovedOrganizer(userId);
      const result = await this.eventsService.deleteEvent(organizerId, req.params.idOrSlug);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  uploadImage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      await this.moderationService.requireApprovedOrganizer(userId);
      const file = req.file as { buffer: Buffer; mimetype: string; size: number } | undefined;
      const result = await this.mediaService.upload(userId, req.params.eventId, file);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  uploadGenericImage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      await this.moderationService.requireApprovedOrganizer(userId);
      const file = req.file as { buffer: Buffer; mimetype: string; size: number } | undefined;
      const result = await this.mediaService.uploadGeneric(userId, file);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  deleteImage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      await this.moderationService.requireApprovedOrganizer(userId);
      const mediaUrl = (req.body?.mediaUrl ?? req.query?.mediaUrl) as string | undefined;
      if (!mediaUrl || typeof mediaUrl !== 'string') {
        throw new BadRequestError('Media identifier is required');
      }
      const result = await this.mediaService.delete(userId, req.params.eventId, mediaUrl);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };
}
