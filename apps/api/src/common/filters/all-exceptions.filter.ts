import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { StructuredLogger } from '../logging/structured-logger';

// ═══════════════════════════════════════════════════
// Global exception filter — consistent error envelope
// Never leaks stack traces in production.
// ═══════════════════════════════════════════════════

interface ErrorEnvelope {
  success: false;
  statusCode: number;
  message: string | string[];
  error?: string;
  path: string;
  timestamp: string;
  requestId?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger: StructuredLogger;

  constructor(configService: ConfigService) {
    this.logger = new StructuredLogger(
      AllExceptionsFilter.name,
      configService.get<string>('NODE_ENV') === 'production' ||
        configService.get<string>('LOG_FORMAT') === 'json',
    );
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.headers['x-request-id'] as string | undefined;

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error: string | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        message = (b.message as string | string[]) ?? exception.message;
        error = b.error as string | undefined;
      }
    } else if (exception instanceof Error) {
      Sentry.captureException(exception);
      const path = request.path;
      this.logger.logWithMeta('error', `Unhandled exception on ${request.method} ${path}`, {
        method: request.method,
        url: path,
        requestId,
        exceptionType: exception.name,
      });
    } else {
      Sentry.captureException(exception);
      const path = request.path;
      this.logger.logWithMeta('error', `Unhandled non-Error rejection on ${request.method} ${path}`, {
        method: request.method,
        url: path,
        requestId,
        exceptionType: typeof exception,
      });
    }

    const payload: ErrorEnvelope = {
      success: false,
      statusCode,
      message,
      error,
      path: request.path,
      timestamp: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
    };

    response.status(statusCode).json(payload);
  }
}
