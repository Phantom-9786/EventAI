import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@eventai/types';
import type { SystemControlsService } from '../../modules/admin/system-controls.service';

export interface MaintenanceMiddlewareOptions {
  systemControlsService: SystemControlsService;
  jwtSecret: string;
}

const EXEMPT_PATHS = [
  '/health',
  '/api/health',
  '/system-controls',
  '/api/system-controls',
  '/payments/webhook',
  '/api/payments/webhook',
  '/auth/login',
  '/api/auth/login',
  '/auth/refresh',
  '/api/auth/refresh',
  '/auth/logout',
  '/api/auth/logout',
  '/auth/me',
  '/api/auth/me',
  '/auth/forgot-password',
  '/api/auth/forgot-password',
  '/auth/reset-password',
  '/api/auth/reset-password',
];

export function createMaintenanceMiddleware({
  systemControlsService,
  jwtSecret,
}: MaintenanceMiddlewareOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const settings = await systemControlsService.getSettings();

      // If website maintenance is not active, allow all traffic
      if (!settings.websiteMaintenance) {
        return next();
      }

      const path = req.path.toLowerCase();

      // 1. Allow health checks, webhooks, and auth recovery paths
      const isExempt =
        EXEMPT_PATHS.some((exempt) => path === exempt || path === `${exempt}/`) ||
        path.startsWith('/admin') ||
        path.startsWith('/api/admin');

      if (isExempt) {
        return next();
      }

      // 2. Allow requests from authenticated administrators
      // Check already parsed user on request
      const existingUser = req.authUser ?? req.user;
      if (existingUser?.role === UserRole.ADMIN) {
        return next();
      }

      // Check Authorization Bearer token header or cookie
      let token: string | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
      } else if (req.cookies?.eventai_access_token) {
        token = req.cookies.eventai_access_token;
      } else if (req.cookies?.accessToken) {
        token = req.cookies.accessToken;
      }

      if (token) {
        try {
          const decoded = jwt.verify(token, jwtSecret) as { role?: string; sub?: string };
          if (decoded.role === UserRole.ADMIN) {
            return next();
          }
        } catch {
          // Token verification failure will fall through to maintenance block
        }
      }

      // 3. Block all other requests with 503 Maintenance Mode
      res.status(503).json({
        success: false,
        statusCode: 503,
        message:
          settings.websiteMaintenanceMessage ||
          'EventPoint is temporarily undergoing maintenance. Please check back soon.',
        code: 'MAINTENANCE_MODE',
      });
    } catch (err) {
      // Safe fallback: never lock users out if middleware encounters an unexpected error
      next();
    }
  };
}
