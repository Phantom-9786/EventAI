import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@eventai/types';

export const ROLES_KEY = 'roles';

// Restricts a route to the given roles (RolesGuard)
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
