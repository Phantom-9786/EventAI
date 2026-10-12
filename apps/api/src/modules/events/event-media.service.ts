import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { PrismaService } from '../../prisma/prisma.service';

export const MAX_EVENT_IMAGE_BYTES = 5 * 1024 * 1024;

/** Check binary magic numbers as well as the untrusted browser MIME declaration. */
export function eventImageExtension(buffer: Buffer, mime: string): string | null {
  if (
    mime === 'image/png' &&
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    buffer.toString('ascii', 12, 16) === 'IHDR'
  ) {
    return '.png';
  }
  if (
    mime === 'image/jpeg' &&
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff &&
    buffer[buffer.length - 2] === 0xff &&
    buffer[buffer.length - 1] === 0xd9
  ) {
    return '.jpg';
  }
  if (
    mime === 'image/webp' &&
    buffer.length >= 20 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP' &&
    buffer.readUInt32LE(4) + 8 === buffer.length &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16))
  ) {
    return '.webp';
  }
  return null;
}

@Injectable()
export class EventMediaService {
  private readonly uploadDir = resolve(process.cwd(), process.env.UPLOAD_DIR ?? './uploads');

  constructor(private readonly prisma: PrismaService) {}

  async upload(
    userId: string,
    eventId: string,
    file?: { buffer: Buffer; mimetype: string; size: number },
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { status: true, organizer: { select: { userId: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.organizer.userId !== userId) throw new ForbiddenException('You do not own this event');
    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      throw new ConflictException('Images cannot be changed for cancelled or completed events');
    }
    if (!file || !file.buffer?.length || file.size !== file.buffer.length) {
      throw new UnsupportedMediaTypeException('Choose a valid image file');
    }
    if (file.size > MAX_EVENT_IMAGE_BYTES) {
      throw new PayloadTooLargeException('Each image must be 5 MB or smaller');
    }
    const extension = eventImageExtension(file.buffer, file.mimetype);
    if (!extension) {
      throw new UnsupportedMediaTypeException(
        'Upload a valid JPEG, PNG, or WebP image. The file contents must match its type.',
      );
    }

    const filename = `event-${eventId}-${randomUUID()}${extension}`;
    await mkdir(this.uploadDir, { recursive: true });
    await writeFile(join(this.uploadDir, filename), file.buffer, { flag: 'wx' });
    return { url: `/uploads/${filename}` };
  }

  async uploadGeneric(
    userId: string,
    file?: { buffer: Buffer; mimetype: string; size: number },
  ) {
    const organizer = await this.prisma.organizer.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!organizer) throw new ForbiddenException('Organizer profile required');
    if (!file || !file.buffer?.length || file.size !== file.buffer.length) {
      throw new UnsupportedMediaTypeException('Choose a valid image file');
    }
    if (file.size > MAX_EVENT_IMAGE_BYTES) {
      throw new PayloadTooLargeException('Each image must be 5 MB or smaller');
    }
    const extension = eventImageExtension(file.buffer, file.mimetype);
    if (!extension) {
      throw new UnsupportedMediaTypeException(
        'Upload a valid JPEG, PNG, or WebP image. The file contents must match its type.',
      );
    }

    const filename = `event-media-${organizer.id}-${randomUUID()}${extension}`;
    await mkdir(this.uploadDir, { recursive: true });
    await writeFile(join(this.uploadDir, filename), file.buffer, { flag: 'wx' });
    return { url: `/uploads/${filename}` };
  }
}
