import { Router, type RequestHandler } from 'express';
import { aiChatSchema } from '@eventai/validation';
import { validateBody } from '../../middleware/validation';
import type { ExpressAiController } from './ai.controller';

export interface AiRouterDependencies {
  controller: ExpressAiController;
  optionalAuthenticateJwt: RequestHandler;
  aiRequestGuard: RequestHandler;
}

export function createAiRouter({
  controller,
  optionalAuthenticateJwt,
  aiRequestGuard,
}: AiRouterDependencies): Router {
  const router = Router();

  router.post(
    '/chat',
    optionalAuthenticateJwt,
    aiRequestGuard,
    validateBody(aiChatSchema),
    controller.chat,
  );

  return router;
}
