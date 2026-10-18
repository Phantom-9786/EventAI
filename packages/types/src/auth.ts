// ── Authentication types ───────────────────────────

export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  ORGANIZER = 'ORGANIZER',
  ADMIN = 'ADMIN',
}

export enum AdminRoleType {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
}

export enum AdminInvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface TokenPayload {
  sub: string; // userId
  email: string;
  role: UserRole;
  jti?: string; // unique token id — keeps tokens distinct within the same second
  iat: number;
  exp: number;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface AdminTeamMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  adminRole: AdminRoleType;
  isActive: boolean;
  createdAt: string;
  isOwner: boolean;
}

export interface AdminInvitationSummary {
  id: string;
  email: string;
  role: AdminRoleType;
  status: AdminInvitationStatus;
  invitedBy: { id: string; email: string; firstName: string; lastName: string };
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string | null;
}
