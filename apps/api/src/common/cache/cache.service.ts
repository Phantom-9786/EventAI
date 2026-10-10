import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

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
