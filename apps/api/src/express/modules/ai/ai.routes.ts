import { Router, type RequestHandler } from 'express';
import { aiChatSchema } from '@eventai/validation';
import { validateBody } from '../../middleware/validation';
import type { ExpressAiController } from './ai.controller';

import type { SystemControlsService } from '../../../modules/admin/system-controls.service';

export interface AiRouterDependencies {
  controller: ExpressAiController;
  optionalAuthenticateJwt: RequestHandler;
  aiRequestGuard: RequestHandler;
  systemControlsService?: SystemControlsService;
}

export function createAiRouter({
  controller,
  optionalAuthenticateJwt,
  aiRequestGuard,
  systemControlsService,
}: AiRouterDependencies): Router {
  const router = Router();

  const aiMaintenanceGuard: RequestHandler = async (_req, res, next) => {
    if (!systemControlsService) return next();
    try {
      const settings = await systemControlsService.getSettings();
      if (settings.aiMaintenance) {
        res.status(503).json({
          success: false,
          statusCode: 503,
          message:
            settings.aiMaintenanceMessage ||
            'AI Assistant is temporarily unavailable for maintenance. Please try again later.',
          code: 'AI_MAINTENANCE',
        });
        return;
      }
      next();
    } catch {
      next();
    }
  };

  router.get('/suggestions', aiMaintenanceGuard, controller.suggestions);

  router.post(
    '/chat',
    aiMaintenanceGuard,
    optionalAuthenticateJwt,
    aiRequestGuard,
    validateBody(aiChatSchema),
    controller.chat,
  );

  return router;
}
