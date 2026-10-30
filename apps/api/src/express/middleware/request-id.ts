import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { StructuredLogger } from '../../common/logging/structured-logger';

export function createRequestIdMiddleware(logger: StructuredLogger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const suppliedRequestId = req.headers['x-request-id'];
    const requestId =
      typeof suppliedRequestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(suppliedRequestId)
        ? suppliedRequestId
        : randomUUID();

    req.headers['x-request-id'] = requestId;
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const start = Date.now();
    // Capture before routers trim req.url; omit query strings (tokens/search text).
    const requestPath = req.originalUrl.split('?')[0];
    res.on('finish', () => {
      const durationMs = Date.now() - start;
      logger.logWithMeta('log', `${req.method} ${requestPath}`, {
        method: req.method,
        url: requestPath,
        statusCode: res.statusCode,
        durationMs,
        requestId,
      });
    });

    next();
  };
}
