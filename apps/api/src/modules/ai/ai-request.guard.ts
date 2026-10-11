import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, createHash } from 'crypto';
import type { Request, Response } from 'express';
import { CacheService } from '../../common/cache/cache.service';

type AuthenticatedRequest = Request & { user?: { id?: string } };

@Injectable()
export class AiRequestGuard implements CanActivate {
  private readonly logger = new Logger(AiRequestGuard.name);

  constructor(
    private readonly cache: CacheService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const identity = request.user?.id
      ? `user:${request.user.id}`
      : `ip:${request.ip || request.socket.remoteAddress || 'unknown'}`;
    const identityHash = createHash('sha256').update(identity).digest('hex');
    const leaseId = randomUUID();
    const identityLimit = this.integer('AI_RATE_LIMIT_USER_PER_MINUTE', 10, 1, 1000);
    const globalLimit = this.integer('AI_RATE_LIMIT_GLOBAL_PER_MINUTE', 120, 1, 100_000);
    const concurrencyLimit = this.integer('AI_MAX_CONCURRENT_REQUESTS', 20, 1, 10_000);

    let decision;
    try {
      decision = await this.cache.consumeAiRequest(
        identityHash,
        identityLimit,
        globalLimit,
        concurrencyLimit,
        leaseId,
      );
    } catch {
      this.logger.warn('AI request protection unavailable; rejecting request');
      throw new ServiceUnavailableException(
        'The AI assistant is temporarily unavailable. Please retry shortly.',
      );
    }

    if (!decision.allowed) {
      throw new HttpException(
        'AI request limit reached. Please retry shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      void this.cache.releaseAiRequest(leaseId).catch(() => {
        this.logger.warn('AI concurrency lease will expire automatically');
      });
    };
    response.once('finish', release);
    response.once('close', release);
    return true;
  }

  private integer(name: string, fallback: number, min: number, max: number): number {
    const value = Number(this.config.get<string | number>(name, fallback));
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  }
}
