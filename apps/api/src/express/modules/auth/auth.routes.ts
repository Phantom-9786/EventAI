import { Router, type RequestHandler } from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  verifyOtpSchema,
  resendOtpSchema,
} from '@eventai/validation';
import { validateBody } from '../../middleware/validation';
import type { ExpressAuthController } from './auth.controller';

export interface AuthRouterDependencies {
  controller: ExpressAuthController;
  authenticateJwt: RequestHandler;
  rateLimiter: RequestHandler;
}

export function createAuthRouter({
  controller,
  authenticateJwt,
  rateLimiter,
}: AuthRouterDependencies): Router {
  const router = Router();

  // Public authentication flows (rate-limited)
  router.post('/register', rateLimiter, validateBody(registerSchema), controller.register);
  router.post('/login', rateLimiter, validateBody(loginSchema), controller.login);
  router.post('/refresh', rateLimiter, controller.refresh);
  router.post('/logout', rateLimiter, controller.logout);
  router.post('/forgot-password', rateLimiter, validateBody(forgotPasswordSchema), controller.forgotPassword);
  router.post('/reset-password', rateLimiter, validateBody(resetPasswordSchema), controller.resetPassword);
  router.post('/verify-otp', rateLimiter, validateBody(verifyOtpSchema), controller.verifyOtp);
  router.post('/resend-otp', rateLimiter, validateBody(resendOtpSchema), controller.resendOtp);
  router.post('/verify-email', rateLimiter, validateBody(verifyEmailSchema), controller.verifyEmail);
  router.post('/resend-verification', rateLimiter, (req, res, next) => {
    if (req.headers.authorization) {
      return authenticateJwt(req, res, () => controller.resendVerification(req, res, next));
    }
    return controller.resendVerification(req, res, next);
  });

  // Authenticated flows
  router.get('/me', authenticateJwt, controller.me);
  router.post('/change-password', authenticateJwt, validateBody(changePasswordSchema), controller.changePassword);

  // Google OAuth flows
  router.get('/google', controller.startGoogleLogin);
  router.get('/google/callback', controller.googleCallback);

  return router;
}
