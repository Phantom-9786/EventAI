import {
  BadRequestException,
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
    emailVerificationToken: { deleteMany: jest.Mock };
    organizer: { findUnique: jest.Mock };
    event: { count: jest.Mock };
    payment: { count: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      session: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      emailVerificationToken: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      organizer: { findUnique: jest.fn() },
      event: { count: jest.fn().mockResolvedValue(0) },
      payment: { count: jest.fn().mockResolvedValue(0) },
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

    it('blocks organizer deactivation while active events or pending refunds remain', async () => {
      prisma.user.findUnique.mockResolvedValue({ isActive: true, role: 'ORGANIZER' });
      prisma.organizer.findUnique.mockResolvedValue({ id: 'org-1' });
      prisma.event.count.mockResolvedValue(1);

      await expect(service.deactivateAccount('user-1')).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('blocks organizer deactivation while an approved refund is processing', async () => {
      prisma.user.findUnique.mockResolvedValue({ isActive: true, role: 'ORGANIZER' });
      prisma.organizer.findUnique.mockResolvedValue({ id: 'org-1' });
      prisma.event.count.mockResolvedValue(0);
      prisma.payment.count.mockResolvedValue(1);

      await expect(service.deactivateAccount('user-1')).rejects.toThrow(ConflictException);
      expect(prisma.payment.count).toHaveBeenCalledWith({
        where: {
          OR: [{ refundRequestStatus: 'PENDING' }, { status: 'REFUND_PENDING' }],
          booking: { event: { organizerId: 'org-1' } },
        },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('deleteAccount', () => {
    it('throws BadRequestException if confirmation is not DELETE', async () => {
      await expect(service.deleteAccount('user-1', 'NO')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if user is missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.deleteAccount('user-1', 'DELETE')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('blocks organizer deletion if active events remain', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'ORGANIZER' });
      prisma.organizer.findUnique.mockResolvedValue({ id: 'org-1' });
      prisma.event.count.mockResolvedValue(1);

      await expect(service.deleteAccount('user-1', 'DELETE')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('blocks deletion if user has pending refunds', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'CUSTOMER' });
      prisma.payment.count.mockResolvedValue(1);

      await expect(service.deleteAccount('user-1', 'DELETE')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('anonymizes personal data and revokes sessions on valid confirmation', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'CUSTOMER', email: 'me@example.com' });
      prisma.payment.count.mockResolvedValue(0);

      const result = await service.deleteAccount('user-1', 'DELETE');
      expect(result.message).toContain('permanently deleted and personal data anonymized');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            firstName: 'Deleted',
            lastName: 'User',
            isActive: false,
          }),
        }),
      );
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    });
  });
});
