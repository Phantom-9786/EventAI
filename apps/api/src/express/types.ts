import type { UserRole } from '@eventai/types';

export interface ExpressAuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface ErrorEnvelope {
  success: false;
  statusCode: number;
  message: string | string[];
  error?: string;
  errors?: Record<string, string[] | undefined>;
  path: string;
  timestamp: string;
  requestId?: string;
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string | string[],
    public readonly errorName?: string,
    public readonly errors?: Record<string, string[] | undefined>,
  ) {
    super(Array.isArray(message) ? message.join(', ') : message);
    this.name = 'HttpError';
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string | string[] = 'Bad request', errors?: Record<string, string[] | undefined>) {
    super(400, message, 'Bad Request', errors);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message: string | string[] = 'Unauthorized') {
    super(401, message, 'Unauthorized');
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string | string[] = 'Forbidden') {
    super(403, message, 'Forbidden');
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string | string[] = 'Not found') {
    super(404, message, 'Not Found');
  }
}

export class ConflictError extends HttpError {
  constructor(message: string | string[] = 'Conflict') {
    super(409, message, 'Conflict');
  }
}

export class PayloadTooLargeError extends HttpError {
  constructor(message: string | string[] = 'Payload too large') {
    super(413, message, 'Payload Too Large');
  }
}

export class UnsupportedMediaTypeError extends HttpError {
  constructor(message: string | string[] = 'Unsupported media type') {
    super(415, message, 'Unsupported Media Type');
  }
}

export class TooManyRequestsError extends HttpError {
  constructor(message: string | string[] = 'Too many requests') {
    super(429, message, 'Too Many Requests');
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message: string | string[] = 'Service unavailable') {
    super(503, message, 'Service Unavailable');
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface User extends ExpressAuthUser {}
    interface Request {
      rawBody?: Buffer;
      requestId?: string;
      authUser?: ExpressAuthUser;
    }
  }
}



