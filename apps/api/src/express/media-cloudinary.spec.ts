import type { Server } from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { createExpressApp } from './app';
import { EventMediaService } from '../modules/events/event-media.service';
import { ExpressModerationService } from './services/moderation.service';
import { UserRole } from '@eventai/types';
import { StructuredLogger } from '../common/logging/structured-logger';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

describe('Express Cloudinary Media Endpoints', () => {
  let server: Server;
  let baseUrl: string;
  const JWT_SECRET = 'super-secret-jwt-key-for-testing-purposes-only-32-chars';

  let mockPrisma: any;
  let mockEventsService: any;
  let mockMediaService: any;
  let mockModerationService: any;

  const nullLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    logWithMeta: jest.fn(),
  } as unknown as StructuredLogger;

  const attendeeUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'attendee@example.com',
    role: UserRole.CUSTOMER,
    isActive: true,
  };

  const organizerUser = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'organizer@example.com',
    role: UserRole.ORGANIZER,
    isActive: true,
  };

  const pendingOrganizerUser = {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'pending@example.com',
    role: UserRole.ORGANIZER,
    isActive: true,
  };

  function tokenFor(user: { id: string; email: string; role: UserRole }): string {
    return jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
  }

  const validPngHeader = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00,
  ]);

  beforeAll((done) => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
          if (where.id === attendeeUser.id) return attendeeUser;
          if (where.id === organizerUser.id) return organizerUser;
          if (where.id === pendingOrganizerUser.id) return pendingOrganizerUser;
          return null;
        }),
      },
    };

    mockEventsService = {
      searchEvents: jest.fn(),
      getPublishedEvent: jest.fn(),
    };

    mockMediaService = {
      upload: jest.fn(),
      uploadGeneric: jest.fn(),
      delete: jest.fn(),
      isUploadsEnabled: jest.fn().mockReturnValue(true),
      isCloudinaryConfigured: jest.fn().mockReturnValue(true),
    };

    mockModerationService = {
      requireApprovedOrganizer: jest.fn(async (userId: string) => {
        if (userId === pendingOrganizerUser.id) {
          throw new ForbiddenException('Organizer profile has not been approved by an administrator');
        }
        return 'org-approved-1';
      }),
    };

    const mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      wrap: jest.fn((_k: string, fn: () => any) => fn()),
    };

    const app = createExpressApp({
      prisma: mockPrisma,
      cache: mockCache as any,
      eventsService: mockEventsService,
      mediaService: mockMediaService as unknown as EventMediaService,
      moderationService: mockModerationService as unknown as ExpressModerationService,
      jwtSecret: JWT_SECRET,
      logger: nullLogger,
      rateLimit: false,
      env: {
        JWT_SECRET,
        FRONTEND_URL: 'http://localhost:3000',
        NODE_ENV: 'test',
      },
    });

    server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}/api`;
      done();
    });
  });

  afterAll((done) => {
    server.closeAllConnections?.();
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/events/upload-image (Generic organizer media upload)', () => {
    it('returns 401 when no token is provided', async () => {
      const res = await fetch(`${baseUrl}/events/upload-image`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('returns 403 when authenticated user is not an organizer', async () => {
      const res = await fetch(`${baseUrl}/events/upload-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenFor(attendeeUser)}` },
      });
      expect(res.status).toBe(403);
    });

    it('returns 403 when organizer profile is not yet approved', async () => {
      const formData = new FormData();
      formData.append('file', new Blob([validPngHeader], { type: 'image/png' }), 'cover.png');

      const res = await fetch(`${baseUrl}/events/upload-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenFor(pendingOrganizerUser)}` },
        body: formData,
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      expect(body.message).toContain('not been approved');
    });

    it('returns 200 with Cloudinary URL for approved organizer', async () => {
      const expectedCloudinaryResult = {
        url: 'https://res.cloudinary.com/demo/image/upload/v123456/eventai/events/event-media-org1.png',
        publicId: 'eventai/events/event-media-org1-uuid',
      };
      mockMediaService.uploadGeneric.mockResolvedValueOnce(expectedCloudinaryResult);

      const formData = new FormData();
      formData.append('file', new Blob([validPngHeader], { type: 'image/png' }), 'banner.png');

      const res = await fetch(`${baseUrl}/events/upload-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenFor(organizerUser)}` },
        body: formData,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.url).toBe(expectedCloudinaryResult.url);
      expect(body.publicId).toBe(expectedCloudinaryResult.publicId);
      expect(mockMediaService.uploadGeneric).toHaveBeenCalledWith(
        organizerUser.id,
        expect.objectContaining({ mimetype: 'image/png' }),
      );
    });

    it('returns 503 when media uploads are disabled by kill switch', async () => {
      mockMediaService.uploadGeneric.mockRejectedValueOnce(
        new ServiceUnavailableException('Media uploads are temporarily disabled by policy. Please contact support.'),
      );

      const formData = new FormData();
      formData.append('file', new Blob([validPngHeader], { type: 'image/png' }), 'banner.png');

      const res = await fetch(`${baseUrl}/events/upload-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenFor(organizerUser)}` },
        body: formData,
      });

      expect(res.status).toBe(503);
      const body = (await res.json()) as any;
      expect(body.message).toContain('temporarily disabled');
    });

    it('returns 413 when file is oversized', async () => {
      mockMediaService.uploadGeneric.mockRejectedValueOnce(
        new PayloadTooLargeException('Each image must be 5 MB or smaller'),
      );

      const formData = new FormData();
      formData.append('file', new Blob([validPngHeader], { type: 'image/png' }), 'large.png');

      const res = await fetch(`${baseUrl}/events/upload-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenFor(organizerUser)}` },
        body: formData,
      });

      expect(res.status).toBe(413);
      const body = (await res.json()) as any;
      expect(body.message).toContain('5 MB or smaller');
    });

    it('returns 415 when file has invalid image signature', async () => {
      mockMediaService.uploadGeneric.mockRejectedValueOnce(
        new UnsupportedMediaTypeException('Upload a valid JPEG, PNG, or WebP image.'),
      );

      const formData = new FormData();
      formData.append('file', new Blob([Buffer.from('corrupt')], { type: 'image/png' }), 'bad.png');

      const res = await fetch(`${baseUrl}/events/upload-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenFor(organizerUser)}` },
        body: formData,
      });

      expect(res.status).toBe(415);
      const body = (await res.json()) as any;
      expect(body.message).toContain('valid JPEG, PNG, or WebP');
    });
  });

  describe('POST /api/events/:eventId/images (Event-scoped upload)', () => {
    const eventId = 'e1111111-1111-4111-8111-111111111111';

    it('returns 200 with Cloudinary HTTPS URL when organizer owns event', async () => {
      const expectedUpload = {
        url: 'https://res.cloudinary.com/demo/image/upload/v123456/eventai/events/event-e111.png',
        publicId: 'eventai/events/event-e111-random',
      };
      mockMediaService.upload.mockResolvedValueOnce(expectedUpload);

      const formData = new FormData();
      formData.append('file', new Blob([validPngHeader], { type: 'image/png' }), 'cover.png');

      const res = await fetch(`${baseUrl}/events/${eventId}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenFor(organizerUser)}` },
        body: formData,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.url).toBe(expectedUpload.url);
      expect(body.publicId).toBe(expectedUpload.publicId);
      expect(mockMediaService.upload).toHaveBeenCalledWith(
        organizerUser.id,
        eventId,
        expect.objectContaining({ mimetype: 'image/png' }),
      );
    });

    it('returns 403 when organizer does not own event', async () => {
      mockMediaService.upload.mockRejectedValueOnce(
        new ForbiddenException('You do not own this event'),
      );

      const formData = new FormData();
      formData.append('file', new Blob([validPngHeader], { type: 'image/png' }), 'cover.png');

      const res = await fetch(`${baseUrl}/events/${eventId}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenFor(organizerUser)}` },
        body: formData,
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      expect(body.message).toBe('You do not own this event');
    });

    it('returns 404 when event is not found', async () => {
      mockMediaService.upload.mockRejectedValueOnce(
        new NotFoundException('Event not found'),
      );

      const formData = new FormData();
      formData.append('file', new Blob([validPngHeader], { type: 'image/png' }), 'cover.png');

      const res = await fetch(`${baseUrl}/events/${eventId}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenFor(organizerUser)}` },
        body: formData,
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.message).toBe('Event not found');
    });

    it('returns 409 when event is completed or cancelled', async () => {
      mockMediaService.upload.mockRejectedValueOnce(
        new ConflictException('Images cannot be changed for cancelled or completed events'),
      );

      const formData = new FormData();
      formData.append('file', new Blob([validPngHeader], { type: 'image/png' }), 'cover.png');

      const res = await fetch(`${baseUrl}/events/${eventId}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenFor(organizerUser)}` },
        body: formData,
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as any;
      expect(body.message).toContain('cancelled or completed');
    });
  });

  describe('DELETE /api/events/:eventId/images (Secure asset deletion)', () => {
    const eventId = 'e1111111-1111-4111-8111-111111111111';
    const mediaUrl = 'https://res.cloudinary.com/demo/image/upload/eventai/events/event-e111-cover.png';

    it('returns 200 when owner successfully deletes media asset', async () => {
      mockMediaService.delete.mockResolvedValueOnce({
        success: true,
        removed: mediaUrl,
      });

      const res = await fetch(`${baseUrl}/events/${eventId}/images`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${tokenFor(organizerUser)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mediaUrl }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.removed).toBe(mediaUrl);
      expect(mockMediaService.delete).toHaveBeenCalledWith(
        organizerUser.id,
        eventId,
        mediaUrl,
      );
    });

    it('returns 400 if media identifier is missing from request body', async () => {
      const res = await fetch(`${baseUrl}/events/${eventId}/images`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${tokenFor(organizerUser)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.message).toContain('Media identifier is required');
    });

    it('returns 403 when non-owner organizer attempts to delete media', async () => {
      mockMediaService.delete.mockRejectedValueOnce(
        new ForbiddenException('You do not own this event'),
      );

      const res = await fetch(`${baseUrl}/events/${eventId}/images`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${tokenFor(organizerUser)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mediaUrl }),
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      expect(body.message).toBe('You do not own this event');
    });

    it('returns 403 when attempting to delete asset not belonging to event', async () => {
      mockMediaService.delete.mockRejectedValueOnce(
        new ForbiddenException('The specified media does not belong to this event'),
      );

      const res = await fetch(`${baseUrl}/events/${eventId}/images`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${tokenFor(organizerUser)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mediaUrl: 'https://res.cloudinary.com/demo/image/upload/other.png' }),
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      expect(body.message).toContain('does not belong to this event');
    });
  });
});
