import { SchedulerManager } from './scheduler.manager';

describe('SchedulerManager', () => {
  let scheduler: SchedulerManager;
  const mockLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    scheduler = new SchedulerManager(mockLogger);
  });

  afterEach(async () => {
    await scheduler.stop(1000);
  });

  describe('registration', () => {
    it('registers a valid background job definition', () => {
      scheduler.registerJob({
        name: 'test-job',
        intervalMs: 1000,
        handler: async () => {},
      });

      const status = scheduler.getJobStatus('test-job');
      expect(status).not.toBeNull();
      expect(status?.name).toBe('test-job');
      expect(status?.intervalMs).toBe(1000);
      expect(status?.enabled).toBe(true);
      expect(status?.runCount).toBe(0);
    });

    it('rejects registering duplicate job names', () => {
      scheduler.registerJob({
        name: 'unique-job',
        intervalMs: 1000,
        handler: async () => {},
      });

      expect(() =>
        scheduler.registerJob({
          name: 'unique-job',
          intervalMs: 2000,
          handler: async () => {},
        }),
      ).toThrow(/already registered/i);
    });

    it('rejects non-positive intervalMs', () => {
      expect(() =>
        scheduler.registerJob({
          name: 'bad-interval',
          intervalMs: 0,
          handler: async () => {},
        }),
      ).toThrow(/greater than 0/i);
    });
  });

  describe('execution & overlap prevention', () => {
    it('executes job successfully and updates metrics', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      scheduler.registerJob({
        name: 'metric-job',
        intervalMs: 5000,
        handler,
      });

      const success = await scheduler.executeJob('metric-job');
      expect(success).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);

      const status = scheduler.getJobStatus('metric-job');
      expect(status?.runCount).toBe(1);
      expect(status?.lastSuccessAt).not.toBeNull();
      expect(status?.lastError).toBeNull();
      expect(status?.consecutiveFailures).toBe(0);
    });

    it('prevents overlapping execution when job is already running', async () => {
      let resolveJob!: () => void;
      const slowPromise = new Promise<void>((r) => {
        resolveJob = r;
      });

      const handler = jest.fn().mockImplementation(() => slowPromise);

      scheduler.registerJob({
        name: 'slow-job',
        intervalMs: 5000,
        handler,
      });

      // Start first execution (stays in-flight)
      const execution1 = scheduler.executeJob('slow-job');

      // Attempt overlapping second execution
      const execution2Result = await scheduler.executeJob('slow-job');
      expect(execution2Result).toBe(false); // skipped due to overlap
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('already in progress; skipping overlapping tick'),
      );

      // Finish first execution
      resolveJob();
      const execution1Result = await execution1;
      expect(execution1Result).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('handles job failure safely, isolates error, and sanitizes secrets', async () => {
      const handler = jest.fn().mockRejectedValue(
        new Error('Payment failed with secret=xyz123 and Bearer eyJhbGciOiJIUzI1NiJ9'),
      );

      scheduler.registerJob({
        name: 'failing-job',
        intervalMs: 5000,
        handler,
      });

      const success = await scheduler.executeJob('failing-job');
      expect(success).toBe(false);

      const status = scheduler.getJobStatus('failing-job');
      expect(status?.runCount).toBe(1);
      expect(status?.lastSuccessAt).toBeNull();
      expect(status?.consecutiveFailures).toBe(1);
      expect(status?.lastError).toContain('secret=[REDACTED]');
      expect(status?.lastError).toContain('Bearer [REDACTED]');
      expect(status?.lastError).not.toContain('xyz123');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('secret=[REDACTED]'),
      );
    });
  });

  describe('start & graceful shutdown', () => {
    it('schedules timers on start and stops them cleanly on stop', async () => {
      jest.useFakeTimers();
      const handler = jest.fn().mockResolvedValue(undefined);

      scheduler.registerJob({
        name: 'timer-job',
        intervalMs: 1000,
        handler,
      });

      scheduler.start();
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Scheduled background job "timer-job"'),
      );

      // Advance time by 2.5 intervals
      await jest.advanceTimersByTimeAsync(2500);
      expect(handler).toHaveBeenCalledTimes(2);

      await scheduler.stop(500);
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Background scheduler stopped successfully'),
      );

      // Advance time further after stop; handler should not fire again
      await jest.advanceTimersByTimeAsync(3000);
      expect(handler).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('runs on start when runOnStart is true', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      scheduler.registerJob({
        name: 'immediate-job',
        intervalMs: 10000,
        handler,
        runOnStart: true,
      });

      scheduler.start();
      // Allow microtask to resolve
      await new Promise((r) => setImmediate(r));

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
