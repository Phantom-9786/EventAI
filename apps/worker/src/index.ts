// ═══════════════════════════════════════════════════
// EventAI Worker — BullMQ background job processor
// Skeleton: Redis connection + queue registry +
// graceful shutdown. Job processors land in Phase 3/4.
// ═══════════════════════════════════════════════════

import IORedis from 'ioredis';
import { Worker, type Processor } from 'bullmq';

// ── Queue names (single source of truth) ───────────
export const QUEUES = {
  SEAT_HOLD_EXPIRATION: 'seat-hold-expiration',
  EMAIL: 'email',
  TICKET_GENERATION: 'ticket-generation',
  PAYMENT_PROCESSING: 'payment-processing',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// ── Redis connection ───────────────────────────────
const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

connection.on('error', () => {
  console.error('[worker] Redis connection unavailable');
});

connection.on('connect', () => {
  console.log('[worker] Connected to Redis');
});

// ── Processors (registered by feature modules) ─────
const processors = new Map<QueueName, Processor>();

export function registerProcessor(queue: QueueName, processor: Processor): void {
  processors.set(queue, processor);
}

// ── Worker bootstrap ───────────────────────────────
const workers: Worker[] = [];

function startWorkers(): void {
  for (const [queue, processor] of processors) {
    const worker = new Worker(queue, processor, {
      connection,
      concurrency: 5,
    });

    worker.on('completed', (job) => {
      console.log(`[worker] ${queue}: job ${job.id} completed`);
    });

    worker.on('failed', (job, err) => {
      console.error(`[worker] ${queue}: job ${job?.id} failed (${err.name})`);
    });

    workers.push(worker);
    console.log(`[worker] Worker started for queue: ${queue}`);
  }
}

// ── Graceful shutdown ──────────────────────────────
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[worker] Received ${signal}, shutting down gracefully...`);

  await Promise.allSettled([
    ...workers.map((w) => w.close()),
    connection.quit(),
  ]);

  console.log('[worker] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// ── Entry point ────────────────────────────────────
console.log('[worker] EventAI worker starting...');
console.log('[worker] No processors registered yet (Phase 3/4). Idling.');
startWorkers();
