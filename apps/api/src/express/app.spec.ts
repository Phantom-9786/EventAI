import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createExpressApp } from './app';
import { StructuredLogger } from '../common/logging/structured-logger';
import { PrismaClient } from '@eventai/database';
import { CacheService } from '../common/cache/cache.service';

describe('Express Foundation App', () => {
  let server: Server;
  let baseUrl: string;

  const mockPrisma = {
    $queryRaw: jest.fn(),
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
  } as unknown as PrismaClient;

  const mockCache = {
    ping: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  } as unknown as CacheService;

  const nullLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    logWithMeta: jest.fn(),
  } as unknown as StructuredLogger;

  beforeAll((done) => {
    const app = createExpressApp({
      prisma: mockPrisma,
      cache: mockCache,
      logger: nullLogger,
      env: {
        FRONTEND_URL: 'http://localhost:3000',
        NODE_ENV: 'test',
      },
    });

    server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Root and Status Endpoints', () => {
    it.each(['/health', '/api/health', '/api/health/live', '/health/live'])('answers %s without querying database or Redis', async (path) => {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok', service: 'eventpoint-api' });
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
      expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(mockCache.ping).not.toHaveBeenCalled();
      expect(mockCache.get).not.toHaveBeenCalled();
    });
    it('returns the friendly root status payload on GET /', async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        status: 'ok',
        service: 'EventPoint API',
        version: '1.0.0',
        docs: '/api/docs',
        health: '/api/health',
        frontend: 'http://localhost:3000',
      });
    });
  });

  describe('Readiness Endpoint (GET /api/health/ready)', () => {
    it('returns HTTP 200 when database and redis are healthy', async () => {
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ '?column?': 1 }]);
      (mockCache.ping as jest.Mock).mockResolvedValueOnce('up');

      const res = await fetch(`${baseUrl}/api/health/ready`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe('ok');
      expect(body.service).toBe('eventpoint-api');
      expect(body.dependencies).toEqual({
        database: 'up',
        redis: 'up',
      });
      expect(typeof body.timestamp).toBe('string');
    });

    it('returns HTTP 503 when the database is unavailable', async () => {
      (mockPrisma.$queryRaw as jest.Mock).mockRejectedValueOnce(new Error('DB Connection Refused'));
      (mockCache.ping as jest.Mock).mockResolvedValueOnce('up');

      const res = await fetch(`${baseUrl}/api/health/ready`);
      expect(res.status).toBe(503);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe('error');
      expect(body.dependencies).toEqual({
        database: 'down',
        redis: 'up',
      });
    });

    it('returns HTTP 200 when redis is down but database is healthy (graceful degradation)', async () => {
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ '?column?': 1 }]);
      (mockCache.ping as jest.Mock).mockResolvedValueOnce('down');

      const res = await fetch(`${baseUrl}/api/health/ready`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe('ok');
      expect(body.dependencies).toEqual({
        database: 'up',
        redis: 'down',
      });
    });
  });

  describe('CORS Configuration', () => {
    it('sets CORS headers matching the configured FRONTEND_URL', async () => {
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: 'http://localhost:3000' },
      });

      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    });

    it('handles CORS preflight OPTIONS requests', async () => {
      const res = await fetch(`${baseUrl}/api/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, X-Idempotency-Key',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    });
  });

  describe('Request ID Handling', () => {
    it('generates a UUID X-Request-Id header when none is provided', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      const requestId = res.headers.get('x-request-id');

      expect(requestId).toBeDefined();
      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('preserves and echos a valid client-supplied X-Request-Id', async () => {
      const clientReqId = 'custom-request-id-12345';
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: { 'X-Request-Id': clientReqId },
      });

      expect(res.headers.get('x-request-id')).toBe(clientReqId);
    });

    it('replaces an invalid X-Request-Id format with a newly generated UUID', async () => {
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: { 'X-Request-Id': 'invalid spaces not allowed!!' },
      });

      const requestId = res.headers.get('x-request-id');
      expect(requestId).not.toBe('invalid spaces not allowed!!');
      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  describe('Error Handling Envelope and 404s', () => {
    it('formats 404 Not Found using the exact ErrorEnvelope API contract', async () => {
      const res = await fetch(`${baseUrl}/api/unknown-endpoint`);
      expect(res.status).toBe(404);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        success: false,
        statusCode: 404,
        error: 'Not Found',
        message: 'Cannot GET /api/unknown-endpoint',
        path: '/api/unknown-endpoint',
      });
      expect(typeof body.timestamp).toBe('string');
      expect(body.requestId).toBeDefined();
    });

    it('handles malformed JSON payloads and returns 400 Bad Request envelope', async () => {
      const res = await fetch(`${baseUrl}/api/test/raw-body`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'json-test-req-id',
        },
        body: '{"invalid_json": true, missing_closing_brace',
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        success: false,
        statusCode: 400,
        error: 'Bad Request',
        message: 'Malformed JSON in request body',
        path: '/api/test/raw-body',
        timestamp: expect.any(String),
        requestId: 'json-test-req-id',
      });
    });
  });

  describe('Raw-Body Capture (Razorpay Webhook Contract)', () => {
    it('captures the exact raw request buffer without alteration', async () => {
      const payloadString = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_test_12345',
              amount: 49900,
              currency: 'INR',
              order_id: 'order_test_98765',
            },
          },
        },
      });

      const res = await fetch(`${baseUrl}/api/test/raw-body`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'raw-body-test-id',
        },
        body: payloadString,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        received: boolean;
        hasRawBody: boolean;
        rawBodyLength: number;
        rawBodyString: string;
        parsedBody: Record<string, unknown>;
      };

      expect(body.received).toBe(true);
      expect(body.hasRawBody).toBe(true);
      expect(body.rawBodyLength).toBe(Buffer.byteLength(payloadString));
      expect(body.rawBodyString).toBe(payloadString);
      expect(body.parsedBody).toEqual(JSON.parse(payloadString));
    });
  });
});
