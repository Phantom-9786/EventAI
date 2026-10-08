import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

// Restricts a route to the given roles (RolesGuard).
// Accepts role names as string literals (e.g. 'ADMIN', 'ORGANIZER');
// they are compared against the JWT role claim.
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
