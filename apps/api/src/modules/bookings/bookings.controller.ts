import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  cancelBookingSchema,
  createBookingSchema,
  paginationSchema,
} from '@eventai/validation';
import type {
  CancelBookingInput,
  CreateBookingInput,
  PaginationInput,
} from '@eventai/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BookingsService } from './bookings.service';

@ApiTags('bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a booking (auth required; idempotent per key)' })
  async create(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(createBookingSchema)) body: CreateBookingInput,
  ) {
    return { booking: await this.bookingsService.create(userId, body) };
  }

  @Get()
  @ApiOperation({ summary: 'List your bookings, newest first (paginated)' })
  async list(
    @CurrentUser('id') userId: string,
    @Query(new ZodValidationPipe(paginationSchema)) query: PaginationInput,
  ) {
    return this.bookingsService.listOwn(userId, query.page, query.limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of your bookings' })
  async detail(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return { booking: await this.bookingsService.getOwn(userId, id) };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an unpaid booking of yours and release its stock' })
  async cancel(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelBookingSchema)) body: CancelBookingInput,
  ) {
    return {
      booking: await this.bookingsService.cancelOwn(userId, id, body.reason),
    };
  }
}
