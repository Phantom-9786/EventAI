import type { Request, Response, NextFunction } from 'express';
import { PaymentsService } from '../../../modules/payments/payments.service';
import { UnauthorizedError } from '../../types';

export class ExpressPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  createOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const result = await this.paymentsService.createOrder(userId, req.body.bookingId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };

  verify = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const result = await this.paymentsService.verifyPayment(userId, req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  webhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
      const signature = req.headers['x-razorpay-signature'] as string | undefined;

      const result = await this.paymentsService.handleWebhook(rawBody, signature);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  refund = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const result = await this.paymentsService.requestRefund(
        userId,
        req.body.bookingId,
        req.body.reason,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  ticketQr = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.authUser?.id ?? req.user?.id;
      if (!userId) throw new UnauthorizedError('Unauthorized');

      const dataUrl = await this.paymentsService.getTicketQrDataUrl(userId, req.params.id);
      res.status(200).json({ dataUrl });
    } catch (err) {
      next(err);
    }
  };
}
