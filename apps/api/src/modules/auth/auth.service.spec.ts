import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
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
    session: { create: jest.Mock; findUnique: jest.Mock; delete: jest.Mock; deleteMany: jest.Mock };
    passwordReset: { deleteMany: jest.Mock; create: jest.Mock };
  };
  let jwtService: { signAsync: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      session: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      passwordReset: { deleteMany: jest.fn(), create: jest.fn() },
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
            sendBookingConfirmation: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('register', () => {
    it('creates a user with an Argon2id hash and returns an access token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }) => ({
        id: 'user-1',
        email: data.email,
        role: 'CUSTOMER',
      }));

      const result = await service.register({
        email: 'test@example.com',
        password: 'Password123',
        firstName: 'Test',
        lastName: 'User',
      });

      expect(result.user).toEqual({ id: 'user-1', email: 'test@example.com', role: 'CUSTOMER' });
      expect(result.tokens.accessToken).toBe('access-token');
      expect(result.tokens.refreshToken).toMatch(/^[0-9a-f]{96}$/);
      expect(prisma.user.create).toHaveBeenCalled();
      const created = prisma.user.create.mock.calls[0][0].data;
      expect(created.passwordHash).not.toBe('Password123');
      expect(await argon2.verify(created.passwordHash, 'Password123')).toBe(true);
      expect(prisma.session.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1' }) }),
      );
    });

    it('rejects duplicate emails with ConflictException', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
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
        passwordHash: await argon2.hash('Password123'),
      });
      await expect(
        service.login({ email: 'test@example.com', password: 'WrongPass1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns tokens for valid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        role: 'CUSTOMER',
        isActive: true,
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
