import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { TooManyRequestsError } from '../types';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  limit?: number;
  windowMs?: number;
  disabled?: boolean;
}

export function createAuthRateLimiter(options: RateLimiterOptions = {}): RequestHandler {
  if (options.disabled) {
    return (_req: Request, _res: Response, next: NextFunction): void => next();
  }

  const limit = options.limit ?? 10;
  const windowMs = options.windowMs ?? 60_000;
  const inMemoryStore = new Map<string, RateLimitEntry>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown-ip';

    const now = Date.now();

    // Lazy cleanup of expired entries if the map grows
    if (inMemoryStore.size > 500) {
      for (const [key, item] of inMemoryStore.entries()) {
        if (item.resetAt <= now) {
          inMemoryStore.delete(key);
        }
      }
    }

    let entry = inMemoryStore.get(clientIp);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 1, resetAt: now + windowMs };
      inMemoryStore.set(clientIp, entry);
    } else {
      entry.count += 1;
    }

    const remaining = Math.max(0, limit - entry.count);
    const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', limit.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    res.setHeader('X-RateLimit-Reset', resetSeconds.toString());

    if (entry.count > limit) {
      res.setHeader('Retry-After', resetSeconds.toString());
      return next(new TooManyRequestsError('Too many requests, please try again later'));
    }

    next();
  };
}
