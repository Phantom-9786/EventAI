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
  router.delete('/', controller.clearAll);
  router.delete('/read', controller.clearRead);
  router.delete('/:id', controller.clearNotification);

  return router;
}
