import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizersModule } from './modules/organizers/organizers.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { EventsModule } from './modules/events/events.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { VenuesModule } from './modules/venues/venues.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AiModule } from './modules/ai/ai.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: (configService.get<number>('RATE_LIMIT_TTL', 60) ?? 60) * 1000,
            limit: configService.get<number>('RATE_LIMIT_MAX', 100) ?? 100,
          },
        ],
      }),
      inject: [ConfigService],
    }),
    PrismaModule,
    ScheduleModule.forRoot(),
    HealthModule,
    AuthModule,
    UsersModule,
    OrganizersModule,
    CategoriesModule,
    EventsModule,
    TicketsModule,
    VenuesModule,
    BookingsModule,
    PaymentsModule,
    NotificationsModule,
    AiModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      // Route-level rate limiting (auth endpoints override with @Throttle)
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      // Authentication: all routes require a valid JWT unless @Public()
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      // Authorization: enforces @Roles() metadata
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
