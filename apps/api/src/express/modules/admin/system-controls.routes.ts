import { Router } from 'express';
import type { SystemControlsService } from '../../../modules/admin/system-controls.service';

export function createSystemControlsRouter(systemControlsService: SystemControlsService): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const settings = await systemControlsService.getSettings();
      res.status(200).json(settings);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
