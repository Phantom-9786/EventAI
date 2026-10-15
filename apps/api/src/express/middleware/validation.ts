import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ZodSchema } from 'zod';
import { BadRequestError } from '../types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const flattened = result.error.flatten();
      return next(new BadRequestError('Validation failed', flattened.fieldErrors as Record<string, string[] | undefined>));
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const flattened = result.error.flatten();
      return next(new BadRequestError('Validation failed', flattened.fieldErrors as Record<string, string[] | undefined>));
    }
    req.query = result.data as never;
    next();
  };
}

export function validateParams<T>(schema: ZodSchema<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const flattened = result.error.flatten();
      return next(new BadRequestError('Validation failed', flattened.fieldErrors as Record<string, string[] | undefined>));
    }
    req.params = result.data as never;
    next();
  };
}

export function validateUuidParam(paramName = 'id'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const value = req.params[paramName];
    if (!value || !UUID_REGEX.test(value)) {
      return next(new BadRequestError('Validation failed (uuid is expected)'));
    }
    next();
  };
}
