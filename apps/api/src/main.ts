import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { resolve } from 'path';
import * as fs from 'fs';
import { AppModule } from './app.module';
import { isJsonLogging, StructuredLogger } from './common/logging/structured-logger';
import { initSentry } from './config/sentry';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // ── Error monitoring (no-op without SENTRY_DSN). Must run before the Nest
  // app is created so the nest integration can capture early exceptions. ──
  initSentry();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
    rawBody: true, // required for Razorpay webhook signature verification
  });
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 4000);
  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:3000');

  // ── Structured logging ─────────────────────────────
  const jsonMode = isJsonLogging({
    LOG_FORMAT: configService.get<string>('LOG_FORMAT'),
    NODE_ENV: configService.get<string>('NODE_ENV'),
  });
  const appLogger = new StructuredLogger('App', jsonMode);
  app.useLogger(appLogger);

  // ── Security ──────────────────────────────────────
  app.use(helmet());
  app.use(cookieParser());

  // ── Request IDs + structured request logging ─────
  const httpLogger = new StructuredLogger('HTTP', jsonMode);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const suppliedRequestId = req.headers['x-request-id'];
    const requestId = typeof suppliedRequestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);
    const start = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - start;
      httpLogger.logWithMeta('log', `${req.method} ${req.path}`, {
        method: req.method,
        url: req.path,
        statusCode: res.statusCode,
        durationMs,
        requestId,
      });
    });
    next();
  });

  // ── CORS ──────────────────────────────────────────
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
  });

  // ── Global prefix ─────────────────────────────────
  app.setGlobalPrefix('api');

  // ── Root landing route (friendly status endpoint) ─
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.get('/', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'EventAI API',
      version: '1.0.0',
      docs: '/api/docs',
      health: '/api/health',
      frontend: frontendUrl,
    });
  });

  // ── Static uploads ────────────────────────────────
  // Serve locally-stored uploads (avatars etc.) at /uploads
  const uploadDir = resolve(process.cwd(), configService.get<string>('UPLOAD_DIR', './uploads'));
  fs.mkdirSync(uploadDir, { recursive: true });
  app.useStaticAssets(uploadDir, {
    prefix: '/uploads',
    index: false,
    fallthrough: false,
    maxAge: '1d',
  });
  logger.log(`Uploads served from ${uploadDir} at /uploads`);

  // ── Validation ────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Swagger ───────────────────────────────────────
  if (configService.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('EventAI API')
      .setDescription('AI-powered Event Discovery and Ticket Booking Platform')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication endpoints')
      .addTag('users', 'User management')
      .addTag('events', 'Event management')
      .addTag('venues', 'Venue management')
      .addTag('tickets', 'Ticket management')
      .addTag('bookings', 'Booking management')
      .addTag('payments', 'Payment processing')
      .addTag('notifications', 'Notifications')
      .addTag('organizer', 'Organizer dashboard')
      .addTag('admin', 'Admin dashboard')
      .addTag('ai', 'AI assistant')
      .addTag('health', 'Health checks')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  // ── Start ─────────────────────────────────────────
  await app.listen(port);
  logger.log(`🚀 EventAI API running on http://localhost:${port}`);
  logger.log(`📚 Swagger docs at http://localhost:${port}/api/docs`);
}

bootstrap();
