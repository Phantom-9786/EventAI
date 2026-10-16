import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { createExpressApp } from './app';
import { StructuredLogger } from '../common/logging/structured-logger';
import { PrismaClient } from '@eventai/database';
import { CacheService } from '../common/cache/cache.service';
import { AiService } from '../modules/ai/ai.service';
import { ServiceUnavailableException } from '../common/exceptions';

const TEST_JWT_SECRET = 'test-secret-at-least-32-chars-long-abc-123';

describe('Express AI & Streaming Module', () => {
  let server: Server;
  let baseUrl: string;

  const nullLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    logWithMeta: jest.fn(),
  } as unknown as StructuredLogger;

  const mockPrisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
    event: {
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  } as unknown as PrismaClient;

  let mockCache: {
    ping: jest.Mock;
    consumeAiRequest: jest.Mock;
    releaseAiRequest: jest.Mock;
    providerCooldownMs: jest.Mock;
    setProviderCooldown: jest.Mock;
  };

  let mockAiService: {
    isConfigured: jest.Mock;
    chat: jest.Mock;
  };

  const startTestServer = (overrides?: {
    cache?: Partial<typeof mockCache>;
    aiService?: Partial<typeof mockAiService>;
  }) => {
    mockCache = {
      ping: jest.fn().mockResolvedValue('PONG'),
      consumeAiRequest: jest.fn().mockResolvedValue({ allowed: true }),
      releaseAiRequest: jest.fn().mockResolvedValue(undefined),
      providerCooldownMs: jest.fn().mockResolvedValue(0),
      setProviderCooldown: jest.fn().mockResolvedValue(undefined),
      ...overrides?.cache,
    };

    mockAiService = {
      isConfigured: jest.fn().mockReturnValue(true),
      chat: jest.fn().mockResolvedValue({
        reply: 'Here are some great upcoming events for you in Mumbai!',
        events: [
          {
            id: 'evt-1',
            title: 'Mumbai Indie Night',
            slug: 'mumbai-indie-night',
            shortDescription: 'Indie music night',
            startDate: '2026-10-24T18:00:00.000Z',
            endDate: '2026-10-24T22:00:00.000Z',
            images: [],
            isFeatured: true,
            minPrice: 49900,
            maxPrice: 99900,
            category: { id: 'cat-1', name: 'Music', slug: 'music' },
            venue: { id: 'ven-1', name: 'Demo Arena', city: 'Mumbai' },
            organizer: { id: 'org-1', organizationName: 'Indie Collective' },
          },
        ],
      }),
      ...overrides?.aiService,
    };

    const app = createExpressApp({
      prisma: mockPrisma,
      cache: mockCache as unknown as CacheService,
      aiService: mockAiService as unknown as AiService,
      logger: nullLogger,
      env: {
        FRONTEND_URL: 'http://localhost:3000',
        NODE_ENV: 'test',
        JWT_SECRET: 'test-secret-at-least-32-chars-long-abc-123',
      },
    });

    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  };

  beforeEach(async () => {
    await startTestServer();
  });

  afterEach((done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  describe('POST /api/ai/chat JSON Mode', () => {
    it('returns 200 with grounded events and reply', async () => {
      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'What concerts are happening in Mumbai?' }],
        }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.configured).toBe(true);
      expect(json.reply).toContain('Mumbai');
      expect(json.events).toHaveLength(1);
      expect(json.events[0].title).toBe('Mumbai Indie Night');
      expect(json.events[0].slug).toBe('mumbai-indie-night');
      expect(mockCache.consumeAiRequest).toHaveBeenCalledTimes(1);
      expect(mockCache.releaseAiRequest).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid payload (empty messages) with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [],
        }),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.success).toBe(false);
      expect(json.statusCode).toBe(400);
    });

    it('rejects invalid message role with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'invalid_role', content: 'hello' }],
        }),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.success).toBe(false);
    });

    it('enforces rate limit (429 Too Many Requests) when quota is exhausted', async () => {
      mockCache.consumeAiRequest.mockResolvedValueOnce({ allowed: false });

      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello assistant' }],
        }),
      });

      expect(res.status).toBe(429);
      const json = (await res.json()) as any;
      expect(json.statusCode).toBe(429);
      expect(json.message).toContain('limit reached');
      expect(mockAiService.chat).not.toHaveBeenCalled();
    });

    it('returns 503 Service Unavailable when Redis/cache fails in guard', async () => {
      mockCache.consumeAiRequest.mockRejectedValueOnce(new Error('Redis connection lost'));

      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello assistant' }],
        }),
      });

      expect(res.status).toBe(503);
      const json = (await res.json()) as any;
      expect(json.statusCode).toBe(503);
      expect(json.message).toContain('temporarily unavailable');
    });

    it('returns 503 with retryAfterSeconds when AiService throws ServiceUnavailableException', async () => {
      mockAiService.chat.mockRejectedValueOnce(
        new ServiceUnavailableException({
          statusCode: 503,
          message: 'The AI assistant is rate limited right now. Please retry shortly.',
          retryAfterSeconds: 45,
        }),
      );

      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Recommend events' }],
        }),
      });

      expect(res.status).toBe(503);
      expect(res.headers.get('Retry-After')).toBe('45');
      const json = (await res.json()) as any;
      expect(json.statusCode).toBe(503);
      expect(json.retryAfterSeconds).toBe(45);
      expect(json.message).toContain('rate limited');
    });

    it('uses authenticated user identity hash in rate limiter when valid bearer token is provided', async () => {
      const validToken = jwt.sign(
        { sub: 'usr-verified-42', email: 'verified@example.com', role: 'CUSTOMER' },
        TEST_JWT_SECRET,
        { expiresIn: '1h' },
      );
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'usr-verified-42',
        email: 'verified@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'What is happening this weekend?' }],
        }),
      });

      expect(res.status).toBe(200);
      const expectedHash = createHash('sha256').update('user:usr-verified-42').digest('hex');
      expect(mockCache.consumeAiRequest).toHaveBeenCalledWith(
        expectedHash,
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(String),
      );
    });

    it('uses hashed client IP for anonymous requests and does not trust arbitrary spoofed headers', async () => {
      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.254',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Tell me about festivals' }],
        }),
      });

      expect(res.status).toBe(200);
      // ConsumeAiRequest must be called with a 64-char hex hash
      expect(mockCache.consumeAiRequest).toHaveBeenCalledWith(
        expect.stringMatching(/^[a-f0-9]{64}$/),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(String),
      );
      // Ensure the identity was not the raw spoofed IP
      const spoofedHash = createHash('sha256').update('ip:198.51.100.254').digest('hex');
      expect(mockCache.consumeAiRequest.mock.calls[0][0]).not.toBe(spoofedHash);
    });

    it('enforces 429 when concurrency limit is reached without leaking internal details', async () => {
      mockCache.consumeAiRequest.mockResolvedValueOnce({ allowed: false, reason: 'concurrency' });

      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Concurrent prompt' }],
        }),
      });

      expect(res.status).toBe(429);
      const json = (await res.json()) as any;
      expect(json.statusCode).toBe(429);
      expect(json.message).toBe('AI request limit reached. Please retry shortly.');
      expect(json).not.toHaveProperty('concurrency');
      expect(json).not.toHaveProperty('leaseId');
    });

    it('releases concurrency lease with matching leaseId upon request finish', async () => {
      let capturedLeaseId = '';
      mockCache.consumeAiRequest.mockImplementationOnce(
        async (_idHash, _userLim, _globLim, _concLim, leaseId) => {
          capturedLeaseId = leaseId;
          return { allowed: true };
        },
      );

      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Check lease release' }],
        }),
      });

      expect(res.status).toBe(200);
      expect(capturedLeaseId).toBeTruthy();
      expect(mockCache.releaseAiRequest).toHaveBeenCalledWith(capturedLeaseId);
    });
  });

  describe('POST /api/ai/chat SSE Streaming Mode', () => {
    it('returns 200 with text/event-stream headers and data chunks when Accept header is set', async () => {
      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Stream some event recommendations' }],
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');
      expect(res.headers.get('Cache-Control')).toContain('no-cache');

      const text = await res.text();
      expect(text).toContain('data: {');
      expect(text).toContain('Mumbai Indie Night');
      expect(text).toContain('data: [DONE]');
      expect(mockCache.releaseAiRequest).toHaveBeenCalled();
    });

    it('returns 200 with text/event-stream when query stream=true is passed', async () => {
      const res = await fetch(`${baseUrl}/api/ai/chat?stream=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Stream with query param' }],
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');

      const text = await res.text();
      expect(text).toContain('data: {');
      expect(text).toContain('data: [DONE]');
    });

    it('handles stream error safely without leaking credentials', async () => {
      mockAiService.chat.mockRejectedValueOnce(new Error('Internal model failure'));

      const res = await fetch(`${baseUrl}/api/ai/chat?stream=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Test stream failure' }],
        }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('data: {"error":');
      expect(text).not.toContain('gsk_');
      expect(text).not.toContain('stack');
    });
  });

  describe('AiService Provider Logic with Key Rotation & Cooldowns', () => {
    const KEY_1 = 'gsk-key-11111111111111111111';
    const KEY_2 = 'gsk-key-22222222222222222222';

    let realAiService: AiService;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      process.env.GROQ_API_KEYS = `${KEY_1},${KEY_2}`;
      realAiService = new AiService(
        mockPrisma as any,
        mockCache as unknown as CacheService,
      );
    });

    afterEach(() => {
      global.fetch = originalFetch;
      delete process.env.GROQ_API_KEYS;
    });

    it('rotates to next key when the first returns 401 Unauthorized', async () => {
      (mockPrisma.event.findMany as jest.Mock).mockResolvedValue([]);

      let callCount = 0;
      global.fetch = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
        callCount++;
        const auth = (init.headers as Record<string, string>)?.Authorization;
        if (auth?.includes(KEY_1)) {
          return Promise.resolve(new Response(JSON.stringify({ error: 'invalid_key' }), { status: 401 }));
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Success from key 2!' } }],
            }),
            { status: 200 },
          ),
        );
      });

      const result = await realAiService.chat([{ role: 'user', content: 'Hello' }]);
      expect(result.reply).toBe('Success from key 2!');
      expect(callCount).toBe(2);
      expect(mockCache.setProviderCooldown).toHaveBeenCalled();
    });

    it('handles 429 rate limit with Retry-After and sets shared quota cooldown', async () => {
      (mockPrisma.event.findMany as jest.Mock).mockResolvedValue([]);

      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'rate_limited' }), {
          status: 429,
          headers: { 'retry-after': '30' },
        }),
      );

      await expect(
        realAiService.chat([{ role: 'user', content: 'Rate limited question' }]),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(mockCache.setProviderCooldown).toHaveBeenCalled();
    });
  });
});
