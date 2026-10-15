import { resolve } from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@eventai/database';
import { CacheService } from '../common/cache/cache.service';
import { StructuredLogger, isJsonLogging } from '../common/logging/structured-logger';
import { validateEnv } from '../config/env.validation';
import { initSentry } from '../config/sentry';
import { createExpressApp } from './app';

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

  // 3. Initialize Prisma and Cache singletons
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
    logger.error('Failed to connect to PostgreSQL on Express startup', err instanceof Error ? err.stack : undefined);
    process.exit(1);
  }

  // 4. Create Express app with shared infrastructure
  const app = createExpressApp({ prisma, cache, env, logger });

  // 5. Start HTTP server
  const server = app.listen(port, () => {
    logger.log(`🚀 EventAI Express API running on http://localhost:${port}`);
    logger.log(`🩺 Health check at http://localhost:${port}/api/health`);
  });

  // 6. Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}, closing Express server gracefully...`);
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
