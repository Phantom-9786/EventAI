import { Router, type RequestHandler } from 'express';
import { createCategorySchema, updateCategorySchema } from '@eventai/validation';
import { validateBody, validateUuidParam } from '../../middleware/validation';
import { UserRole } from '@eventai/types';
import multer from 'multer';
import { MAX_EVENT_IMAGE_BYTES } from '../../../modules/events/event-media.service';
import type { ExpressCategoriesController } from './categories.controller';

export interface CategoriesRouterDependencies {
  controller: ExpressCategoriesController;
  authenticateJwt: RequestHandler;
  requireRoles: (...roles: UserRole[]) => RequestHandler;
}

export function createCategoriesRouter({
  controller,
  authenticateJwt,
  requireRoles,
}: CategoriesRouterDependencies): Router {
  const router = Router();

  // Public category listing
  router.get('/', controller.list);
  router.get('/spotlights', controller.spotlights);

  // Admin-only management
  router.post('/upload-cover', authenticateJwt, requireRoles(UserRole.ADMIN),
    multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_EVENT_IMAGE_BYTES, files: 1 } }).single('file'),
    controller.uploadCover);
  router.post(
    '/',
    authenticateJwt,
    requireRoles(UserRole.ADMIN),
    validateBody(createCategorySchema),
    controller.create,
  );
  router.patch(
    '/:id',
    authenticateJwt,
    requireRoles(UserRole.ADMIN),
    validateUuidParam('id'),
    validateBody(updateCategorySchema),
    controller.update,
  );
  router.delete(
    '/:id',
    authenticateJwt,
    requireRoles(UserRole.ADMIN),
    validateUuidParam('id'),
    controller.deactivate,
  );

  return router;
}
