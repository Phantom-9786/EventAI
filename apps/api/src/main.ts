import { resolve } from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@eventai/database';
import { CacheService } from './common/cache/cache.service';
import { StructuredLogger, isJsonLogging } from './common/logging/structured-logger';
import { validateEnv } from './config/env.validation';
import { initSentry } from './config/sentry';
import { createExpressApp } from './express/app';
import { BookingsService } from './modules/bookings/bookings.service';
import { PaymentsService } from './modules/payments/payments.service';
import { NotificationsService } from './modules/notifications/notifications.service';
import { EventMediaService } from './modules/events/event-media.service';
import { SchedulerManager } from './common/scheduler/scheduler.manager';

// Load local environment files if present
dotenv.config();
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), 'apps/api/.env') });

async function bootstrap() {
  // 1. Initialize Sentry error monitoring early
  initSentry();

  // 2. Validate environment variables (fail fast on boot)
  const env = validateEnv(process.env as Record<string, unknown>);
  const port = env.PORT ?? 4000;
  const jsonMode = isJsonLogging({
    LOG_FORMAT: process.env.LOG_FORMAT,
    NODE_ENV: env.NODE_ENV,
  });

  const logger = new StructuredLogger('ExpressBootstrap', jsonMode);

  // 3. Ensure local uploads directory exists
  const uploadDir = resolve(process.cwd(), process.env.UPLOAD_DIR ?? './uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // 4. Initialize Prisma and Cache singletons
  const prisma = new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  const cache = new CacheService({
    get: (key: string) => (env as unknown as Record<string, unknown>)[key] ?? process.env[key],
  } as never);

  try {
    await prisma.$connect();
    logger.log('PostgreSQL connection established for Express');
  } catch (err) {
    logger.error(
      'Failed to connect to PostgreSQL on Express startup',
      err instanceof Error ? err.stack : undefined,
    );
    process.exit(1);
  }

  // 5. Initialize shared business services and background schedulers
  const notificationsService = new NotificationsService(prisma as never);
  const paymentsService = new PaymentsService(prisma as never, notificationsService as never);
  const mediaService = new EventMediaService(prisma as never);
  const bookingsService = new BookingsService(
    prisma as never,
    paymentsService as never,
    notificationsService as never,
  );

  // 6. Create Express application
  const app = createExpressApp({
    prisma,
    cache,
    bookingsService,
    paymentsService,
    notificationsService,
    mediaService,
    env,
    logger,
  });

  // 7. Start HTTP server
  const server = app.listen(port, () => {
    logger.log(`🚀 EventAI Express API running on http://localhost:${port}`);
    logger.log(`🩺 Health check at http://localhost:${port}/api/health`);
    logger.log(`📁 Uploads mounted from ${uploadDir} at /uploads`);
  });

  // 8. Managed background scheduler
  const scheduler = new SchedulerManager(logger as never);
  scheduler.registerJob({
    name: 'stale-bookings-expiration',
    intervalMs: 60_000,
    handler: async () => {
      await bookingsService.handleStaleBookingsCron();
    },
  });

  scheduler.registerJob({
    name: 'cloudinary-usage-monitor',
    intervalMs: 10 * 60_000, // 10 minutes (lightweight, non-aggressive check)
    handler: async () => {
      if (mediaService.isCloudinaryConfigured()) {
        const statuses = await mediaService.getProviderStatusList();
        const active = statuses.filter((s) => s.eligible).length;
        logger.log(`Cloudinary usage monitor: ${active}/${statuses.length} provider(s) eligible`);
      }
    },
  });

  scheduler.start();

  // 9. Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}, closing Express server gracefully...`);
    await scheduler.stop();

    server.close(async () => {
      logger.log('HTTP server closed');
      try {
        await prisma.$disconnect();
        logger.log('Prisma disconnected');
      } catch (e) {
        logger.error('Error disconnecting Prisma', e instanceof Error ? e.stack : undefined);
      }
      try {
        await cache.onModuleDestroy();
        logger.log('Cache connection closed');
      } catch (e) {
        logger.error('Error closing cache', e instanceof Error ? e.stack : undefined);
      }
      process.exit(0);
    });

    // Force exit after 10 seconds if graceful shutdown stalls
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('Express bootstrap error:', err);
    process.exit(1);
  });
}
