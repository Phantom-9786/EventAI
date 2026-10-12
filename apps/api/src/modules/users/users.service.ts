import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { Prisma } from '@prisma/client';
import type { UpdateProfileInput } from '@eventai/validation';
import { PrismaService } from '../../prisma/prisma.service';

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const OWN_PROFILE_SELECT = {
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
  preferences: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ═══════════════════════════════════════════════════
// User profiles: view/update own profile, public
// profiles, preferences, avatar upload, and account
// deactivation.
// ═══════════════════════════════════════════════════

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly uploadDir: string;

  constructor(private readonly prisma: PrismaService) {
    this.uploadDir = resolve(process.cwd(), process.env.UPLOAD_DIR ?? './uploads');
  }

  async getOwnProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: OWN_PROFILE_SELECT,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async getPublicProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        bio: true,
        profileImage: true,
        location: true,
        role: true,
        createdAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updateProfile(userId: string, input: UpdateProfileInput) {
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(input.firstName !== undefined && { firstName: input.firstName }),
          ...(input.lastName !== undefined && { lastName: input.lastName }),
          ...(input.username !== undefined && { username: input.username }),
          ...(input.bio !== undefined && { bio: input.bio }),
          ...(input.location !== undefined && { location: input.location }),
        },
        select: OWN_PROFILE_SELECT,
      });
      return user;
    } catch (error) {
      // Unique constraint: username already taken
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException('That username is already taken');
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'P2025'
      ) {
        throw new NotFoundException('User not found');
      }
      throw error;
    }
  }

  async updatePreferences(
    userId: string,
    preferences: Record<string, string | number | boolean>,
  ) {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    if (!current) {
      throw new NotFoundException('User not found');
    }

    const merged = {
      ...((current.preferences as Record<string, unknown> | null) ?? {}),
      ...preferences,
    };

    await this.prisma.user.update({
      where: { id: userId },
      data: { preferences: merged as Prisma.InputJsonValue },
    });
    return { preferences: merged };
  }

  async saveAvatar(
    userId: string,
    file?: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<{ profileImage: string }> {
    if (!file || file.size === 0) {
      throw new UnsupportedMediaTypeException('No image file provided');
    }
    if (file.size > MAX_AVATAR_BYTES) {
      throw new PayloadTooLargeException('Image must be 5 MB or smaller');
    }
    const extension = IMAGE_EXTENSIONS[file.mimetype];
    if (!extension || !ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        'Only JPEG, PNG, WebP, or GIF images are allowed',
      );
    }

    const previous = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profileImage: true },
    });

    const filename = `${userId}-${randomBytes(8).toString('hex')}${extension}`;
    await mkdir(this.uploadDir, { recursive: true });
    await writeFile(join(this.uploadDir, filename), file.buffer);

    const url = `/uploads/${filename}`;
    await this.prisma.user.update({
      where: { id: userId },
      data: { profileImage: url },
    });

    // Best-effort cleanup of the previous locally-stored avatar
    if (previous?.profileImage?.startsWith('/uploads/')) {
      void unlink(join(this.uploadDir, previous.profileImage.slice('/uploads/'.length))).catch(
        () => undefined,
      );
    }

    return { profileImage: url };
  }

  async deactivateAccount(userId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, role: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.isActive) {
      return { message: 'Account is already deactivated' };
    }
    if (user.role === 'ORGANIZER') {
      const organizer = await this.prisma.organizer.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (organizer) {
        const [activeEvents, pendingRefunds] = await Promise.all([
          this.prisma.event.count({
            where: { organizerId: organizer.id, status: { in: ['DRAFT', 'PUBLISHED'] } },
          }),
          this.prisma.payment.count({
            where: {
              OR: [
                { refundRequestStatus: 'PENDING' },
                { status: 'REFUND_PENDING' },
              ],
              booking: { event: { organizerId: organizer.id } },
            },
          }),
        ]);
        if (activeEvents > 0 || pendingRefunds > 0) {
          throw new ConflictException(
            'Cancel all draft or published events and resolve pending or processing refunds before deactivating this organizer account',
          );
        }
      }
    }

    // Deactivate and revoke all sessions in one transaction
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { isActive: false },
      }),
      this.prisma.session.deleteMany({ where: { userId } }),
    ]);

    this.logger.log(`Account deactivated: ${userId}`);
    return { message: 'Your account has been deactivated' };
  }
}
