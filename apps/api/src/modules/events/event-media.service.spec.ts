import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '../../common/exceptions';
import { Test } from '../../common/testing';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { EventMediaService, eventImageExtension } from './event-media.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('EventMediaService', () => {
  let service: EventMediaService;
  let prisma: {
    event: { findFirst: jest.Mock; update: jest.Mock; count: jest.Mock };
    organizer: { findUnique: jest.Mock };
    eventMediaAsset: {
      create: jest.Mock;
      findFirst: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
  };

  const originalEnv = process.env;

  const validPngHeader = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
    0x00, 0x00, 0x00, 0x0d, // chunk len
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00,
  ]);

  const validJpgHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.CLOUDINARY_PROVIDERS;
    delete process.env.CLOUDINARY_PRIMARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_SECONDARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;

    mockedAxios.get.mockResolvedValue({
      data: {
        credits: { usage: 10, limit: 100, percent_used: 10 },
      },
    } as any);

    mockedAxios.post.mockResolvedValue({
      data: {
        secure_url: 'https://res.cloudinary.com/demo-cloud/image/upload/v12345/eventai/events/event-sample.png',
        public_id: 'eventai/events/event-sample',
      },
    } as any);

    prisma = {
      event: { findFirst: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      organizer: { findUnique: jest.fn() },
      eventMediaAsset: {
        create: jest.fn().mockResolvedValue({ id: 'asset-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EventMediaService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(EventMediaService);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('eventImageExtension', () => {
    it('detects PNG from valid signature and IHDR', () => {
      expect(eventImageExtension(validPngHeader, 'image/png')).toBe('.png');
    });

    it('rejects PNG when signature does not match', () => {
      const fake = Buffer.from('not a real png header');
      expect(eventImageExtension(fake, 'image/png')).toBeNull();
    });

    it('detects JPEG from SOI and EOI markers', () => {
      expect(eventImageExtension(validJpgHeader, 'image/jpeg')).toBe('.jpg');
    });

    it('rejects unknown MIME types', () => {
      expect(eventImageExtension(validPngHeader, 'application/pdf')).toBeNull();
    });
  });

  describe('configuration & kill switch', () => {
    it('detects when Cloudinary credentials are missing', () => {
      delete process.env.CLOUDINARY_CLOUD_NAME;
      delete process.env.CLOUDINARY_API_KEY;
      delete process.env.CLOUDINARY_API_SECRET;
      delete process.env.CLOUDINARY_URL;
      delete process.env.CLOUDINARY_PROVIDERS;
      delete process.env.CLOUDINARY_PRIMARY_CLOUD_NAME;
      delete process.env.CLOUDINARY_PRIMARY_API_KEY;
      delete process.env.CLOUDINARY_PRIMARY_API_SECRET;
      expect(service.isCloudinaryConfigured()).toBe(false);
    });

    it('detects when Cloudinary credentials are fully configured', () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
      process.env.CLOUDINARY_API_KEY = '123456';
      process.env.CLOUDINARY_API_SECRET = 'secret123';
      expect(service.isCloudinaryConfigured()).toBe(true);
    });

    it('respects operator kill switch MEDIA_UPLOADS_ENABLED', () => {
      process.env.MEDIA_UPLOADS_ENABLED = 'false';
      expect(service.isUploadsEnabled()).toBe(false);

      process.env.MEDIA_UPLOADS_ENABLED = 'true';
      expect(service.isUploadsEnabled()).toBe(true);

      service.setUploadsEnabled(false);
      expect(service.isUploadsEnabled()).toBe(false);

      service.setUploadsEnabled(true);
      expect(service.isUploadsEnabled()).toBe(true);
    });
  });

  describe('upload to Cloudinary', () => {
    const userId = 'user-1';
    const eventId = 'a82ea389-cf2c-47bc-8a35-22bdfa640989';
    const slug = 'mumbai-indie-night-02c73b12';

    beforeEach(() => {
      delete process.env.CLOUDINARY_URL;
      delete process.env.CLOUDINARY_PROVIDERS;
      delete process.env.CLOUDINARY_PRIMARY_CLOUD_NAME;
      delete process.env.CLOUDINARY_PRIMARY_API_KEY;
      delete process.env.CLOUDINARY_PRIMARY_API_SECRET;
      process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
      process.env.CLOUDINARY_API_KEY = '123456';
      process.env.CLOUDINARY_API_SECRET = 'secret123';
      process.env.MEDIA_UPLOADS_ENABLED = 'true';
      // Ensure provider is refreshed with credentials
      service.isCloudinaryConfigured();
    });

    it('successfully uploads valid image to Cloudinary and returns secure_url', async () => {
      prisma.event.findFirst.mockResolvedValue({
        id: eventId,
        status: 'PUBLISHED',
        organizer: { userId },
      });

      const mockUploadResponse = {
        secure_url: 'https://res.cloudinary.com/demo-cloud/image/upload/v12345/eventai/events/event-a82ea389.png',
        public_id: 'eventai/events/event-a82ea389-random',
      };

      mockedAxios.post.mockResolvedValueOnce({
        data: mockUploadResponse,
      } as any);

      const file = {
        buffer: validPngHeader,
        mimetype: 'image/png',
        size: validPngHeader.length,
      };

      const result = await service.upload(userId, slug, file);
      expect(result.url).toBe(mockUploadResponse.secure_url);
      expect(result.publicId).toBe(mockUploadResponse.public_id);
      expect(prisma.eventMediaAsset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventId,
          url: mockUploadResponse.secure_url,
          publicId: mockUploadResponse.public_id,
        }),
      });
    });

    it('throws ServiceUnavailableException when uploads are disabled by kill switch', async () => {
      service.setUploadsEnabled(false);
      const file = {
        buffer: validPngHeader,
        mimetype: 'image/png',
        size: validPngHeader.length,
      };

      await expect(service.upload(userId, eventId, file)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException when Cloudinary is not configured in production', async () => {
      delete process.env.CLOUDINARY_CLOUD_NAME;
      delete process.env.CLOUDINARY_API_KEY;
      delete process.env.CLOUDINARY_API_SECRET;
      delete process.env.CLOUDINARY_URL;
      delete process.env.CLOUDINARY_PROVIDERS;
      delete process.env.CLOUDINARY_PRIMARY_CLOUD_NAME;
      delete process.env.CLOUDINARY_PRIMARY_API_KEY;
      delete process.env.CLOUDINARY_PRIMARY_API_SECRET;
      delete process.env.ALLOW_LOCAL_UPLOADS;
      service.isCloudinaryConfigured();

      prisma.event.findFirst.mockResolvedValue({
        id: eventId,
        status: 'PUBLISHED',
        organizer: { userId },
      });

      const file = {
        buffer: validPngHeader,
        mimetype: 'image/png',
        size: validPngHeader.length,
      };

      await expect(service.upload(userId, eventId, file)).rejects.toThrow(
        'Cloudinary media storage is not configured on this server.',
      );
    });

    it('falls back to local uploads if ALLOW_LOCAL_UPLOADS=true and Cloudinary is unconfigured', async () => {
      delete process.env.CLOUDINARY_CLOUD_NAME;
      delete process.env.CLOUDINARY_API_KEY;
      delete process.env.CLOUDINARY_API_SECRET;
      delete process.env.CLOUDINARY_URL;
      delete process.env.CLOUDINARY_PROVIDERS;
      delete process.env.CLOUDINARY_PRIMARY_CLOUD_NAME;
      delete process.env.CLOUDINARY_PRIMARY_API_KEY;
      delete process.env.CLOUDINARY_PRIMARY_API_SECRET;
      process.env.ALLOW_LOCAL_UPLOADS = 'true';
      process.env.NODE_ENV = 'development';
      service.isCloudinaryConfigured();

      prisma.event.findFirst.mockResolvedValue({
        id: eventId,
        status: 'PUBLISHED',
        organizer: { userId },
      });

      const file = {
        buffer: validPngHeader,
        mimetype: 'image/png',
        size: validPngHeader.length,
      };

      const result = await service.upload(userId, slug, file);
      expect(result.url).toMatch(/^\/uploads\/event-a82ea389-.*\.png$/);
    });

    it('throws BadGatewayException when Cloudinary API returns an error without leaking secrets', async () => {
      prisma.event.findFirst.mockResolvedValue({
        id: eventId,
        status: 'PUBLISHED',
        organizer: { userId },
      });

      mockedAxios.post.mockRejectedValue(new Error('Cloudinary 500: Server failure with internal-token-12345'));

      const file = {
        buffer: validPngHeader,
        mimetype: 'image/png',
        size: validPngHeader.length,
      };

      await expect(service.upload(userId, eventId, file)).rejects.toThrow(
        BadGatewayException,
      );
      // Ensure raw secret is not in the client-facing error
      await expect(service.upload(userId, eventId, file)).rejects.toThrow(
        'Failed to upload media to storage service. Please try again later.',
      );
    });

    it('throws ForbiddenException if user is not event organizer', async () => {
      prisma.event.findFirst.mockResolvedValue({
        id: eventId,
        status: 'PUBLISHED',
        organizer: { userId: 'different-user' },
      });

      const file = {
        buffer: validPngHeader,
        mimetype: 'image/png',
        size: validPngHeader.length,
      };

      await expect(service.upload(userId, eventId, file)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException if event does not exist', async () => {
      prisma.event.findFirst.mockResolvedValue(null);

      const file = {
        buffer: validPngHeader,
        mimetype: 'image/png',
        size: validPngHeader.length,
      };

      await expect(service.upload(userId, eventId, file)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException if event is CANCELLED or COMPLETED', async () => {
      prisma.event.findFirst.mockResolvedValue({
        id: eventId,
        status: 'CANCELLED',
        organizer: { userId },
      });

      const file = {
        buffer: validPngHeader,
        mimetype: 'image/png',
        size: validPngHeader.length,
      };

      await expect(service.upload(userId, eventId, file)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws PayloadTooLargeException if file exceeds maximum size', async () => {
      prisma.event.findFirst.mockResolvedValue({
        id: eventId,
        status: 'PUBLISHED',
        organizer: { userId },
      });

      const largeBuffer = Buffer.alloc(6 * 1024 * 1024);
      const file = {
        buffer: largeBuffer,
        mimetype: 'image/png',
        size: largeBuffer.length,
      };

      await expect(service.upload(userId, eventId, file)).rejects.toThrow(
        PayloadTooLargeException,
      );
    });

    it('throws UnsupportedMediaTypeException for mismatched file magic header', async () => {
      prisma.event.findFirst.mockResolvedValue({
        id: eventId,
        status: 'PUBLISHED',
        organizer: { userId },
      });

      const invalidBuffer = Buffer.from('this is not a valid png image');
      const file = {
        buffer: invalidBuffer,
        mimetype: 'image/png',
        size: invalidBuffer.length,
      };

      await expect(service.upload(userId, eventId, file)).rejects.toThrow(
        UnsupportedMediaTypeException,
      );
    });

    it('fails closed when Cloudinary usage exceeds threshold', async () => {
      process.env.CLOUDINARY_MAX_USAGE_PERCENT = '90';
      mockedAxios.get.mockResolvedValue({
        data: {
          credits: { percent_used: 94.5 },
        },
      } as any);

      // Re-initialize router with 90% threshold
      service.isCloudinaryConfigured();

      prisma.event.findFirst.mockResolvedValue({
        id: eventId,
        status: 'PUBLISHED',
        organizer: { userId },
      });

      const file = {
        buffer: validPngHeader,
        mimetype: 'image/png',
        size: validPngHeader.length,
      };

      await expect(service.upload(userId, eventId, file)).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(service.upload(userId, eventId, file)).rejects.toThrow(
        'Media upload quota limit reached',
      );
    });
  });

  describe('uploadGeneric', () => {
    const userId = 'user-1';

    beforeEach(() => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
      process.env.CLOUDINARY_API_KEY = '123456';
      process.env.CLOUDINARY_API_SECRET = 'secret123';
      process.env.MEDIA_UPLOADS_ENABLED = 'true';
      service.isCloudinaryConfigured();
    });

    it('uploads generic media to Cloudinary for valid organizer', async () => {
      prisma.organizer.findUnique.mockResolvedValue({ id: 'org-1' });

      const mockUploadResponse = {
        secure_url: 'https://res.cloudinary.com/demo-cloud/image/upload/v12345/eventai/events/event-media-org-1.png',
        public_id: 'eventai/events/event-media-org-1-uuid',
      };

      mockedAxios.post.mockResolvedValueOnce({
        data: mockUploadResponse,
      } as any);

      const file = {
        buffer: validPngHeader,
        mimetype: 'image/png',
        size: validPngHeader.length,
      };

      const result = await service.uploadGeneric(userId, file);
      expect(result.url).toBe(mockUploadResponse.secure_url);
      expect(result.publicId).toBe(mockUploadResponse.public_id);
    });

    it('throws ForbiddenException if user has no organizer profile', async () => {
      prisma.organizer.findUnique.mockResolvedValue(null);

      const file = {
        buffer: validPngHeader,
        mimetype: 'image/png',
        size: validPngHeader.length,
      };

      await expect(service.uploadGeneric(userId, file)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('delete & cleanup', () => {
    const userId = 'user-1';
    const eventId = 'a82ea389-cf2c-47bc-8a35-22bdfa640989';
    const cloudinaryUrl = 'https://res.cloudinary.com/demo-cloud/image/upload/v123/eventai/events/event-a82ea389-img1.webp';

    beforeEach(() => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
      process.env.CLOUDINARY_API_KEY = '123456';
      process.env.CLOUDINARY_API_SECRET = 'secret123';
      service.isCloudinaryConfigured();
    });

    it('successfully deletes Cloudinary asset and updates event in database', async () => {
      prisma.event.findFirst.mockResolvedValue({
        id: eventId,
        status: 'PUBLISHED',
        coverImage: cloudinaryUrl,
        images: [cloudinaryUrl, 'https://res.cloudinary.com/demo/image/upload/eventai/events/event-a82ea389-img2.webp'],
        organizer: { userId },
      });
      prisma.event.update.mockResolvedValue({});
      mockedAxios.post.mockResolvedValue({ data: { result: 'ok' } } as any);

      const result = await service.delete(userId, eventId, cloudinaryUrl);
      expect(result.success).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/image/destroy'),
        expect.anything(),
        expect.anything(),
      );
      expect(prisma.event.update).toHaveBeenCalledWith({
        where: { id: eventId },
        data: {
          coverImage: null,
          images: ['https://res.cloudinary.com/demo/image/upload/eventai/events/event-a82ea389-img2.webp'],
        },
      });
      expect(prisma.eventMediaAsset.deleteMany).toHaveBeenCalled();
    });

    it('rejects deletion when user does not own event', async () => {
      prisma.event.findFirst.mockResolvedValue({
        id: eventId,
        status: 'PUBLISHED',
        coverImage: cloudinaryUrl,
        images: [cloudinaryUrl],
        organizer: { userId: 'unauthorized-user' },
      });

      await expect(service.delete(userId, eventId, cloudinaryUrl)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('rejects deletion of asset not belonging to the event', async () => {
      prisma.event.findFirst.mockResolvedValue({
        id: eventId,
        status: 'PUBLISHED',
        coverImage: 'https://res.cloudinary.com/demo/image/upload/eventai/events/event-a82ea389-real.webp',
        images: [],
        organizer: { userId },
      });

      const arbitraryAssetUrl = 'https://res.cloudinary.com/demo/image/upload/eventai/events/event-other-123.webp';

      await expect(service.delete(userId, eventId, arbitraryAssetUrl)).rejects.toThrow(
        'The specified media does not belong to this event',
      );
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('extracts public ID cleanly from Cloudinary URLs', () => {
      expect(
        service.extractCloudinaryPublicId('https://res.cloudinary.com/demo/image/upload/v12345/eventai/events/event-123.jpg'),
      ).toBe('eventai/events/event-123');

      expect(
        service.extractCloudinaryPublicId('https://res.cloudinary.com/demo/image/upload/eventai/events/event-456.webp'),
      ).toBe('eventai/events/event-456');

      expect(service.extractCloudinaryPublicId('eventai/events/raw-id')).toBe('eventai/events/raw-id');
    });

    it('cleans up unshared assets via destroyCloudinaryAsset when unshared', async () => {
      process.env.CLOUDINARY_PROVIDERS = 'primary';
      process.env.CLOUDINARY_PRIMARY_CLOUD_NAME = 'demo-cloud';
      process.env.CLOUDINARY_PRIMARY_API_KEY = 'api-key-1';
      process.env.CLOUDINARY_PRIMARY_API_SECRET = 'api-secret-1';

      prisma.event.count.mockResolvedValue(0);
      prisma.eventMediaAsset.count.mockResolvedValue(0);

      const destroySpy = jest.spyOn(service, 'destroyCloudinaryAsset').mockResolvedValue(undefined);

      await service.cleanupUnsharedEventAssets('evt-1', [
        { url: 'https://res.cloudinary.com/demo-cloud/image/upload/eventai/events/asset-1.jpg', publicId: 'eventai/events/asset-1' },
      ]);

      expect(destroySpy).toHaveBeenCalledWith(
        'https://res.cloudinary.com/demo-cloud/image/upload/eventai/events/asset-1.jpg',
        'evt-1',
      );
    });

    it('preserves shared assets and does not destroy them when referenced elsewhere', async () => {
      process.env.CLOUDINARY_PROVIDERS = 'primary';
      process.env.CLOUDINARY_PRIMARY_CLOUD_NAME = 'demo-cloud';
      process.env.CLOUDINARY_PRIMARY_API_KEY = 'api-key-1';
      process.env.CLOUDINARY_PRIMARY_API_SECRET = 'api-secret-1';

      // Asset is referenced in another event
      prisma.event.count.mockResolvedValue(1);
      prisma.eventMediaAsset.count.mockResolvedValue(0);

      const destroySpy = jest.spyOn(service, 'destroyCloudinaryAsset').mockResolvedValue(undefined);

      await service.cleanupUnsharedEventAssets('evt-1', [
        { url: 'https://res.cloudinary.com/demo-cloud/image/upload/eventai/events/shared-asset.jpg', publicId: 'eventai/events/shared-asset' },
      ]);

      expect(destroySpy).not.toHaveBeenCalled();
    });
  });
});
