import {
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    session: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      session: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  describe('getOwnProfile', () => {
    it('returns the full profile for an existing user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
      const profile = await service.getOwnProfile('user-1');
      expect(profile).toEqual({ id: 'user-1', email: 'a@b.com' });
    });

    it('throws NotFoundException for a missing user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getOwnProfile('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPublicProfile', () => {
    it('never returns email or preferences', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        firstName: 'Test',
        lastName: 'User',
        username: 'tester',
        bio: null,
        profileImage: null,
        location: null,
        role: 'CUSTOMER',
        createdAt: new Date(),
      });
      const profile = (await service.getPublicProfile('user-1')) as unknown as Record<
        string,
        unknown
      >;
      expect(profile.email).toBeUndefined();
      expect(profile.preferences).toBeUndefined();
    });

    it('throws NotFoundException for inactive users', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.getPublicProfile('inactive')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('updates only the provided fields', async () => {
      prisma.user.update.mockResolvedValue({ id: 'user-1', bio: 'hello' });
      const result = await service.updateProfile('user-1', { bio: 'hello' });
      expect(result.bio).toBe('hello');
      const args = prisma.user.update.mock.calls[0][0];
      expect(args.data).toEqual({ bio: 'hello' });
      expect(args.data.firstName).toBeUndefined();
    });

    it('maps P2002 to ConflictException (username taken)', async () => {
      prisma.user.update.mockRejectedValue({ code: 'P2002' });
      await expect(
        service.updateProfile('user-1', { username: 'taken' }),
      ).rejects.toThrow(ConflictException);
    });

    it('maps P2025 to NotFoundException', async () => {
      prisma.user.update.mockRejectedValue({ code: 'P2025' });
      await expect(
        service.updateProfile('missing', { bio: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updatePreferences', () => {
    it('merges new keys with existing preferences', async () => {
      prisma.user.findUnique.mockResolvedValue({
        preferences: { theme: 'dark', notify: true },
      });
      const result = await service.updatePreferences('user-1', { theme: 'light' });
      expect(result.preferences).toEqual({ theme: 'light', notify: true });
    });

    it('handles a null stored preference map', async () => {
      prisma.user.findUnique.mockResolvedValue({ preferences: null });
      const result = await service.updatePreferences('user-1', { notify: false });
      expect(result.preferences).toEqual({ notify: false });
    });
  });

  describe('saveAvatar', () => {
    it('rejects non-image mimetypes', async () => {
      await expect(
        service.saveAvatar('user-1', {
          buffer: Buffer.from('x'),
          mimetype: 'application/pdf',
          size: 10,
        }),
      ).rejects.toThrow(UnsupportedMediaTypeException);
    });

    it('rejects files larger than 5 MB', async () => {
      await expect(
        service.saveAvatar('user-1', {
          buffer: Buffer.alloc(10),
          mimetype: 'image/png',
          size: 6 * 1024 * 1024,
        }),
      ).rejects.toThrow(PayloadTooLargeException);
    });
  });

  describe('deactivateAccount', () => {
    it('deactivates and revokes sessions in one transaction', async () => {
      prisma.user.findUnique.mockResolvedValue({ isActive: true });
      const result = await service.deactivateAccount('user-1');
      expect(result.message).toContain('deactivated');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' }, data: { isActive: false } }),
      );
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    });

    it('is idempotent when already deactivated', async () => {
      prisma.user.findUnique.mockResolvedValue({ isActive: false });
      const result = await service.deactivateAccount('user-1');
      expect(result.message).toContain('already deactivated');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a missing user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.deactivateAccount('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
