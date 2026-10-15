import { Logger } from '@nestjs/common';

export interface BackgroundJobDefinition {
  name: string;
  intervalMs: number;
  handler: () => Promise<unknown>;
  runOnStart?: boolean;
  enabled?: boolean;
}

export interface BackgroundJobStatus {
  name: string;
  intervalMs: number;
  enabled: boolean;
  isRunning: boolean;
  runCount: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}

export class SchedulerManager {
  private readonly logger: Logger;
  private readonly jobs = new Map<
    string,
    {
      def: BackgroundJobDefinition;
      timer: NodeJS.Timeout | null;
      isRunning: boolean;
      runCount: number;
      lastRunAt: Date | null;
      lastSuccessAt: Date | null;
      lastError: string | null;
      consecutiveFailures: number;
    }
  >();
  private isStarted = false;
  private isStopping = false;

  constructor(customLogger?: Logger) {
    this.logger = customLogger ?? new Logger(SchedulerManager.name);
  }

  registerJob(def: BackgroundJobDefinition): void {
    if (this.jobs.has(def.name)) {
      throw new Error(`Job "${def.name}" is already registered`);
    }
    if (def.intervalMs <= 0) {
      throw new Error(`Job "${def.name}" must have an intervalMs greater than 0`);
    }

    this.jobs.set(def.name, {
      def: { ...def, enabled: def.enabled ?? true },
      timer: null,
      isRunning: false,
      runCount: 0,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      consecutiveFailures: 0,
    });
  }

  start(): void {
    if (this.isStarted || this.isStopping) return;
    this.isStarted = true;

    for (const [name, job] of this.jobs.entries()) {
      if (!job.def.enabled) {
        this.logger.debug(`Job "${name}" is disabled; skipping schedule`);
        continue;
      }

      if (job.def.runOnStart) {
        void this.executeJob(name);
      }

      job.timer = setInterval(() => {
        void this.executeJob(name);
      }, job.def.intervalMs);

      // Unref ensures interval timers do not keep Node process alive if shutdown occurs
      if (typeof job.timer.unref === 'function') {
        job.timer.unref();
      }

      this.logger.log(
        `Scheduled background job "${name}" every ${(job.def.intervalMs / 1000).toFixed(0)}s`,
      );
    }
  }

  async executeJob(name: string): Promise<boolean> {
    const job = this.jobs.get(name);
    if (!job) return false;
    if (this.isStopping) {
      this.logger.debug(`Scheduler stopping; skipping execution of job "${name}"`);
      return false;
    }

    // Overlap prevention: skip tick if previous execution is still in flight
    if (job.isRunning) {
      this.logger.debug(
        `Job "${name}" execution already in progress; skipping overlapping tick`,
      );
      return false;
    }

    job.isRunning = true;
    job.runCount++;
    job.lastRunAt = new Date();

    try {
      await job.def.handler();
      job.lastSuccessAt = new Date();
      job.lastError = null;
      job.consecutiveFailures = 0;
      return true;
    } catch (err) {
      job.consecutiveFailures++;
      const safeMessage = this.sanitizeErrorMessage(err);
      job.lastError = safeMessage;
      this.logger.error(
        `Background job "${name}" failed (attempt #${job.consecutiveFailures}): ${safeMessage}`,
      );
      return false;
    } finally {
      job.isRunning = false;
    }
  }

  async stop(timeoutMs = 10_000): Promise<void> {
    if (!this.isStarted) return;
    this.isStopping = true;
    this.logger.log('Stopping background scheduler and clearing job timers...');

    // 1. Clear all intervals
    for (const job of this.jobs.values()) {
      if (job.timer) {
        clearInterval(job.timer);
        job.timer = null;
      }
    }

    // 2. Wait for any currently running handlers to finish
    const startTime = Date.now();
    while (Array.from(this.jobs.values()).some((j) => j.isRunning)) {
      if (Date.now() - startTime >= timeoutMs) {
        this.logger.warn(
          `Timed out after ${timeoutMs}ms waiting for in-flight background jobs to settle`,
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.isStarted = false;
    this.isStopping = false;
    this.logger.log('Background scheduler stopped successfully');
  }

  getJobStatus(name: string): BackgroundJobStatus | null {
    const job = this.jobs.get(name);
    if (!job) return null;
    return {
      name: job.def.name,
      intervalMs: job.def.intervalMs,
      enabled: job.def.enabled ?? true,
      isRunning: job.isRunning,
      runCount: job.runCount,
      lastRunAt: job.lastRunAt ? job.lastRunAt.toISOString() : null,
      lastSuccessAt: job.lastSuccessAt ? job.lastSuccessAt.toISOString() : null,
      lastError: job.lastError,
      consecutiveFailures: job.consecutiveFailures,
    };
  }

  getAllJobStatuses(): BackgroundJobStatus[] {
    return Array.from(this.jobs.keys()).map((name) => this.getJobStatus(name)!);
  }

  private sanitizeErrorMessage(err: unknown): string {
    if (!err) return 'Unknown error';
    let message = err instanceof Error ? err.message : String(err);
    // Redact tokens, keys, secrets, authorization headers
    message = message.replace(/(key|secret|token|auth|password|signature)[=:][^&\s]+/gi, '$1=[REDACTED]');
    message = message.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');
    return message;
  }
}
