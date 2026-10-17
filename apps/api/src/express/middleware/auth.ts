import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@eventai/database';
import type { TokenPayload, UserRole } from '@eventai/types';
import { UnauthorizedError, ForbiddenError, type ExpressAuthUser } from '../types';

export interface AuthMiddlewareConfig {
  jwtSecret: string;
  prisma: PrismaClient;
}

export function createAuthMiddleware(config: AuthMiddlewareConfig) {
  const authenticateJwt: RequestHandler = async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return next(new UnauthorizedError('Unauthorized'));
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return next(new UnauthorizedError('Unauthorized'));
    }

    const token = parts[1];
    let payload: TokenPayload;

    try {
      payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        return next(new UnauthorizedError('Token expired'));
      }
      return next(new UnauthorizedError('Invalid token'));
    }

    if (!payload || !payload.sub) {
      return next(new UnauthorizedError('Invalid token payload'));
    }

    try {
      const user = await config.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, role: true, isActive: true, isEmailVerified: true },
      });

      if (!user || !user.isActive) {
        return next(new UnauthorizedError('User not found or deactivated'));
      }

      if (user.isEmailVerified === false && !req.path.includes('resend-verification')) {
        return next(new ForbiddenError('Email verification required'));
      }

      const authUser: ExpressAuthUser = {
        id: user.id,
        email: user.email,
        role: user.role as UserRole,
      };

      req.authUser = authUser;
      req.user = authUser;
      next();
    } catch (dbError) {
      next(dbError);
    }
  };

  const requireRoles = (...allowedRoles: UserRole[]): RequestHandler => {
    return (req: Request, _res: Response, next: NextFunction): void => {
      const user = req.authUser ?? req.user;
      if (!user) {
        return next(new UnauthorizedError('Unauthorized'));
      }

      // ADMIN has platform-wide access, including organizer management features,
      // while non-admin users must strictly match one of the allowed roles.
      const hasPermission = user.role === 'ADMIN' || allowedRoles.includes(user.role);
      if (!hasPermission) {
        return next(
          new ForbiddenError('You do not have permission to access this resource'),
        );
      }

      next();
    };
  };

  const optionalAuthenticateJwt: RequestHandler = async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }
    const token = authHeader.split(' ')[1];
    if (!token) return next();

    try {
      const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
      if (!payload || !payload.sub) return next();

      const user = await config.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, role: true, isActive: true, isEmailVerified: true },
      });
      if (user && user.isActive && user.isEmailVerified !== false) {
        const authUser: ExpressAuthUser = {
          id: user.id,
          email: user.email,
          role: user.role as UserRole,
        };
        req.authUser = authUser;
        req.user = authUser;
      }
    } catch {
      // Ignore token verification errors for optional auth
    }
    next();
  };

  return {
    authenticateJwt,
    optionalAuthenticateJwt,
    requireRoles,
  };
}
