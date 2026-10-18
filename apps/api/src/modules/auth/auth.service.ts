import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '../../common/exceptions';
import { ConfigService } from '../../common/config/config.service';
import { JwtService } from './jwt.service';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomInt } from 'crypto';
import type { TokenPayload, UserRole } from '@eventai/types';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { GoogleProfile } from './google-oauth.service';
import type { SystemControlsService } from '../admin/system-controls.service';

export const REFRESH_TOKEN_COOKIE = 'eventai_refresh_token';

interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hashOtp(userId: string, otp: string): string {
  return createHash('sha256').update(`${userId}:${otp}`).digest('hex');
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
    @Optional() private readonly systemControlsService?: SystemControlsService,
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
  }): Promise<{
    user: { id: string; email: string; role: UserRole; isEmailVerified: boolean };
    message: string;
    emailDeliveryFailed: boolean;
  }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true, role: true, isEmailVerified: true },
    });
    if (existing && existing.isEmailVerified) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });

    // Generate cryptographically secure 6-digit numeric OTP
    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const now = new Date();

    // Atomically create or update unverified user and upsert OTP challenge
    const user = await this.prisma.$transaction(async (tx) => {
      let u;
      if (existing) {
        u = await tx.user.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            firstName: input.firstName,
            lastName: input.lastName,
          },
          select: { id: true, email: true, role: true, isEmailVerified: true },
        });
      } else {
        u = await tx.user.create({
          data: {
            email: input.email,
            passwordHash,
            firstName: input.firstName,
            lastName: input.lastName,
            role: 'CUSTOMER',
            isEmailVerified: false,
          },
          select: { id: true, email: true, role: true, isEmailVerified: true },
        });
      }

      await tx.emailVerificationToken.upsert({
        where: { userId: u.id },
        create: {
          userId: u.id,
          token: hashOtp(u.id, otp),
          attempts: 0,
          expiresAt: new Date(now.getTime() + 10 * 60 * 1000), // 10 minutes
          lastSentAt: now,
        },
        update: {
          token: hashOtp(u.id, otp),
          attempts: 0,
          expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
          lastSentAt: now,
        },
      });

      return u;
    });

    const publicUser = {
      id: user.id,
      email: user.email,
      role: user.role as UserRole,
      isEmailVerified: false,
    };

    const holderName = `${input.firstName} ${input.lastName}`.trim() || 'there';
    let emailSent = false;
    try {
      emailSent = await this.notifications.sendEmailVerificationOtp({
        to: input.email,
        holderName,
        otp,
      });
      if (!emailSent) {
        this.logger.warn('Email verification OTP message was not delivered by provider');
      }
    } catch (err) {
      this.logger.warn(
        `Failed to dispatch email verification OTP: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      user: publicUser,
      message: emailSent
        ? 'Registration successful. A 6-digit verification code has been sent to your email.'
        : 'Account created, but we could not deliver the verification email right now. Please verify your address and request a new code.',
      emailDeliveryFailed: !emailSent,
    };
  }

  async login(input: {
    email: string;
    password: string;
  }): Promise<{
    user: { id: string; email: string; role: UserRole; isMaintenanceTester?: boolean };
    tokens: SessionTokens;
  }> {
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

    if (user.isEmailVerified === false) {
      throw new ForbiddenException({
        message: 'Email verification required. Please verify your email before logging in.',
        error: 'EmailNotVerified',
        isEmailVerified: false,
        email: user.email,
      });
    }

    const isMaintenanceTester = this.systemControlsService
      ? await this.systemControlsService.isAuthorizedMaintenanceTester(user.id)
      : user.role === 'ADMIN';

    const tokens = await this.createSession(user.id, user.email, user.role);
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role as UserRole,
        isMaintenanceTester,
      },
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
    user: { id: string; email: string; role: UserRole; isMaintenanceTester?: boolean };
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

    const isMaintenanceTester = this.systemControlsService
      ? await this.systemControlsService.isAuthorizedMaintenanceTester(user.id)
      : user.role === 'ADMIN';

    const tokens = await this.createSession(user.id, user.email, user.role);
    return {
      user: { id: user.id, email: user.email, role: user.role as UserRole, isMaintenanceTester },
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
      include: {
        user: { select: { id: true, email: true, role: true, isActive: true, isEmailVerified: true } },
      },
    });

    if (
      !session ||
      session.expiresAt < new Date() ||
      !session.user.isActive ||
      session.user.isEmailVerified === false
    ) {
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
        adminRole: true,
        isEmailVerified: true,
        createdAt: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    const isMaintenanceTester = this.systemControlsService
      ? await this.systemControlsService.isAuthorizedMaintenanceTester(userId)
      : user.role === 'ADMIN';

    return {
      ...user,
      isMaintenanceTester,
    };
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
  // Email verification via OTP:
  // - 6-digit numeric OTP cryptographically generated
  // - 10-minute expiry
  // - Max 5 attempts per OTP challenge
  // - 60-second cooldown on resends
  // - Hashed at rest using sha256(userId + ":" + otp)
  // - Atomic invalidation on verification
  // ═══════════════════════════════════════════════════

  async verifyOtp(input: {
    email: string;
    otp: string;
  }): Promise<{ message: string; success: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, isEmailVerified: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    if (user.isEmailVerified) {
      return { success: true, message: 'Email is already verified' };
    }

    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { userId: user.id },
    });

    if (!record) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    if (record.attempts >= 5) {
      throw new BadRequestException(
        'Maximum verification attempts exceeded. Please request a new verification code.',
      );
    }

    if (record.expiresAt < new Date()) {
      throw new UnauthorizedException('Verification code has expired. Please request a new code.');
    }

    const expectedHash = hashOtp(user.id, input.otp);
    if (record.token !== expectedHash) {
      const updated = await this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      const remaining = Math.max(0, 5 - updated.attempts);
      if (remaining === 0) {
        throw new BadRequestException(
          'Maximum verification attempts exceeded. Please request a new verification code.',
        );
      }
      throw new UnauthorizedException(
        `Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      );
    }

    // Atomically verify user and delete token to prevent concurrent replay
    const [_, deleteResult] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { isEmailVerified: true },
        select: { id: true },
      }),
      this.prisma.emailVerificationToken.deleteMany({
        where: { id: record.id, token: expectedHash },
      }),
    ]);

    if (deleteResult.count === 0) {
      throw new UnauthorizedException('Verification code has already been used.');
    }

    return { success: true, message: 'Email verified successfully. You can now log in.' };
  }

  async resendOtp(input: {
    email: string;
  }): Promise<{ message: string; emailDeliveryFailed?: boolean; cooldownSeconds?: number }> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true, firstName: true, lastName: true, isEmailVerified: true },
    });

    if (!user) {
      // Avoid leaking account existence
      return {
        message: 'If an account exists with this email, a verification code has been sent.',
        cooldownSeconds: 0,
      };
    }

    if (user.isEmailVerified) {
      return { message: 'Your email is already verified', cooldownSeconds: 0 };
    }

    const existingToken = await this.prisma.emailVerificationToken.findUnique({
      where: { userId: user.id },
    });

    const now = Date.now();
    if (existingToken && existingToken.lastSentAt) {
      const elapsedMs = now - existingToken.lastSentAt.getTime();
      if (elapsedMs < 60_000) {
        const remainingSeconds = Math.ceil((60_000 - elapsedMs) / 1000);
        throw new BadRequestException({
          message: `Please wait ${remainingSeconds} seconds before requesting a new code.`,
          retryAfterSeconds: remainingSeconds,
        });
      }
    }

    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const tokenHash = hashOtp(user.id, otp);

    await this.prisma.emailVerificationToken.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        token: tokenHash,
        attempts: 0,
        expiresAt: new Date(now + 10 * 60 * 1000), // 10 minutes
        lastSentAt: new Date(now),
      },
      update: {
        token: tokenHash,
        attempts: 0,
        expiresAt: new Date(now + 10 * 60 * 1000),
        lastSentAt: new Date(now),
      },
    });

    const holderName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'there';
    let emailSent = false;
    try {
      emailSent = await this.notifications.sendEmailVerificationOtp({
        to: user.email,
        holderName,
        otp,
      });
      if (!emailSent) {
        this.logger.warn('Email verification OTP message was not delivered by provider');
      }
    } catch (err) {
      this.logger.warn(
        `Failed to dispatch email verification OTP: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      message: emailSent
        ? 'A new verification code has been sent to your email.'
        : 'A new code was generated, but email delivery failed. Please check your inbox or try again shortly.',
      emailDeliveryFailed: !emailSent,
      cooldownSeconds: 60,
    };
  }

  async verifyEmail(
    tokenOrInput: string | { email?: string; otp?: string; token?: string },
  ): Promise<{ message: string }> {
    if (typeof tokenOrInput === 'object' && tokenOrInput.email && tokenOrInput.otp) {
      const res = await this.verifyOtp({ email: tokenOrInput.email, otp: tokenOrInput.otp });
      return { message: res.message };
    }

    const token = typeof tokenOrInput === 'string' ? tokenOrInput : tokenOrInput.token;
    if (!token) {
      throw new BadRequestException('Verification token or code is required');
    }

    // Try finding by raw hex token hash or direct token
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

  async resendEmailVerification(userIdOrEmail: string): Promise<{ message: string }> {
    let user = await this.prisma.user.findUnique({
      where: { id: userIdOrEmail },
      select: { id: true, email: true, isEmailVerified: true, firstName: true, lastName: true },
    });
    if (!user) {
      user = await this.prisma.user.findUnique({
        where: { email: userIdOrEmail },
        select: { id: true, email: true, isEmailVerified: true, firstName: true, lastName: true },
      });
    }
    if (!user) {
      throw new UnauthorizedException();
    }
    if (user.isEmailVerified) {
      return { message: 'Your email is already verified' };
    }

    const result = await this.resendOtp({ email: user.email });
    return { message: result.message };
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

      // Degrades gracefully: with no BREVO_API_KEY the send is skipped.
      void this.notifications
        .sendPasswordResetEmail({
          to: email,
          holderName: `${user.firstName} ${user.lastName}`.trim() || 'there',
          resetToken: token,
          frontendUrl: this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000'),
        })
        .then((sent) => {
          if (!sent) this.logger.debug('Password reset message was not delivered');
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
