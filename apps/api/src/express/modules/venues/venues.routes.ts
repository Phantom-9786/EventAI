import { Router } from 'express';
import { validateUuidParam } from '../../middleware/validation';
import type { ExpressVenuesController } from './venues.controller';

export interface VenuesRouterDependencies {
  controller: ExpressVenuesController;
}

export function createVenuesRouter({ controller }: VenuesRouterDependencies): Router {
  const router = Router();

  // Public browse/search
  router.get('/', controller.search);
  router.get('/:id', validateUuidParam('id'), controller.getVenue);

  return router;
}
