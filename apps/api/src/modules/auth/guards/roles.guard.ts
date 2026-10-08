import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

// ═══════════════════════════════════════════════════
// RBAC guard: enforces @Roles() metadata.
// Routes without @Roles() are accessible to any
// authenticated user.
// ═══════════════════════════════════════════════════

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    const authUser = user as AuthenticatedUser | undefined;
    if (!authUser || !requiredRoles.includes(authUser.role)) {
      throw new ForbiddenException(
        'You do not have permission to access this resource',
      );
    }
    return true;
  }
}
