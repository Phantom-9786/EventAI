import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import {
  createEventSchema,
  createTicketTypeSchema,
  eventSearchSchema,
  updateEventSchema,
} from '@eventai/validation';
import { validateBody, validateQuery } from '../../middleware/validation';
import { UserRole } from '@eventai/types';
import type { ExpressEventsController } from './events.controller';
import type { ExpressTicketsController } from '../tickets/tickets.controller';
import { MAX_EVENT_IMAGE_BYTES } from '../../../modules/events/event-media.service';

import type { SystemControlsService } from '../../../modules/admin/system-controls.service';

export interface EventsRouterDependencies {
  controller: ExpressEventsController;
  ticketsController?: ExpressTicketsController;
  authenticateJwt: RequestHandler;
  requireRoles: (...roles: UserRole[]) => RequestHandler;
  systemControlsService?: SystemControlsService;
}

export function createEventsRouter({
  controller,
  ticketsController,
  authenticateJwt,
  requireRoles,
  systemControlsService,
}: EventsRouterDependencies): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_EVENT_IMAGE_BYTES, files: 1 },
  });

  const eventCreationGuard: RequestHandler = async (_req, res, next) => {
    if (!systemControlsService) return next();
    try {
      const settings = await systemControlsService.getSettings();
      if (settings.eventCreationMaintenance) {
        res.status(503).json({
          success: false,
          statusCode: 503,
          message:
            settings.eventCreationMaintenanceMessage ||
            'New event creation is temporarily unavailable. Existing events remain accessible.',
          code: 'EVENT_CREATION_MAINTENANCE',
        });
        return;
      }
      next();
    } catch {
      next();
    }
  };

  // 1. Generic upload route & upload configuration (before dynamic params)
  router.post(
    '/upload-image',
    authenticateJwt,
    requireRoles(UserRole.ORGANIZER),
    eventCreationGuard,
    upload.single('file'),
    controller.uploadGenericImage,
  );
  router.get('/upload-config', controller.getUploadConfig);

  // 2. Public browse and search
  router.get('/', validateQuery(eventSearchSchema), controller.search);

  // 3. Organizer event creation
  router.post(
    '/',
    authenticateJwt,
    requireRoles(UserRole.ORGANIZER),
    eventCreationGuard,
    validateBody(createEventSchema),
    controller.create,
  );

  // 4. Specific subpaths on :idOrSlug (must be before plain GET /:idOrSlug if order could conflict)
  router.get('/:idOrSlug/similar', controller.similar);
  router.get('/:idOrSlug/manage', authenticateJwt, requireRoles(UserRole.ORGANIZER), controller.getForManage);
  router.patch(
    '/:idOrSlug',
    authenticateJwt,
    requireRoles(UserRole.ORGANIZER),
    validateBody(updateEventSchema),
    controller.update,
  );
  router.post('/:idOrSlug/submit', authenticateJwt, requireRoles(UserRole.ORGANIZER), controller.submitForReview);
  router.post('/:idOrSlug/publish', authenticateJwt, requireRoles(UserRole.ORGANIZER), controller.publish);
  router.post('/:idOrSlug/cancel', authenticateJwt, requireRoles(UserRole.ORGANIZER), controller.cancel);
  router.delete('/:idOrSlug', authenticateJwt, requireRoles(UserRole.ORGANIZER), controller.remove);

  // 5. Image upload and deletion for event
  router.post(
    '/:eventId/images',
    authenticateJwt,
    requireRoles(UserRole.ORGANIZER),
    upload.single('file'),
    controller.uploadImage,
  );
  router.delete(
    '/:eventId/images',
    authenticateJwt,
    requireRoles(UserRole.ORGANIZER),
    controller.deleteImage,
  );

  // 6. Tickets on event
  if (ticketsController) {
    router.post(
      '/:idOrSlug/tickets',
      authenticateJwt,
      requireRoles(UserRole.ORGANIZER),
      validateBody(createTicketTypeSchema),
      ticketsController.create,
    );
    router.get(
      '/:idOrSlug/tickets',
      authenticateJwt,
      requireRoles(UserRole.ORGANIZER),
      ticketsController.list,
    );
  }

  // 7. Public event detail
  router.get('/:idOrSlug', controller.getPublished);

  return router;
}
