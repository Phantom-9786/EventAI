import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';

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
        return undefined;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
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
  });

  describe('requestPasswordReset', () => {
    it('returns the same generic message whether or not the account exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const missing = await service.requestPasswordReset('ghost@example.com');
      expect(missing.message).toContain('If an account with that email exists');
      expect(prisma.passwordReset.create).not.toHaveBeenCalled();

      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', isActive: true });
      const existing = await service.requestPasswordReset('test@example.com');
      expect(existing.message).toBe(missing.message);
      expect(prisma.passwordReset.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'test@example.com' }) }),
      );
    });
  });
});
