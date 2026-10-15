import { Router, type RequestHandler } from 'express';
import {
  createPaymentOrderSchema,
  refundBookingSchema,
  verifyPaymentSchema,
} from '@eventai/validation';
import { validateBody, validateUuidParam } from '../../middleware/validation';
import type { ExpressPaymentsController } from './payments.controller';

export interface PaymentsRouterDependencies {
  controller: ExpressPaymentsController;
  authenticateJwt: RequestHandler;
}

export function createPaymentsRouter({
  controller,
  authenticateJwt,
}: PaymentsRouterDependencies): Router {
  const router = Router();

  // Webhook is public (verified via Razorpay HMAC signature over raw bytes)
  router.post('/webhook', controller.webhook);

  // Authenticated endpoints
  router.post(
    '/order',
    authenticateJwt,
    validateBody(createPaymentOrderSchema),
    controller.createOrder,
  );
  router.post(
    '/verify',
    authenticateJwt,
    validateBody(verifyPaymentSchema),
    controller.verify,
  );
  router.post(
    '/refund',
    authenticateJwt,
    validateBody(refundBookingSchema),
    controller.refund,
  );
  router.get(
    '/tickets/:id/qr',
    authenticateJwt,
    validateUuidParam('id'),
    controller.ticketQr,
  );

  return router;
}
