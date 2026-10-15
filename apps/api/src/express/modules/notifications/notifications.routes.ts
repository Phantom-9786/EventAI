import { Router, type RequestHandler } from 'express';
import type { ExpressNotificationsController } from './notifications.controller';

export interface NotificationsRouterDependencies {
  controller: ExpressNotificationsController;
  authenticateJwt: RequestHandler;
}

export function createNotificationsRouter({
  controller,
  authenticateJwt,
}: NotificationsRouterDependencies): Router {
  const router = Router();

  router.use(authenticateJwt);

  router.get('/', controller.getNotifications);
  router.patch('/:id/read', controller.markRead);
  router.post('/read-all', controller.markAllRead);

  return router;
}
