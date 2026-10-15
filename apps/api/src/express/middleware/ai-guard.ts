import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID, createHash } from 'crypto';
import type { CacheService } from '../../common/cache/cache.service';
import { TooManyRequestsError, ServiceUnavailableError } from '../types';

export interface AiGuardConfig {
  cache: CacheService;
  env?: Record<string, string | number | undefined>;
}

function parseBoundedInt(val: unknown, fallback: number, min: number, max: number): number {
  const num = Number(val ?? fallback);
  return Number.isInteger(num) && num >= min && num <= max ? num : fallback;
}

export function createAiRequestGuard(config: AiGuardConfig): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.authUser?.id ?? req.user?.id;
    const identity = userId
      ? `user:${userId}`
      : `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const identityHash = createHash('sha256').update(identity).digest('hex');
    const leaseId = randomUUID();

    const identityLimit = parseBoundedInt(
      config.env?.AI_RATE_LIMIT_USER_PER_MINUTE ?? process.env.AI_RATE_LIMIT_USER_PER_MINUTE,
      10,
      1,
      1000,
    );
    const globalLimit = parseBoundedInt(
      config.env?.AI_RATE_LIMIT_GLOBAL_PER_MINUTE ?? process.env.AI_RATE_LIMIT_GLOBAL_PER_MINUTE,
      120,
      1,
      100_000,
    );
    const concurrencyLimit = parseBoundedInt(
      config.env?.AI_MAX_CONCURRENT_REQUESTS ?? process.env.AI_MAX_CONCURRENT_REQUESTS,
      20,
      1,
      10_000,
    );

    let decision;
    try {
      decision = await config.cache.consumeAiRequest(
        identityHash,
        identityLimit,
        globalLimit,
        concurrencyLimit,
        leaseId,
      );
    } catch {
      return next(
        new ServiceUnavailableError(
          'The AI assistant is temporarily unavailable. Please retry shortly.',
        ),
      );
    }

    if (!decision.allowed) {
      return next(
        new TooManyRequestsError('AI request limit reached. Please retry shortly.'),
      );
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      void config.cache.releaseAiRequest(leaseId).catch(() => undefined);
    };

    res.once('finish', release);
    res.once('close', release);

    next();
  };
}
