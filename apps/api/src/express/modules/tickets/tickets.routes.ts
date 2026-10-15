import { Router, type RequestHandler } from 'express';
import { updateTicketTypeSchema } from '@eventai/validation';
import { validateBody, validateUuidParam } from '../../middleware/validation';
import { UserRole } from '@eventai/types';
import type { ExpressTicketsController } from './tickets.controller';

export interface TicketsRouterDependencies {
  controller: ExpressTicketsController;
  authenticateJwt: RequestHandler;
  requireRoles: (...roles: UserRole[]) => RequestHandler;
}

export function createTicketTypesRouter({
  controller,
  authenticateJwt,
  requireRoles,
}: TicketsRouterDependencies): Router {
  const router = Router();

  router.use(authenticateJwt);
  router.use(requireRoles(UserRole.ORGANIZER));

  router.patch(
    '/:id',
    validateUuidParam('id'),
    validateBody(updateTicketTypeSchema),
    controller.update,
  );
  router.delete('/:id', validateUuidParam('id'), controller.remove);

  return router;
}
