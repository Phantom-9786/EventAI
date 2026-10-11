import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  createPaymentOrderSchema,
  refundBookingSchema,
  verifyPaymentSchema,
} from '@eventai/validation';
import type {
  CreatePaymentOrderInput,
  RefundBookingInput,
  VerifyPaymentInput,
} from '@eventai/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('order')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create (or reuse) a Razorpay order for a booking' })
  async createOrder(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(createPaymentOrderSchema)) body: CreatePaymentOrderInput,
  ) {
    return this.paymentsService.createOrder(userId, body.bookingId);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the Razorpay checkout signature and confirm the booking' })
  async verify(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(verifyPaymentSchema)) body: VerifyPaymentInput,
  ) {
    return this.paymentsService.verifyPayment(userId, body);
  }

  /**
   * Razorpay server-to-server webhook. Signature is computed over the raw
   * request body (rawBody enabled in main.ts) — do not parse before verifying.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Razorpay webhook (signature-verified, idempotent)' })
  async webhook(
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.paymentsService.handleWebhook(
      req.rawBody ?? Buffer.from(JSON.stringify(req.body)),
      req.headers['x-razorpay-signature'] as string | undefined,
    );
  }

  @Post('refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request an organizer-approved refund for a paid booking' })
  async refund(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(refundBookingSchema)) body: RefundBookingInput,
  ) {
    return this.paymentsService.requestRefund(userId, body.bookingId, body.reason);
  }

  @Get('tickets/:id/qr')
  @ApiOperation({ summary: 'PNG data-URL QR code for one of your digital tickets' })
  async ticketQr(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return { dataUrl: await this.paymentsService.getTicketQrDataUrl(userId, id) };
  }
}
