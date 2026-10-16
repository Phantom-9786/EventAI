import { ExecutionContext, HttpException, ServiceUnavailableException } from '../../common/exceptions';
import { createHash } from 'crypto';
import { AiRequestGuard } from './ai-request.guard';
import { CacheService } from '../../common/cache/cache.service';
import { ConfigService } from '../../common/config/config.service';

function context(user?: { id: string }, ip = '127.0.0.1') {
  const listeners = new Map<string, () => void>();
  const response = { once: jest.fn((event: string, listener: () => void) => listeners.set(event, listener)) };
  const request = { user, ip, socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': 'spoofed' } };
  const execution = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
  return { execution, response, listeners };
}

describe('AiRequestGuard', () => {
  const config = { get: (_name: string, fallback: unknown) => fallback } as ConfigService;

  it('uses verified user identity and attaches a concurrency lease release', async () => {
    const cache = {
      consumeAiRequest: jest.fn().mockResolvedValue({ allowed: true }),
      releaseAiRequest: jest.fn().mockResolvedValue(undefined),
    } as unknown as CacheService;
    const guard = new AiRequestGuard(cache, config);
    const ctx = context({ id: 'verified-user-id' });
    await expect(guard.canActivate(ctx.execution)).resolves.toBe(true);
    expect(cache.consumeAiRequest).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/), 10, 120, 20, expect.any(String),
    );
    ctx.listeners.get('finish')?.();
    expect(cache.releaseAiRequest).toHaveBeenCalledTimes(1);
  });

  it('returns 429 for an exhausted limit and does not trust forwarded client IP headers', async () => {
    const cache = {
      consumeAiRequest: jest.fn().mockResolvedValue({ allowed: false, reason: 'user' }),
    } as unknown as CacheService;
    const guard = new AiRequestGuard(cache, config);
    const ctx = context(undefined, '192.0.2.10');
    const error = await guard.canActivate(ctx.execution).catch((e: HttpException) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    const expected = createHash('sha256').update('ip:192.0.2.10').digest('hex');
    expect(cache.consumeAiRequest).toHaveBeenCalledWith(expected, 10, 120, 20, expect.any(String));
  });

  it('fails closed with 503 when shared Redis protection is unavailable', async () => {
    const cache = { consumeAiRequest: jest.fn().mockRejectedValue(new Error('Redis unavailable')) } as unknown as CacheService;
    const guard = new AiRequestGuard(cache, config);
    await expect(guard.canActivate(context().execution)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('limits concurrent requests atomically across simultaneous callers', async () => {
    let active = 0;
    const cache = {
      consumeAiRequest: jest.fn(async () => {
        if (active >= 1) return { allowed: false, reason: 'concurrency' };
        active++;
        return { allowed: true };
      }),
      releaseAiRequest: jest.fn(async () => { active--; }),
    } as unknown as CacheService;
    const guard = new AiRequestGuard(cache, config);
    const first = context();
    const second = context();
    const results = await Promise.allSettled([
      guard.canActivate(first.execution),
      guard.canActivate(second.execution),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const accepted = results[0].status === 'fulfilled' ? first : second;
    accepted.listeners.get('finish')?.();
    await Promise.resolve();
    expect(active).toBe(0);
  });
});
