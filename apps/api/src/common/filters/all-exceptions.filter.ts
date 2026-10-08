import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

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
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

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
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}: ${exception.message}`,
        exception.stack,
      );
    }

    const payload: ErrorEnvelope = {
      success: false,
      statusCode,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(payload);
  }
}
