import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import type { TokenPayload, UserRole } from '@eventai/types';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { GoogleProfile } from './google-oauth.service';

export const REFRESH_TOKEN_COOKIE = 'eventai_refresh_token';

interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseDurationMs(value: string | undefined, fallbackMs: number): number {
  if (!value) return fallbackMs;
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) return fallbackMs;
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return Number(match[1]) * multipliers[match[2]];
}

// ═══════════════════════════════════════════════════
// Authentication: registration, login, logout,
// JWT access tokens + rotating refresh sessions,
// password change and password reset.
//
// Security model:
// - Passwords hashed with Argon2id.
// - Access token: short-lived JWT (Authorization header).
// - Refresh token: opaque random value in an httpOnly
//   secure cookie; only its SHA-256 hash is stored.
// - Refresh tokens rotate on every refresh.
// ═══════════════════════════════════════════════════

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly refreshTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly notifications: NotificationsService,
  ) {
    this.refreshTtlMs = parseDurationMs(
      this.configService.get<string>('REFRESH_TOKEN_EXPIRY'),
      30 * 24 * 60 * 60 * 1000,
    );
  }

  get refreshCookieMaxAge(): number {
    return this.refreshTtlMs;
  }

  async register(input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }): Promise<{ user: { id: string; email: string; role: UserRole }; tokens: SessionTokens }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: 'CUSTOMER',
      },
      select: { id: true, email: true, role: true },
    });

    const publicUser = { id: user.id, email: user.email, role: user.role as UserRole };
    const tokens = await this.createSession(user.id, user.email, user.role);
    this.issueEmailVerification(user.id, user.email, input.firstName, input.lastName);
    return { user: publicUser, tokens };
  }

  async login(input: {
    email: string;
    password: string;
  }): Promise<{ user: { id: string; email: string; role: UserRole }; tokens: SessionTokens }> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Google-only account: no local password exists
    if (!user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await argon2.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.createSession(user.id, user.email, user.role);
    return {
      user: { id: user.id, email: user.email, role: user.role as UserRole },
      tokens,
    };
  }

  // ═══════════════════════════════════════════════════
  // Google sign-in. The GoogleProfile must already be
  // verified server-side (see GoogleOauthService).
  //
  // Account-linking policy (safe by default):
  // - Match on googleId first (returning Google users).
  // - Otherwise match on email and auto-link ONLY when
  //   Google reports the email as verified — otherwise a
  //   attacker-controlled Google account could take over
  //   an existing local account.
  // - No matching user: create a new passwordless account
  //   (also requires a Google-verified email).
  // ═══════════════════════════════════════════════════
  async loginWithGoogle(profile: GoogleProfile): Promise<{
    user: { id: string; email: string; role: UserRole };
    tokens: SessionTokens;
  }> {
    if (!profile.emailVerified) {
      throw new UnauthorizedException('Google account email is not verified');
    }

    let user = await this.prisma.user.findUnique({
      where: { googleId: profile.sub },
    });

    if (user && !user.isActive) {
      throw new UnauthorizedException('This account has been disabled');
    }

    if (!user) {
      const byEmail = await this.prisma.user.findUnique({
        where: { email: profile.email },
      });

      if (byEmail && !byEmail.isActive) {
        throw new UnauthorizedException('This account has been disabled');
      }

      if (byEmail) {
        // Link the existing account to this Google identity
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: profile.sub,
            isEmailVerified: true,
            profileImage: byEmail.profileImage ?? profile.picture,
          },
        });
      } else {
        user = await this.prisma.user.create({
          data: {
            email: profile.email,
            googleId: profile.sub,
            passwordHash: null,
            firstName: profile.firstName ?? 'Google',
            lastName: profile.lastName ?? 'User',
            profileImage: profile.picture,
            role: 'CUSTOMER',
            isEmailVerified: true,
          },
        });
      }
    }

    const tokens = await this.createSession(user.id, user.email, user.role);
    return {
      user: { id: user.id, email: user.email, role: user.role as UserRole },
      tokens,
    };
  }

  async refresh(
    refreshToken: string | undefined,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const session = await this.prisma.session.findUnique({
      where: { refreshToken: hashToken(refreshToken) },
      include: { user: { select: { id: true, email: true, role: true, isActive: true } } },
    });

    if (!session || session.expiresAt < new Date() || !session.user.isActive) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Rotate: new tokens for the same session row
    const tokens = await this.issueTokens(session.user);
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        token: hashToken(tokens.accessToken),
        refreshToken: hashToken(tokens.refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      },
    });

    return tokens;
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    try {
      await this.prisma.session.delete({
        where: { refreshToken: hashToken(refreshToken) },
      });
    } catch {
      // Session already gone — logout is idempotent
    }
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        username: true,
        bio: true,
        profileImage: true,
        location: true,
        role: true,
        isEmailVerified: true,
        createdAt: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }

    // Google-only account: no local password to change
    if (!user.passwordHash) {
      throw new BadRequestException(
        'No password is set for this account. Continue with Google to sign in.',
      );
    }

    const passwordValid = await argon2.verify(user.passwordHash, currentPassword);
    if (!passwordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });

    // Revoke all sessions — the user must log in again everywhere
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.session.deleteMany({ where: { userId } }),
    ]);
  }

  // ═══════════════════════════════════════════════════
  // Email verification: one hashed token per user, 24h
  // expiry, single-use. Google-linked accounts skip this
  // (Google already attests the email; loginWithGoogle
  // marks them verified).
  // ═══════════════════════════════════════════════════

  /** Fire-and-forget: create a fresh token and email the raw link. */
  private issueEmailVerification(
    userId: string,
    email: string,
    firstName?: string | null,
    lastName?: string | null,
  ): void {
    void (async () => {
      const token = randomBytes(32).toString('hex');
      await this.prisma.emailVerificationToken.upsert({
        where: { userId },
        create: {
          userId,
          token: hashToken(token),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        update: {
          token: hashToken(token),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      const sent = await this.notifications.sendEmailVerificationEmail({
        to: email,
        holderName: `${firstName ?? ''} ${lastName ?? ''}`.trim() || 'there',
        verificationToken: token,
        frontendUrl: this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000'),
      });
      if (!sent) this.logger.debug(`Email verification token for ${email}: ${token}`);
    })().catch((err) => {
      this.logger.warn(
        `Email verification issue failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    });
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { token: hashToken(token) },
      select: { id: true, userId: true, expiresAt: true },
    });
    if (!record || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired verification link');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { isEmailVerified: true },
        select: { id: true },
      }),
      this.prisma.emailVerificationToken.delete({ where: { id: record.id } }),
    ]);

    return { message: 'Email verified. Thank you!' };
  }

  async resendEmailVerification(userId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, isEmailVerified: true, firstName: true, lastName: true },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    if (user.isEmailVerified) {
      return { message: 'Your email is already verified' };
    }

    this.issueEmailVerification(userId, user.email, user.firstName, user.lastName);
    return { message: 'If your email is unverified, a new verification link has been sent' };
  }

  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, isActive: true, firstName: true, lastName: true },
    });

    if (user?.isActive) {
      // Invalidate previous unused tokens for this email
      await this.prisma.passwordReset.deleteMany({ where: { email } });

      const token = randomBytes(32).toString('hex');
      await this.prisma.passwordReset.create({
        data: {
          email,
          token: hashToken(token),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      // Degrades gracefully: with no BREVO_API_KEY the send is skipped
      // and the raw token is logged in dev so the flow stays testable.
      void this.notifications
        .sendPasswordResetEmail({
          to: email,
          holderName: `${user.firstName} ${user.lastName}`.trim() || 'there',
          resetToken: token,
          frontendUrl: this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000'),
        })
        .then((sent) => {
          if (!sent) this.logger.debug(`Password reset token for ${email}: ${token}`);
        })
        .catch(() => undefined);
    }

    // Always the same response — do not leak whether the account exists
    return {
      message: 'If an account with that email exists, a reset link has been sent',
    };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const reset = await this.prisma.passwordReset.findUnique({
      where: { token: hashToken(token) },
    });

    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });

    const user = await this.prisma.user.findUnique({
      where: { email: reset.email },
      select: { id: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);

    return { message: 'Password has been reset. Please log in again.' };
  }

  private async createSession(
    userId: string,
    email: string,
    role: string,
  ): Promise<SessionTokens> {
    const user = { id: userId, email, role, isActive: true };
    const tokens = await this.issueTokens(user);
    await this.prisma.session.create({
      data: {
        userId,
        token: hashToken(tokens.accessToken),
        refreshToken: hashToken(tokens.refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      },
    });
    return tokens;
  }

  private async issueTokens(user: {
    id: string;
    email: string;
    role: string;
  }): Promise<SessionTokens> {
    const payload: Omit<TokenPayload, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email,
      role: user.role as UserRole,
      // Unique per token: two logins within the same second would otherwise
      // produce byte-identical JWTs and violate the unique session hash.
      jti: randomBytes(12).toString('hex'),
    };
    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = randomBytes(48).toString('hex');
    return { accessToken, refreshToken };
  }
}
