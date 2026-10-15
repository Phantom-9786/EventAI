import { Router, type RequestHandler } from 'express';
import {
  cancelBookingSchema,
  createBookingSchema,
  paginationSchema,
} from '@eventai/validation';
import { validateBody, validateQuery, validateUuidParam } from '../../middleware/validation';
import type { ExpressBookingsController } from './bookings.controller';

export interface BookingsRouterDependencies {
  controller: ExpressBookingsController;
  authenticateJwt: RequestHandler;
}

export function createBookingsRouter({
  controller,
  authenticateJwt,
}: BookingsRouterDependencies): Router {
  const router = Router();

  router.use(authenticateJwt);

  router.post('/', validateBody(createBookingSchema), controller.create);
  router.get('/', validateQuery(paginationSchema), controller.list);
  router.get('/:id', validateUuidParam('id'), controller.detail);
  router.post('/:id/cancel', validateUuidParam('id'), validateBody(cancelBookingSchema), controller.cancel);

  return router;
}
