import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import * as Sentry from '@sentry/nestjs';
import { StructuredLogger } from '../../common/logging/structured-logger';
import { HttpError, type ErrorEnvelope } from '../types';

export function createErrorHandlerMiddleware(logger: StructuredLogger): ErrorRequestHandler {
  return (
    err: unknown,
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction,
  ): void => {
    const requestId = req.requestId ?? (req.headers['x-request-id'] as string | undefined);
    let statusCode = 500;
    let message: string | string[] = 'Internal server error';
    let error: string | undefined;
    let errors: Record<string, string[] | undefined> | undefined;
    let extraFields: Record<string, unknown> | undefined;

    if (err instanceof HttpError) {
      statusCode = err.statusCode;
      message = err.message;
      error = err.errorName;
      errors = err.errors;
    } else if (typeof err === 'object' && err !== null && 'getStatus' in err && typeof (err as { getStatus: unknown }).getStatus === 'function') {
      // NestJS HttpException compatibility
      const httpEx = err as { getStatus(): number; getResponse(): unknown; message: string; name: string };
      statusCode = httpEx.getStatus();
      const body = httpEx.getResponse();
      if (typeof body === 'string') {
        message = body;
        error = httpEx.name ? httpEx.name.replace(/Exception$/, '') : undefined;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        message = (b.message as string | string[]) ?? httpEx.message;
        error = (b.error as string | undefined) ?? (httpEx.name ? httpEx.name.replace(/Exception$/, '') : undefined);
        if (b.errors && typeof b.errors === 'object') {
          errors = b.errors as Record<string, string[]>;
        }
        if (b.blockers) {
          extraFields = { blockers: b.blockers };
        }
        if (b.retryAfterSeconds !== undefined) {
          extraFields = { ...(extraFields ?? {}), retryAfterSeconds: b.retryAfterSeconds };
          res.setHeader('Retry-After', String(b.retryAfterSeconds));
        }
      } else {
        message = httpEx.message;
        error = httpEx.name ? httpEx.name.replace(/Exception$/, '') : undefined;
      }
    } else if (err instanceof SyntaxError && 'status' in err && (err as { status?: number }).status === 400 && 'body' in err) {
      // Malformed JSON from express.json()
      statusCode = 400;
      message = 'Malformed JSON in request body';
      error = 'Bad Request';
    } else if (typeof err === 'object' && err !== null && 'name' in err && (err as { name?: string }).name === 'MulterError') {
      const multerErr = err as { code?: string; message?: string };
      if (multerErr.code === 'LIMIT_FILE_SIZE') {
        statusCode = 413;
        message = 'Image must be 5 MB or smaller';
        error = 'Payload Too Large';
      } else {
        statusCode = 400;
        message = multerErr.message ?? 'File upload error';
        error = 'Bad Request';
      }
    } else if (typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
      const errWithStatus = err as { status: number; message?: string; name?: string };
      statusCode = errWithStatus.status;
      message = errWithStatus.message ?? 'Request failed';
      error = errWithStatus.name;
    } else if (err instanceof Error) {
      statusCode = 500;
      message = 'Internal server error';
      try {
        Sentry.captureException(err);
      } catch {
        /* Sentry may be disabled */
      }
      logger.logWithMeta('error', `Unhandled exception on ${req.method} ${req.path}`, {
        method: req.method,
        url: req.path,
        requestId,
        exceptionType: err.name,
        stack: err.stack,
      });
    } else {
      statusCode = 500;
      message = 'Internal server error';
      try {
        Sentry.captureException(err);
      } catch {
        /* Sentry may be disabled */
      }
      logger.logWithMeta('error', `Unhandled non-Error rejection on ${req.method} ${req.path}`, {
        method: req.method,
        url: req.path,
        requestId,
        exceptionType: typeof err,
      });
    }

    const payload: ErrorEnvelope = {
      success: false,
      statusCode,
      message,
      ...(error ? { error } : {}),
      ...(errors ? { errors } : {}),
      path: req.path,
      timestamp: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
      ...(extraFields ?? {}),
    };

    res.status(statusCode).json(payload);
  };
}

