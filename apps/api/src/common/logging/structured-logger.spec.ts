import { StructuredLogger, isJsonLogging } from './structured-logger';

describe('isJsonLogging', () => {
  it('enables JSON when LOG_FORMAT=json', () => {
    expect(isJsonLogging({ LOG_FORMAT: 'json' })).toBe(true);
  });

  it('keeps text when LOG_FORMAT=text even in production', () => {
    expect(isJsonLogging({ LOG_FORMAT: 'text', NODE_ENV: 'production' })).toBe(false);
  });

  it('defaults to JSON in production', () => {
    expect(isJsonLogging({ NODE_ENV: 'production' })).toBe(true);
  });

  it('defaults to text in development', () => {
    expect(isJsonLogging({ NODE_ENV: 'development' })).toBe(false);
    expect(isJsonLogging({})).toBe(false);
  });
});

describe('StructuredLogger', () => {
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  beforeEach(() => {
    stdout = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });

  describe('JSON mode', () => {
    it('writes a single parseable JSON line per log call', () => {
      const logger = new StructuredLogger('TestCtx', true);
      logger.log('hello world');

      expect(stdout).toHaveBeenCalledTimes(1);
      const line = stdout.mock.calls[0][0] as string;
      expect(line.endsWith('\n')).toBe(true);

      const entry = JSON.parse(line);
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('hello world');
      expect(entry.context).toBe('TestCtx');
      expect(typeof entry.timestamp).toBe('string');
      expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
    });

    it('includes meta fields and maps log levels correctly', () => {
      const logger = new StructuredLogger('HTTP', true);
      logger.logWithMeta('log', 'GET /api/events', {
        method: 'GET',
        statusCode: 200,
        durationMs: 12,
        requestId: 'req-1',
      });

      const entry = JSON.parse(stdout.mock.calls[0][0] as string);
      expect(entry.message).toBe('GET /api/events');
      expect(entry.method).toBe('GET');
      expect(entry.statusCode).toBe(200);
      expect(entry.durationMs).toBe(12);
      expect(entry.requestId).toBe('req-1');
    });

    it('routes errors to stderr with a stack field', () => {
      const logger = new StructuredLogger('Filter', true);
      logger.error('boom', 'stack-line-1');

      expect(stderr).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(stderr.mock.calls[0][0] as string);
      expect(entry.level).toBe('error');
      expect(entry.message).toBe('boom');
      expect(entry.stack).toBe('stack-line-1');
    });

    it('omits undefined meta values', () => {
      const logger = new StructuredLogger('HTTP', true);
      logger.logWithMeta('warn', 'slow request', { durationMs: 5000, requestId: undefined });

      const entry = JSON.parse(stdout.mock.calls[0][0] as string);
      expect(entry.durationMs).toBe(5000);
      expect(entry).not.toHaveProperty('requestId');
    });

    it('meta overrides are kept distinct from reserved fields', () => {
      const logger = new StructuredLogger('HTTP', true);
      logger.logWithMeta('log', 'msg', { level: 'IGNORED_ME' });

      const entry = JSON.parse(stdout.mock.calls[0][0] as string);
      expect(entry.level).toBe('info');
    });
  });

  describe('text mode', () => {
    it('delegates to human-readable Nest output, not JSON', () => {
      const logger = new StructuredLogger('TestCtx', false);
      logger.log('plain message');

      const combined = stdout.mock.calls.map((c) => c[0] as string).join('');
      expect(combined).toContain('plain message');
      expect(() => JSON.parse(combined)).toThrow();
    });
  });
});
