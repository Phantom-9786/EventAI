import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import {
  deleteAccountSchema,
  updatePreferencesSchema,
  updateProfileSchema,
} from '@eventai/validation';
import { validateBody, validateUuidParam } from '../../middleware/validation';
import type { ExpressUsersController } from './users.controller';

export interface UsersRouterDependencies {
  controller: ExpressUsersController;
  authenticateJwt: RequestHandler;
}

export function createUsersRouter({
  controller,
  authenticateJwt,
}: UsersRouterDependencies): Router {
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  });

  // Authenticated user operations
  router.get('/me', authenticateJwt, controller.getMe);
  router.patch('/me', authenticateJwt, validateBody(updateProfileSchema), controller.updateMe);
  router.patch('/me/preferences', authenticateJwt, validateBody(updatePreferencesSchema), controller.updatePreferences);
  router.post('/me/avatar', authenticateJwt, upload.single('file'), controller.uploadAvatar);
  router.delete('/me', authenticateJwt, controller.deactivateAccount);
  router.get('/me/deletion-blockers', authenticateJwt, controller.getDeletionBlockers);
  router.post('/me/delete', authenticateJwt, validateBody(deleteAccountSchema), controller.deleteAccount);

  // Public user profile
  router.get('/:id', validateUuidParam('id'), controller.getPublicProfile);

  return router;
}
