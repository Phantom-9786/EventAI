import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

export interface AiRateLimitDecision {
  allowed: boolean;
  reason?: 'user' | 'global' | 'concurrency';
}

/**
 * Small Redis-backed cache for hot public reads. Degrades gracefully:
 * when Redis is unreachable every operation is a no-op, so callers never
 * fail because of the cache. Values are JSON-serialised; invalidation is
 * prefix-based (SCAN + DEL) so related keys can be dropped together.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly client: Redis | null;

  constructor(configService: ConfigService) {
    const url = configService.get<string>('REDIS_URL');
    if (!url) {
      this.client = null;
      return;
    }
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.client.on('error', () => {
      this.logger.warn('Redis unavailable; cache operations will be skipped');
    });
    void this.client.connect().catch(() => {
      /* first-connect failure logged via 'error'; cache stays disabled */
    });
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client || this.client.status !== 'ready') return null;
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client || this.client.status !== 'ready') return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      /* cache writes are best-effort */
    }
  }

  /** Atomic, shared AI limits. Unlike cache operations, this fails closed. */
  async consumeAiRequest(
    identityHash: string,
    identityLimit: number,
    globalLimit: number,
    concurrencyLimit: number,
    leaseId: string,
  ): Promise<AiRateLimitDecision> {
    const client = this.requireReadyClient();
    const script = `
      local userCount = tonumber(redis.call('GET', KEYS[1]) or '0')
      local globalCount = tonumber(redis.call('GET', KEYS[2]) or '0')
      if userCount >= tonumber(ARGV[1]) then return 1 end
      if globalCount >= tonumber(ARGV[2]) then return 2 end
      redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[4])
      if redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[3]) then return 3 end
      local userNew = redis.call('INCR', KEYS[1])
      if userNew == 1 then redis.call('PEXPIRE', KEYS[1], 60000) end
      local globalNew = redis.call('INCR', KEYS[2])
      if globalNew == 1 then redis.call('PEXPIRE', KEYS[2], 60000) end
      redis.call('ZADD', KEYS[3], ARGV[5], ARGV[6])
      redis.call('PEXPIRE', KEYS[3], ARGV[7])
      return 0
    `;
    const result = Number(await client.eval(
      script,
      3,
      `eventai:ai:user:${identityHash}`,
      'eventai:ai:global:minute',
      'eventai:ai:concurrency',
      String(identityLimit),
      String(globalLimit),
      String(concurrencyLimit),
      String(Date.now()),
      String(Date.now() + 120_000),
      leaseId,
      '120000',
    ));
    if (result === 1) return { allowed: false, reason: 'user' };
    if (result === 2) return { allowed: false, reason: 'global' };
    if (result === 3) return { allowed: false, reason: 'concurrency' };
    return { allowed: true };
  }

  async releaseAiRequest(leaseId: string): Promise<void> {
    const client = this.requireReadyClient();
    await client.zrem('eventai:ai:concurrency', leaseId);
  }

  async setProviderCooldown(key: string, milliseconds: number): Promise<void> {
    const client = this.requireReadyClient();
    await client.set(key, '1', 'PX', Math.max(1, milliseconds));
  }

  async providerCooldownMs(key: string): Promise<number> {
    const client = this.requireReadyClient();
    const ttl = await client.pttl(key);
    // A cooldown without an expiry is invalid state; fail closed rather than
    // treating the credential as immediately available.
    if (ttl === -1) throw new Error('Persistent provider cooldown has no expiry');
    return Math.max(0, ttl);
  }

  private requireReadyClient(): Redis {
    if (!this.client || this.client.status !== 'ready') {
      throw new Error('Redis unavailable for required AI protection');
    }
    return this.client;
  }

  /** Deletes every key starting with the given prefix (SCAN-based, non-blocking). */
  async invalidatePrefix(prefix: string): Promise<void> {
    if (!this.client || this.client.status !== 'ready') return;
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
        cursor = next;
        if (keys.length > 0) await this.client.del(...keys);
      } while (cursor !== '0');
    } catch {
      /* invalidation is best-effort; TTL bounds staleness anyway */
    }
  }

  /** Returns 'up' when Redis answers PING, 'down' otherwise (never throws). */
  async ping(): Promise<'up' | 'down'> {
    if (!this.client) return 'down';
    try {
      const result = await this.client.ping();
      return result === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  async onModuleDestroy() {
    const client = this.client;
    if (client) {
      await client.quit().catch(() => client.disconnect());
    }
  }
}

@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
