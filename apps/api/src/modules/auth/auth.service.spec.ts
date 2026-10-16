import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '../../common/exceptions';
import { Test } from '../../common/testing';
import { JwtService } from './jwt.service';
import { ConfigService } from '../../common/config/config.service';
import * as argon2 from 'argon2';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService } from './auth.service';
import type { GoogleProfile } from './google-oauth.service';

const googleProfile = (overrides: Partial<GoogleProfile> = {}): GoogleProfile => ({
  sub: 'google-sub-1',
  email: 'guser@example.com',
  emailVerified: true,
  firstName: 'Google',
  lastName: 'User',
  picture: 'https://lh3.googleusercontent.com/a.jpg',
  ...overrides,
});

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    session: { create: jest.Mock; findUnique: jest.Mock; delete: jest.Mock; deleteMany: jest.Mock; update: jest.Mock };
    passwordReset: { deleteMany: jest.Mock; create: jest.Mock };
    emailVerificationToken: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock };
  let configService: { get: jest.Mock };
  let sendEmailVerificationEmail: jest.Mock;
  let sendEmailVerificationOtp: jest.Mock;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      session: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
      },
      passwordReset: { deleteMany: jest.fn(), create: jest.fn() },
      emailVerificationToken: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          attempts: data?.attempts?.increment ? 1 : 0,
        })),
      },
      $transaction: jest.fn().mockImplementation(async (arg: any) => {
        if (typeof arg === 'function') {
          return arg(prisma);
        }
        return [{}, { count: 1 }];
      }),
    };
    jwtService = { signAsync: jest.fn().mockResolvedValue('access-token') };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return 'test-secret-test-secret';
        if (key === 'REFRESH_TOKEN_EXPIRY') return '30d';
        if (key === 'FRONTEND_URL') return 'http://localhost:3000';
        return undefined;
      }),
    };
    sendEmailVerificationEmail = jest.fn().mockResolvedValue(false);
    sendEmailVerificationOtp = jest.fn().mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        {
          provide: NotificationsService,
          useValue: {
            sendEmail: jest.fn().mockResolvedValue(true),
            sendPasswordResetEmail: jest.fn().mockResolvedValue(false),
            sendEmailVerificationEmail,
            sendEmailVerificationOtp,
            sendBookingConfirmation: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('register', () => {
    it('creates an unverified user, hashes password, generates OTP, and does not create a session', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }) => ({
        id: 'user-1',
        email: data.email,
        role: 'CUSTOMER',
        isEmailVerified: false,
      }));

      const result = await service.register({
        email: 'test@example.com',
        password: 'Password123',
        firstName: 'Test',
        lastName: 'User',
      });

      expect(result.user).toEqual({
        id: 'user-1',
        email: 'test@example.com',
        role: 'CUSTOMER',
        isEmailVerified: false,
      });
      // No tokens or sessions issued before verification!
      expect((result as any).tokens).toBeUndefined();
      expect(prisma.session.create).not.toHaveBeenCalled();

      // Password hashed with argon2
      expect(prisma.user.create).toHaveBeenCalled();
      const created = prisma.user.create.mock.calls[0][0].data;
      expect(created.isEmailVerified).toBe(false);
      expect(created.passwordHash).not.toBe('Password123');
      expect(await argon2.verify(created.passwordHash, 'Password123')).toBe(true);

      // OTP generated and stored as sha256(userId:otp)
      expect(prisma.emailVerificationToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          create: expect.objectContaining({
            userId: 'user-1',
            attempts: 0,
            token: expect.stringMatching(/^[0-9a-f]{64}$/),
          }),
        }),
      );

      // Brevo notification called with 6-digit OTP
      expect(sendEmailVerificationOtp).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          holderName: 'Test User',
          otp: expect.stringMatching(/^\d{6}$/),
        }),
      );
      expect(result.emailDeliveryFailed).toBe(false);
    });

    it('rejects duplicate verified emails with ConflictException', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', isEmailVerified: true });
      await expect(
        service.register({
          email: 'taken@example.com',
          password: 'Password123',
          firstName: 'T',
          lastName: 'U',
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('allows re-registering an unverified account: updates user and re-issues OTP challenge', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-unverified', isEmailVerified: false });
      prisma.user.update.mockResolvedValue({
        id: 'user-unverified',
        email: 'pending@example.com',
        role: 'CUSTOMER',
        isEmailVerified: false,
      });

      const result = await service.register({
        email: 'pending@example.com',
        password: 'NewPassword123',
        firstName: 'Updated',
        lastName: 'Pending',
      });

      expect(result.user.isEmailVerified).toBe(false);
      expect(prisma.user.update).toHaveBeenCalled();
      expect(prisma.emailVerificationToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-unverified' },
        }),
      );
      expect(sendEmailVerificationOtp).toHaveBeenCalled();
    });

    it('rolls back and propagates error if database transaction fails during registration', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValueOnce(new Error('DB failure'));

      await expect(
        service.register({
          email: 'db-fail@example.com',
          password: 'Password123',
          firstName: 'Fail',
          lastName: 'DB',
        }),
      ).rejects.toThrow('DB failure');
    });

    it('handles email delivery failure without marking account verified or creating session', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }) => ({
        id: 'user-2',
        email: data.email,
        role: 'CUSTOMER',
        isEmailVerified: false,
      }));
      sendEmailVerificationOtp.mockResolvedValueOnce(false);

      const result = await service.register({
        email: 'undeliverable@example.com',
        password: 'Password123',
        firstName: 'No',
        lastName: 'Delivery',
      });

      expect(result.emailDeliveryFailed).toBe(true);
      expect(result.user.isEmailVerified).toBe(false);
      expect(prisma.session.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('rejects an unknown email without leaking whether the account exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'ghost@example.com', password: 'Password123' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    });

    it('rejects a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        role: 'CUSTOMER',
        isActive: true,
        isEmailVerified: true,
        passwordHash: await argon2.hash('Password123'),
      });
      await expect(
        service.login({ email: 'test@example.com', password: 'WrongPass1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects unverified user login with ForbiddenException', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'unverified@example.com',
        role: 'CUSTOMER',
        isActive: true,
        isEmailVerified: false,
        passwordHash: await argon2.hash('Password123'),
      });

      await expect(
        service.login({ email: 'unverified@example.com', password: 'Password123' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    it('returns tokens for verified credentials', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        role: 'CUSTOMER',
        isActive: true,
        isEmailVerified: true,
        passwordHash: await argon2.hash('Password123'),
      });
      const result = await service.login({ email: 'test@example.com', password: 'Password123' });
      expect(result.tokens.accessToken).toBe('access-token');
      expect(prisma.session.create).toHaveBeenCalled();
    });

    it('rejects password login for a Google-only account without leaking why', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'guser@example.com',
        role: 'CUSTOMER',
        isActive: true,
        isEmailVerified: true,
        passwordHash: null,
      });
      await expect(
        service.login({ email: 'guser@example.com', password: 'Password123' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    });
  });

  describe('loginWithGoogle', () => {
    it('creates a new passwordless account for an unknown Google user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-2',
        email: 'guser@example.com',
        role: 'CUSTOMER',
      });

      const result = await service.loginWithGoogle(googleProfile());

      expect(result.user).toEqual({ id: 'user-2', email: 'guser@example.com', role: 'CUSTOMER' });
      const created = prisma.user.create.mock.calls[0][0].data;
      expect(created.googleId).toBe('google-sub-1');
      expect(created.passwordHash).toBeNull();
      expect(created.isEmailVerified).toBe(true);
      expect(created.email).toBe('guser@example.com');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.session.create).toHaveBeenCalled();
    });

    it('links an existing email/password account when the Google email is verified', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // googleId lookup
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'test@example.com',
          role: 'CUSTOMER',
          isActive: true,
          passwordHash: 'argon2-hash',
          profileImage: null,
        });
      prisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        role: 'CUSTOMER',
      });

      const result = await service.loginWithGoogle(
        googleProfile({ email: 'test@example.com' }),
      );

      expect(result.user.id).toBe('user-1');
      const updated = prisma.user.update.mock.calls[0][0];
      expect(updated.where.id).toBe('user-1');
      expect(updated.data.googleId).toBe('google-sub-1');
      expect(updated.data.isEmailVerified).toBe(true);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.session.create).toHaveBeenCalled();
    });

    it('rejects an unverified Google email before touching the database', async () => {
      await expect(
        service.loginWithGoogle(googleProfile({ emailVerified: false })),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a disabled account matched by googleId', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'guser@example.com',
        role: 'CUSTOMER',
        isActive: false,
      });
      await expect(service.loginWithGoogle(googleProfile())).rejects.toThrow(
        new UnauthorizedException('This account has been disabled'),
      );
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    it('signs in a returning Google user by googleId without linking or creating', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-2',
        email: 'guser@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      const result = await service.loginWithGoogle(googleProfile());

      expect(result.user.id).toBe('user-2');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      // Only the googleId lookup happened
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.session.create).toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('rejects changing the password of a Google-only account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-2',
        email: 'guser@example.com',
        role: 'CUSTOMER',
        isActive: true,
        passwordHash: null,
      });
      await expect(
        service.changePassword('user-2', 'OldPass1', 'NewPass1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('email verification & OTP flow', () => {
    const rawOtp = '123456';
    const otpHash = createHash('sha256').update(`user-1:${rawOtp}`).digest('hex');

    it('verifies email and deletes the token challenge atomically on correct OTP', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        isEmailVerified: false,
      });
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        userId: 'user-1',
        token: otpHash,
        attempts: 0,
        expiresAt: new Date(Date.now() + 600_000),
      });
      prisma.$transaction.mockResolvedValue([{ id: 'user-1' }, { count: 1 }]);

      const result = await service.verifyOtp({ email: 'test@example.com', otp: rawOtp });

      expect(result.success).toBe(true);
      expect(result.message).toContain('verified');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isEmailVerified: true },
        select: { id: true },
      });
      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: { id: 'evt-1', token: otpHash },
      });
    });

    it('rejects wrong OTP and increments attempts count', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        isEmailVerified: false,
      });
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        userId: 'user-1',
        token: otpHash,
        attempts: 1,
        expiresAt: new Date(Date.now() + 600_000),
      });
      prisma.emailVerificationToken.update.mockResolvedValue({ attempts: 2 });

      await expect(
        service.verifyOtp({ email: 'test@example.com', otp: '999999' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.emailVerificationToken.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('locks and rejects challenge when attempts reach 5', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        isEmailVerified: false,
      });
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        userId: 'user-1',
        token: otpHash,
        attempts: 5,
        expiresAt: new Date(Date.now() + 600_000),
      });

      await expect(
        service.verifyOtp({ email: 'test@example.com', otp: rawOtp }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an expired OTP', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        isEmailVerified: false,
      });
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        userId: 'user-1',
        token: otpHash,
        attempts: 0,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.verifyOtp({ email: 'test@example.com', otp: rawOtp }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('prevents concurrent reuse of an already-used OTP', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        isEmailVerified: false,
      });
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        userId: 'user-1',
        token: otpHash,
        attempts: 0,
        expiresAt: new Date(Date.now() + 600_000),
      });
      // Transaction returns count: 0 for deletion (another concurrent request consumed it)
      prisma.$transaction.mockResolvedValue([{ id: 'user-1' }, { count: 0 }]);

      await expect(
        service.verifyOtp({ email: 'test@example.com', otp: rawOtp }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('resends OTP: creates fresh OTP, resets attempts to 0, and updates expiry', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        isEmailVerified: false,
        firstName: 'Test',
        lastName: 'User',
      });
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        userId: 'user-1',
        attempts: 3,
        lastSentAt: new Date(Date.now() - 70_000), // > 60s cooldown passed
      });

      const result = await service.resendOtp({ email: 'test@example.com' });

      expect(result.message).toContain('verification code has been sent');
      expect(prisma.emailVerificationToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          create: expect.objectContaining({ attempts: 0 }),
          update: expect.objectContaining({ attempts: 0 }),
        }),
      );
      expect(sendEmailVerificationOtp).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          holderName: 'Test User',
          otp: expect.stringMatching(/^\d{6}$/),
        }),
      );
    });

    it('enforces 60-second resend cooldown server-side', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        isEmailVerified: false,
      });
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        userId: 'user-1',
        lastSentAt: new Date(Date.now() - 20_000), // only 20s ago
      });

      await expect(service.resendOtp({ email: 'test@example.com' })).rejects.toThrow(
        BadRequestException,
      );
      expect(sendEmailVerificationOtp).not.toHaveBeenCalled();
    });

    it('short-circuits resend for already-verified users', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        isEmailVerified: true,
      });

      const result = await service.resendOtp({ email: 'test@example.com' });

      expect(result.message).toContain('already verified');
      expect(prisma.emailVerificationToken.upsert).not.toHaveBeenCalled();
      expect(sendEmailVerificationOtp).not.toHaveBeenCalled();
    });
  });

  describe('refresh session verification guard', () => {
    it('rejects session refresh for an unverified user', async () => {
      prisma.session.findUnique.mockResolvedValue({
        id: 'session-1',
        expiresAt: new Date(Date.now() + 60_000),
        user: { id: 'user-1', email: 'test@example.com', role: 'CUSTOMER', isActive: true, isEmailVerified: false },
      });

      await expect(service.refresh('ref-token')).rejects.toThrow(UnauthorizedException);
    });

    it('allows session refresh for a verified user', async () => {
      prisma.session.findUnique.mockResolvedValue({
        id: 'session-1',
        expiresAt: new Date(Date.now() + 60_000),
        user: { id: 'user-1', email: 'test@example.com', role: 'CUSTOMER', isActive: true, isEmailVerified: true },
      });
      prisma.session.update = jest.fn().mockResolvedValue({});

      const tokens = await service.refresh('ref-token');
      expect(tokens.accessToken).toBe('access-token');
      expect(prisma.session.update).toHaveBeenCalled();
    });
  });

  describe('requestPasswordReset', () => {
    let sendPasswordResetEmail: jest.Mock;

    beforeEach(() => {
      sendPasswordResetEmail = (service as unknown as {
        notifications: { sendPasswordResetEmail: jest.Mock };
      }).notifications.sendPasswordResetEmail;
    });

    it('returns the same generic message whether or not the account exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const missing = await service.requestPasswordReset('ghost@example.com');
      expect(missing.message).toContain('If an account with that email exists');
      expect(prisma.passwordReset.create).not.toHaveBeenCalled();
      expect(sendPasswordResetEmail).not.toHaveBeenCalled();

      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        isActive: true,
        firstName: 'Test',
        lastName: 'User',
      });
      const existing = await service.requestPasswordReset('test@example.com');
      expect(existing.message).toBe(missing.message);
      expect(prisma.passwordReset.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'test@example.com' }) }),
      );
    });

    it('sends a reset email pointing at the frontend with the raw token', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        isActive: true,
        firstName: 'Test',
        lastName: 'User',
      });

      await service.requestPasswordReset('test@example.com');

      expect(sendPasswordResetEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          holderName: 'Test User',
          resetToken: expect.stringMatching(/^[0-9a-f]{64}$/),
          frontendUrl: 'http://localhost:3000',
        }),
      );
      // The token stored in the database is hashed, not the raw token
      const stored = prisma.passwordReset.create.mock.calls[0][0].data.token;
      expect(stored).not.toBe(sendPasswordResetEmail.mock.calls[0][0].resetToken);
    });

    it('does not send a reset email for an inactive account', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', isActive: false });

      await service.requestPasswordReset('test@example.com');

      expect(prisma.passwordReset.create).not.toHaveBeenCalled();
      expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });
});
