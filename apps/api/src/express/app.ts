import { resolve } from 'path';
import * as fs from 'fs';
import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { JwtService } from '../modules/auth/jwt.service';
import { ConfigService } from '../common/config/config.service';
import { PrismaClient } from '@eventai/database';
import { CacheService } from '../common/cache/cache.service';
import { StructuredLogger, isJsonLogging } from '../common/logging/structured-logger';
import type { EnvConfig } from '../config/env.validation';
import { AuthService } from '../modules/auth/auth.service';
import { GoogleOauthService } from '../modules/auth/google-oauth.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { UsersService } from '../modules/users/users.service';
import { CategoriesService } from '../modules/categories/categories.service';
import { VenuesService } from '../modules/venues/venues.service';
import { OrganizersService } from '../modules/organizers/organizers.service';
import { EventsService } from '../modules/events/events.service';
import { EventMediaService } from '../modules/events/event-media.service';
import { TicketsService } from '../modules/tickets/tickets.service';
import { PaymentsService } from '../modules/payments/payments.service';
import { BookingsService } from '../modules/bookings/bookings.service';
import { AdminService } from '../modules/admin/admin.service';
import { AiService } from '../modules/ai/ai.service';
import { ExpressModerationService } from './services/moderation.service';

import { createRequestIdMiddleware } from './middleware/request-id';
import { createErrorHandlerMiddleware } from './middleware/error-handler';
import { createAuthMiddleware } from './middleware/auth';
import { createAuthRateLimiter, type RateLimiterOptions } from './middleware/rate-limit';
import { createAiRequestGuard } from './middleware/ai-guard';

import { ExpressAuthController } from './modules/auth/auth.controller';
import { createAuthRouter } from './modules/auth/auth.routes';
import { ExpressUsersController } from './modules/users/users.controller';
import { createUsersRouter } from './modules/users/users.routes';
import { ExpressCategoriesController } from './modules/categories/categories.controller';
import { createCategoriesRouter } from './modules/categories/categories.routes';
import { ExpressVenuesController } from './modules/venues/venues.controller';
import { createVenuesRouter } from './modules/venues/venues.routes';
import { ExpressOrganizersController } from './modules/organizers/organizers.controller';
import { createOrganizersRouter } from './modules/organizers/organizers.routes';
import { ExpressTicketsController } from './modules/tickets/tickets.controller';
import { createTicketTypesRouter } from './modules/tickets/tickets.routes';
import { ExpressEventsController } from './modules/events/events.controller';
import { createEventsRouter } from './modules/events/events.routes';
import { ExpressBookingsController } from './modules/bookings/bookings.controller';
import { createBookingsRouter } from './modules/bookings/bookings.routes';
import { ExpressPaymentsController } from './modules/payments/payments.controller';
import { createPaymentsRouter } from './modules/payments/payments.routes';
import { ExpressAdminController } from './modules/admin/admin.controller';
import { createAdminRouter } from './modules/admin/admin.routes';
import { ExpressAiController } from './modules/ai/ai.controller';
import { createAiRouter } from './modules/ai/ai.routes';
import { ExpressNotificationsController } from './modules/notifications/notifications.controller';
import { createNotificationsRouter } from './modules/notifications/notifications.routes';
import { NotFoundError } from './types';

export interface AppFactoryOptions {
  prisma?: PrismaClient;
  cache?: CacheService;
  authService?: AuthService;
  googleOauthService?: GoogleOauthService;
  usersService?: UsersService;
  categoriesService?: CategoriesService;
  venuesService?: VenuesService;
  organizersService?: OrganizersService;
  eventsService?: EventsService;
  mediaService?: EventMediaService;
  ticketsService?: TicketsService;
  paymentsService?: PaymentsService;
  bookingsService?: BookingsService;
  adminService?: AdminService;
  aiService?: AiService;
  notificationsService?: NotificationsService;
  moderationService?: ExpressModerationService;
  env?: Partial<EnvConfig>;
  logger?: StructuredLogger;
  jwtSecret?: string;
  jwtExpiry?: string;
  rateLimit?: boolean | RateLimiterOptions;
}

export function createExpressApp(options: AppFactoryOptions = {}): Express {
  const app = express();

  const frontendUrl =
    options.env?.FRONTEND_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:3000';
  const nodeEnv = options.env?.NODE_ENV ?? process.env.NODE_ENV ?? 'development';
  const jsonMode = isJsonLogging({
    LOG_FORMAT: process.env.LOG_FORMAT,
    NODE_ENV: nodeEnv,
  });

  // Trust proxy configuration: essential for proper client IP resolution behind reverse proxies
  const trustProxy = options.env?.TRUST_PROXY ?? process.env.TRUST_PROXY;
  if (trustProxy !== undefined) {
    const isNum = !isNaN(Number(trustProxy));
    app.set(
      'trust proxy',
      trustProxy === 'true' ? true : trustProxy === 'false' ? false : isNum ? Number(trustProxy) : trustProxy,
    );
  } else if (nodeEnv === 'production') {
    app.set('trust proxy', 1);
  }

  const logger = options.logger ?? new StructuredLogger('Express', jsonMode);
  const prisma = options.prisma ?? new PrismaClient();
  const cache =
    options.cache ??
    new CacheService({
      get: (key: string) =>
        (options.env as Record<string, unknown>)?.[key] ?? process.env[key],
    } as never);

  const jwtSecret =
    options.jwtSecret ??
    options.env?.JWT_SECRET ??
    process.env.JWT_SECRET ??
    'fallback-secret-at-least-32-chars-long';
  const jwtExpiry =
    options.jwtExpiry ?? options.env?.JWT_EXPIRY ?? process.env.JWT_EXPIRY ?? '7d';

  const jwtService = new JwtService({
    secret: jwtSecret,
    signOptions: { expiresIn: jwtExpiry },
  });

  const envRecord = (options.env as Record<string, string | undefined>) ?? {};

  const configService = new ConfigService({
    JWT_SECRET: jwtSecret,
    JWT_EXPIRY: jwtExpiry,
    REFRESH_TOKEN_EXPIRY:
      envRecord.REFRESH_TOKEN_EXPIRY ??
      process.env.REFRESH_TOKEN_EXPIRY ??
      '30d',
    FRONTEND_URL: frontendUrl,
    GOOGLE_CLIENT_ID: options.env?.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET:
      options.env?.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL:
      options.env?.GOOGLE_CALLBACK_URL ?? process.env.GOOGLE_CALLBACK_URL,
    PORT: options.env?.PORT ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 4000),
    ...options.env,
  });

  // Services
  const notificationsService =
    options.notificationsService ?? new NotificationsService(prisma as never);
  const moderationService =
    options.moderationService ?? new ExpressModerationService(prisma);
  const authService =
    options.authService ??
    new AuthService(
      prisma as never,
      jwtService as never,
      configService,
      notificationsService,
    );
  const googleOauthService =
    options.googleOauthService ?? new GoogleOauthService(configService);
  const usersService =
    options.usersService ?? new UsersService(prisma as never);
  const categoriesService =
    options.categoriesService ??
    new CategoriesService(prisma as never, cache as never);
  const venuesService =
    options.venuesService ?? new VenuesService(prisma as never);
  const paymentsService =
    options.paymentsService ??
    new PaymentsService(prisma as never, notificationsService as never);
  const organizersService =
    options.organizersService ?? new OrganizersService(prisma as never);
  const mediaService =
    options.mediaService ?? new EventMediaService(prisma as never);
  const eventsService =
    options.eventsService ??
    new EventsService(prisma as never, cache as never, notificationsService as never, mediaService as never);
  const ticketsService =
    options.ticketsService ??
    new TicketsService(prisma as never, eventsService as never);
  const bookingsService =
    options.bookingsService ??
    new BookingsService(prisma as never, paymentsService as never, notificationsService as never);
  const adminService =
    options.adminService ??
    new AdminService(prisma as never, eventsService as never, notificationsService as never);
  const aiService =
    options.aiService ?? new AiService(prisma as never, cache as never);

  // 1. Request ID and structured request logger
  app.use(createRequestIdMiddleware(logger));

  // 2. Helmet for secure HTTP headers
  app.use(helmet());

  // 3. Cookie parser for session and refresh cookies
  app.use(cookieParser());

  // 4. CORS configuration matching API contract
  app.use(
    cors({
      origin: frontendUrl,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Idempotency-Key',
        'X-Request-Id',
      ],
    }),
  );

  // 5. Static file serving for uploads (avatars, event images)
  const uploadDir = resolve(
    process.cwd(),
    envRecord.UPLOAD_DIR ?? process.env.UPLOAD_DIR ?? './uploads',
  );
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  app.use('/uploads', express.static(uploadDir));

  // 6. Body parsers with raw body buffer capture (required for Razorpay webhook verification)
  app.use(
    express.json({
      limit: '10mb',
      verify: (req: Request, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // 7. Root landing status endpoint
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'EventAI API',
      version: '1.0.0',
      docs: '/api/docs',
      health: '/api/health',
      frontend: frontendUrl,
    });
  });

  // 8. Authentication & Authorization Middleware
  const { authenticateJwt, optionalAuthenticateJwt, requireRoles } = createAuthMiddleware({
    jwtSecret,
    prisma,
  });

  const authRateLimiter =
    typeof options.rateLimit === 'object'
      ? createAuthRateLimiter(options.rateLimit)
      : createAuthRateLimiter({
          limit: 10,
          windowMs: 60_000,
          disabled: options.rateLimit === false,
        });

  const aiRequestGuard = createAiRequestGuard({
    cache,
    env: envRecord,
  });

  // 9. Controllers
  const authController = new ExpressAuthController(
    authService,
    googleOauthService,
    frontendUrl,
  );
  const usersController = new ExpressUsersController(usersService);
  const categoriesController = new ExpressCategoriesController(categoriesService);
  const venuesController = new ExpressVenuesController(venuesService);
  const organizersController = new ExpressOrganizersController(
    organizersService,
    moderationService,
    paymentsService,
  );
  const ticketsController = new ExpressTicketsController(
    ticketsService,
    moderationService,
  );
  const eventsController = new ExpressEventsController(
    eventsService,
    mediaService,
    moderationService,
  );
  const bookingsController = new ExpressBookingsController(
    bookingsService,
    moderationService,
  );
  const paymentsController = new ExpressPaymentsController(paymentsService);
  const adminController = new ExpressAdminController(
    adminService,
    moderationService,
    paymentsService,
  );
  const aiController = new ExpressAiController(aiService);
  const notificationsController = new ExpressNotificationsController(notificationsService);

  // 10. Routers
  const authRouter = createAuthRouter({
    controller: authController,
    authenticateJwt,
    rateLimiter: authRateLimiter,
  });

  const usersRouter = createUsersRouter({
    controller: usersController,
    authenticateJwt,
  });

  const categoriesRouter = createCategoriesRouter({
    controller: categoriesController,
    authenticateJwt,
    requireRoles,
  });

  const venuesRouter = createVenuesRouter({
    controller: venuesController,
  });

  const organizersRouter = createOrganizersRouter({
    controller: organizersController,
    authenticateJwt,
    requireRoles,
  });

  const ticketTypesRouter = createTicketTypesRouter({
    controller: ticketsController,
    authenticateJwt,
    requireRoles,
  });

  const eventsRouter = createEventsRouter({
    controller: eventsController,
    ticketsController,
    authenticateJwt,
    requireRoles,
  });

  const bookingsRouter = createBookingsRouter({
    controller: bookingsController,
    authenticateJwt,
  });

  const paymentsRouter = createPaymentsRouter({
    controller: paymentsController,
    authenticateJwt,
  });

  const adminRouter = createAdminRouter({
    controller: adminController,
    authenticateJwt,
    requireRoles,
  });

  const aiRouter = createAiRouter({
    controller: aiController,
    optionalAuthenticateJwt,
    aiRequestGuard,
  });

  const notificationsRouter = createNotificationsRouter({
    controller: notificationsController,
    authenticateJwt,
  });

  // Healthcheck handler
  const healthHandler = async (_req: Request, res: Response) => {
    let database = 'up';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    const redis = await cache.ping();
    const healthy = database === 'up';

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'error',
      service: 'eventai-api',
      timestamp: new Date().toISOString(),
      dependencies: {
        database,
        redis,
      },
    });
  };

  // Raw body inspection handler (non-production diagnostic endpoint only)
  const rawBodyHandler = (req: Request, res: Response) => {
    res.json({
      received: true,
      hasRawBody: Buffer.isBuffer(req.rawBody),
      rawBodyLength: req.rawBody?.length ?? 0,
      rawBodyString: req.rawBody?.toString('utf8'),
      parsedBody: req.body,
    });
  };

  const apiRouter = express.Router();
  apiRouter.get('/health', healthHandler);
  if (nodeEnv !== 'production') {
    apiRouter.post('/test/raw-body', rawBodyHandler);
  }
  apiRouter.use('/auth', authRouter);
  apiRouter.use('/users', usersRouter);
  apiRouter.use('/categories', categoriesRouter);
  apiRouter.use('/venues', venuesRouter);
  apiRouter.use('/organizers', organizersRouter);
  apiRouter.use('/events', eventsRouter);
  apiRouter.use('/ticket-types', ticketTypesRouter);
  apiRouter.use('/bookings', bookingsRouter);
  apiRouter.use('/payments', paymentsRouter);
  apiRouter.use('/admin', adminRouter);
  apiRouter.use('/ai', aiRouter);
  apiRouter.use('/notifications', notificationsRouter);

  app.use('/api', apiRouter);

  // Aliases for convenience without /api prefix
  app.get('/health', healthHandler);
  if (nodeEnv !== 'production') {
    app.post('/test/raw-body', rawBodyHandler);
  }
  app.use('/auth', authRouter);
  app.use('/users', usersRouter);
  app.use('/categories', categoriesRouter);
  app.use('/venues', venuesRouter);
  app.use('/organizers', organizersRouter);
  app.use('/events', eventsRouter);
  app.use('/ticket-types', ticketTypesRouter);
  app.use('/bookings', bookingsRouter);
  app.use('/payments', paymentsRouter);
  app.use('/admin', adminRouter);
  app.use('/ai', aiRouter);
  app.use('/notifications', notificationsRouter);

  // 11. Unmatched route 404 handler
  app.use((req: Request, _res: Response, next) => {
    next(new NotFoundError(`Cannot ${req.method} ${req.path}`));
  });

  // 12. Centralized Error Handler (must be registered last with 4 arguments)
  app.use(createErrorHandlerMiddleware(logger));

  return app;
}
