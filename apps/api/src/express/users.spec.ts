import type { Server } from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { createExpressApp } from './app';
import { UsersService } from '../modules/users/users.service';
import {
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '../common/exceptions';
import { UserRole } from '@eventai/types';
import { StructuredLogger } from '../common/logging/structured-logger';

describe('Express Users Module', () => {
  let server: Server;
  let baseUrl: string;
  let mockUsersService: jest.Mocked<Partial<UsersService>>;
  let mockPrisma: any;
  const JWT_SECRET = 'super-secret-jwt-key-for-testing-purposes-only-32-chars';

  const nullLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    logWithMeta: jest.fn(),
  } as unknown as StructuredLogger;

  beforeAll((done) => {
    mockUsersService = {
      getOwnProfile: jest.fn(),
      getPublicProfile: jest.fn(),
      updateProfile: jest.fn(),
      updatePreferences: jest.fn(),
      saveAvatar: jest.fn(),
      deactivateAccount: jest.fn(),
      getDeletionBlockers: jest.fn(),
      deleteAccount: jest.fn(),
    };

    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      user: {
        findUnique: jest.fn(),
      },
    };

    const app = createExpressApp({
      usersService: mockUsersService as unknown as UsersService,
      prisma: mockPrisma,
      jwtSecret: JWT_SECRET,
      logger: nullLogger,
      rateLimit: false,
      env: {
        JWT_SECRET,
        FRONTEND_URL: 'http://localhost:3000',
        NODE_ENV: 'test',
        REDIS_URL: '',
      },
    });

    server = app.listen(0, () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createAuthToken(userId: string, role: UserRole = UserRole.CUSTOMER): string {
    return jwt.sign(
      { sub: userId, email: `${userId}@example.com`, role },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
  }

  describe('GET /api/users/me', () => {
    it('returns own profile for authenticated user without passwordHash', async () => {
      const token = createAuthToken('u-100');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-100',
        email: 'u-100@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      const ownProfile = {
        id: 'u-100',
        email: 'u-100@example.com',
        firstName: 'Bob',
        lastName: 'Dylan',
        username: 'bobdylan',
        bio: 'Folk singer',
        profileImage: null,
        location: 'Minnesota',
        role: 'CUSTOMER',
        isEmailVerified: true,
        preferences: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      (mockUsersService.getOwnProfile as jest.Mock).mockResolvedValue(ownProfile);

      const res = await fetch(`${baseUrl}/api/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.user).toEqual(ownProfile);
      expect(data.user.passwordHash).toBeUndefined();
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/api/users/me`);
      expect(res.status).toBe(401);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toBe('Unauthorized');
    });
  });

  describe('PATCH /api/users/me', () => {
    it('updates profile fields', async () => {
      const token = createAuthToken('u-100');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-100',
        email: 'u-100@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      const updated = {
        id: 'u-100',
        email: 'u-100@example.com',
        firstName: 'Robert',
        lastName: 'Zimmerman',
        username: 'rzimmerman',
      };
      (mockUsersService.updateProfile as jest.Mock).mockResolvedValue(updated);

      const res = await fetch(`${baseUrl}/api/users/me`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firstName: 'Robert',
          lastName: 'Zimmerman',
          username: 'rzimmerman',
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.user).toEqual(updated);
      expect(mockUsersService.updateProfile).toHaveBeenCalledWith('u-100', {
        firstName: 'Robert',
        lastName: 'Zimmerman',
        username: 'rzimmerman',
      });
    });

    it('returns 409 Conflict if username is already taken', async () => {
      const token = createAuthToken('u-100');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-100',
        email: 'u-100@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      (mockUsersService.updateProfile as jest.Mock).mockRejectedValue(
        new ConflictException('That username is already taken'),
      );

      const res = await fetch(`${baseUrl}/api/users/me`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: 'alreadytaken' }),
      });

      expect(res.status).toBe(409);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Conflict');
      expect(data.message).toBe('That username is already taken');
    });

    it('rejects update when username format is invalid', async () => {
      const token = createAuthToken('u-100');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-100',
        email: 'u-100@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      const res = await fetch(`${baseUrl}/api/users/me`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: 'invalid user with spaces!' }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Bad Request');
      expect(data.errors).toBeDefined();
    });
  });

  describe('PATCH /api/users/me/preferences', () => {
    it('updates user preferences', async () => {
      const token = createAuthToken('u-100');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-100',
        email: 'u-100@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      (mockUsersService.updatePreferences as jest.Mock).mockResolvedValue({
        preferences: { theme: 'dark', notifications: true },
      });

      const res = await fetch(`${baseUrl}/api/users/me/preferences`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          preferences: { theme: 'dark', notifications: true },
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.preferences).toEqual({ theme: 'dark', notifications: true });
    });

    it('rejects preferences update with invalid structure', async () => {
      const token = createAuthToken('u-100');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-100',
        email: 'u-100@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      const res = await fetch(`${baseUrl}/api/users/me/preferences`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ preferences: 'invalid-string-not-an-object' }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Bad Request');
    });
  });

  describe('POST /api/users/me/avatar', () => {
    it('uploads avatar file and returns profileImage url', async () => {
      const token = createAuthToken('u-100');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-100',
        email: 'u-100@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      (mockUsersService.saveAvatar as jest.Mock).mockResolvedValue({
        profileImage: '/uploads/u-100-abc12345.jpg',
      });

      // Construct multipart form data
      const boundary = '---------------------------974767299852498929531610575';
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="avatar.jpg"',
        'Content-Type: image/jpeg',
        '',
        'fake-image-bytes',
        `--${boundary}--`,
        '',
      ].join('\r\n');

      const res = await fetch(`${baseUrl}/api/users/me/avatar`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.profileImage).toBe('/uploads/u-100-abc12345.jpg');
    });

    it('rejects unsupported media type with 415', async () => {
      const token = createAuthToken('u-100');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-100',
        email: 'u-100@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      (mockUsersService.saveAvatar as jest.Mock).mockRejectedValue(
        new UnsupportedMediaTypeException('Only JPEG, PNG, WebP, or GIF images are allowed'),
      );

      const boundary = '---------------------------974767299852498929531610575';
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="avatar.txt"',
        'Content-Type: text/plain',
        '',
        'fake-text-content',
        `--${boundary}--`,
        '',
      ].join('\r\n');

      const res = await fetch(`${baseUrl}/api/users/me/avatar`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      expect(res.status).toBe(415);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toContain('Only JPEG, PNG, WebP, or GIF');
    });

    it('rejects avatar upload exceeding 5 MB limit with 413', async () => {
      const token = createAuthToken('u-100');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-100',
        email: 'u-100@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      (mockUsersService.saveAvatar as jest.Mock).mockRejectedValue(
        new PayloadTooLargeException('Image must be 5 MB or smaller'),
      );

      const boundary = '---------------------------974767299852498929531610575';
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="large.jpg"',
        'Content-Type: image/jpeg',
        '',
        'oversized-image-data',
        `--${boundary}--`,
        '',
      ].join('\r\n');

      const res = await fetch(`${baseUrl}/api/users/me/avatar`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      expect(res.status).toBe(413);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Payload Too Large');
    });
  });

  describe('DELETE /api/users/me (Deactivation)', () => {
    it('deactivates account and revokes sessions', async () => {
      const token = createAuthToken('u-100');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-100',
        email: 'u-100@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      (mockUsersService.deactivateAccount as jest.Mock).mockResolvedValue({
        message: 'Your account has been deactivated',
      });

      const res = await fetch(`${baseUrl}/api/users/me`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toBe('Your account has been deactivated');
    });

    it('rejects deactivation when unauthenticated with 401', async () => {
      const res = await fetch(`${baseUrl}/api/users/me`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(401);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toBe('Unauthorized');
    });
  });

  describe('GET /api/users/me/deletion-blockers & POST /api/users/me/delete', () => {
    it('retrieves deletion blockers', async () => {
      const token = createAuthToken('u-100');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-100',
        email: 'u-100@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      (mockUsersService.getDeletionBlockers as jest.Mock).mockResolvedValue({
        canDelete: true,
        blockers: { events: [], refunds: [] },
      });

      const res = await fetch(`${baseUrl}/api/users/me/deletion-blockers`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.canDelete).toBe(true);
    });

    it('rejects permanent deletion without confirmation DELETE', async () => {
      const token = createAuthToken('u-100');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-100',
        email: 'u-100@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      const res = await fetch(`${baseUrl}/api/users/me/delete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmation: 'NO' }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.error).toBe('Bad Request');
    });

    it('anonymizes and deletes account with valid confirmation', async () => {
      const token = createAuthToken('u-100');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-100',
        email: 'u-100@example.com',
        role: 'CUSTOMER',
        isActive: true,
      });

      (mockUsersService.deleteAccount as jest.Mock).mockResolvedValue({
        message: 'Your account has been permanently deleted and personal data anonymized.',
      });

      const res = await fetch(`${baseUrl}/api/users/me/delete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.message).toContain('permanently deleted');
    });
  });

  describe('GET /api/users/:id', () => {
    it('returns public profile for valid uuid', async () => {
      const validUuid = '11111111-2222-4333-8444-555555555555';
      const publicProfile = {
        id: validUuid,
        firstName: 'Public',
        lastName: 'User',
        username: 'publicuser',
        bio: 'Hello world',
        profileImage: null,
        location: 'Earth',
        role: 'CUSTOMER',
        createdAt: new Date().toISOString(),
      };
      (mockUsersService.getPublicProfile as jest.Mock).mockResolvedValue(publicProfile);

      const res = await fetch(`${baseUrl}/api/users/${validUuid}`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.user).toEqual(publicProfile);
    });

    it('rejects invalid non-UUID parameter with 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/users/not-a-valid-uuid`);
      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toBe('Validation failed (uuid is expected)');
    });

    it('returns 404 when user is not found', async () => {
      const validUuid = '11111111-2222-4333-8444-555555555555';
      (mockUsersService.getPublicProfile as jest.Mock).mockRejectedValue(
        new NotFoundException('User not found'),
      );

      const res = await fetch(`${baseUrl}/api/users/${validUuid}`);
      expect(res.status).toBe(404);
      const data = (await res.json()) as any;
      expect(data.success).toBe(false);
      expect(data.message).toBe('User not found');
    });
  });
});
