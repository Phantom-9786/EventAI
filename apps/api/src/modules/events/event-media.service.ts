import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '../../common/exceptions';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { basename, join, resolve } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryMediaProvider } from './cloudinary-media.provider';
import { MediaProviderFactory } from './media-provider.factory';
import { MediaProviderRouter } from './media-provider.router';
import { parseRoutingStrategy } from './media-provider.types';
import type { MediaProvider, UploadResult } from './media-provider.types';

export const DEFAULT_MAX_EVENT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_EVENT_IMAGE_BYTES = DEFAULT_MAX_EVENT_IMAGE_BYTES;

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
  private readonly logger = new Logger(EventMediaService.name);
  private readonly uploadDir = resolve(process.cwd(), process.env.UPLOAD_DIR ?? './uploads');
  private readonly folder = process.env.CLOUDINARY_FOLDER ?? 'eventai/events';
  private providers: MediaProvider[];
  private router: MediaProviderRouter;
  private readonly customProviders: MediaProvider[] | null = null;
  private readonly customRouter: MediaProviderRouter | null = null;
  private uploadsEnabledOverride: boolean | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() providers?: MediaProvider[],
    @Optional() router?: MediaProviderRouter,
  ) {
    this.customProviders = providers ?? null;
    this.customRouter = router ?? null;
    this.providers = providers ?? MediaProviderFactory.createProviders();
    const strategy = parseRoutingStrategy(process.env.CLOUDINARY_ROUTING_STRATEGY);
    const maxUsagePercent = Number(process.env.CLOUDINARY_MAX_USAGE_PERCENT ?? 95);
    this.router = router ?? new MediaProviderRouter(this.providers, strategy, maxUsagePercent);

    if (this.providers.length > 0) {
      this.logger.log(
        `Cloudinary media storage configured with ${this.providers.length} provider(s): ${this.providers.map((p) => p.id).join(', ')}`,
      );
    }
  }

  private configuredMaxUsage: number | null = null;
  private configuredStrategy: string | null = null;

  public isCloudinaryConfigured(): boolean {
    if (this.customProviders) {
      return this.customProviders.some((p) => p.isConfigured());
    }
    const current = MediaProviderFactory.createProviders();
    if (current.length === 0) {
      this.providers = [];
      return false;
    }
    const currentIds = current.map((p) => p.id).join(',');
    const existingIds = this.providers.map((p) => p.id).join(',');
    const strategy = parseRoutingStrategy(process.env.CLOUDINARY_ROUTING_STRATEGY);
    const maxUsagePercent = Number(process.env.CLOUDINARY_MAX_USAGE_PERCENT ?? 95);

    if (
      !this.router ||
      currentIds !== existingIds ||
      this.configuredMaxUsage !== maxUsagePercent ||
      this.configuredStrategy !== strategy
    ) {
      this.providers = current;
      this.configuredMaxUsage = maxUsagePercent;
      this.configuredStrategy = strategy;
      if (!this.customRouter) {
        this.router = new MediaProviderRouter(this.providers, strategy, maxUsagePercent);
      }
    }
    return true;
  }

  public getProviders(): MediaProvider[] {
    return this.providers;
  }

  public getRouter(): MediaProviderRouter {
    return this.router;
  }

  public getConfiguredProviderIds(): string[] {
    return this.providers.filter((p) => p.isConfigured()).map((p) => p.id);
  }

  public async getEligibleProviderIds(): Promise<string[]> {
    return this.router.getEligibleProviderIds();
  }

  public async getProviderStatusList() {
    return this.router.getProviderStatusList();
  }

  public isUploadsEnabled(): boolean {
    if (this.uploadsEnabledOverride !== null) {
      return this.uploadsEnabledOverride;
    }
    const envVal = process.env.MEDIA_UPLOADS_ENABLED;
    if (envVal !== undefined) {
      const lower = envVal.toLowerCase().trim();
      return lower === 'true' || lower === '1';
    }
    return true;
  }

  public setUploadsEnabled(enabled: boolean | null): void {
    this.uploadsEnabledOverride = enabled;
  }

  public getMaxFileSizeBytes(): number {
    const envVal = process.env.MEDIA_MAX_FILE_SIZE_BYTES;
    if (envVal) {
      const parsed = Number(envVal);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
    return DEFAULT_MAX_EVENT_IMAGE_BYTES;
  }

  private getRoutingStrategyFromEnv(): string | undefined {
    return process.env.CLOUDINARY_ROUTING_STRATEGY;
  }

  private async checkUsageAllowance(): Promise<void> {
    if (!this.isCloudinaryConfigured()) return;

    const eligible = await this.router.getEligibleProviders();
    if (eligible.length === 0) {
      throw new ServiceUnavailableException(
        'Media upload quota limit reached or no provider is healthy. Media uploads are temporarily paused.',
      );
    }
  }

  async upload(
    userId: string,
    eventId: string,
    file?: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<{ url: string; publicId?: string; providerId?: string }> {
    if (!this.isUploadsEnabled()) {
      throw new ServiceUnavailableException(
        'Media uploads are temporarily disabled by policy. Please contact support.',
      );
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId);
    const event = await this.prisma.event.findFirst({
      where: isUuid ? { id: eventId } : { slug: eventId },
      select: { id: true, status: true, organizer: { select: { userId: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.organizer.userId !== userId) throw new ForbiddenException('You do not own this event');
    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      throw new ConflictException('Images cannot be changed for cancelled or completed events');
    }

    const maxBytes = this.getMaxFileSizeBytes();
    if (!file || !file.buffer?.length || file.size !== file.buffer.length) {
      throw new UnsupportedMediaTypeException('Choose a valid image file');
    }
    if (file.size > maxBytes) {
      throw new PayloadTooLargeException(
        `Each image must be ${(maxBytes / (1024 * 1024)).toFixed(0)} MB or smaller`,
      );
    }
    const extension = eventImageExtension(file.buffer, file.mimetype);
    if (!extension) {
      throw new UnsupportedMediaTypeException(
        'Upload a valid JPEG, PNG, or WebP image. The file contents must match its type.',
      );
    }

    if (!this.isCloudinaryConfigured()) {
      if (process.env.ALLOW_LOCAL_UPLOADS === 'true' && process.env.NODE_ENV !== 'production') {
        const filename = `event-${event.id}-${randomUUID()}${extension}`;
        await mkdir(this.uploadDir, { recursive: true });
        await writeFile(join(this.uploadDir, filename), file.buffer, { flag: 'wx' });
        return { url: `/uploads/${filename}` };
      }
      throw new ServiceUnavailableException('Cloudinary media storage is not configured on this server.');
    }

    await this.checkUsageAllowance();

    const publicId = `event-${event.id}-${randomUUID()}`;
    const result = await this.router.upload(file.buffer, this.folder, publicId);

    await this.prisma.eventMediaAsset.create({
      data: {
        eventId: event.id,
        url: result.url,
        providerId: result.providerId,
        publicId: result.publicId,
        kind: 'gallery',
      },
    });

    return { url: result.url, publicId: result.publicId, providerId: result.providerId };
  }

  async uploadGeneric(
    userId: string,
    file?: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<{ url: string; publicId?: string; providerId?: string }> {
    if (!this.isUploadsEnabled()) {
      throw new ServiceUnavailableException(
        'Media uploads are temporarily disabled by policy. Please contact support.',
      );
    }

    const organizer = await this.prisma.organizer.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!organizer) throw new ForbiddenException('Organizer profile required');

    return this.uploadUnattached(organizer.id, 'generic', file);
  }

  async uploadCategoryCover(
    userId: string,
    file?: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<{ url: string; publicId?: string; providerId?: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role !== 'ADMIN') throw new ForbiddenException('Admin access required');
    return this.uploadUnattached(userId, 'category', file);
  }

  private async uploadUnattached(
    ownerId: string,
    kind: 'generic' | 'category',
    file?: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<{ url: string; publicId?: string; providerId?: string }> {
    if (!this.isUploadsEnabled()) throw new ServiceUnavailableException('Media uploads are temporarily disabled by policy.');
    const maxBytes = this.getMaxFileSizeBytes();
    if (!file || !file.buffer?.length || file.size !== file.buffer.length) {
      throw new UnsupportedMediaTypeException('Choose a valid image file');
    }
    if (file.size > maxBytes) {
      throw new PayloadTooLargeException(
        `Each image must be ${(maxBytes / (1024 * 1024)).toFixed(0)} MB or smaller`,
      );
    }
    const extension = eventImageExtension(file.buffer, file.mimetype);
    if (!extension) {
      throw new UnsupportedMediaTypeException(
        'Upload a valid JPEG, PNG, or WebP image. The file contents must match its type.',
      );
    }

    if (!this.isCloudinaryConfigured()) {
      if (process.env.ALLOW_LOCAL_UPLOADS === 'true' && process.env.NODE_ENV !== 'production') {
        const filename = `${kind === 'category' ? 'category' : 'event'}-media-${ownerId}-${randomUUID()}${extension}`;
        await mkdir(this.uploadDir, { recursive: true });
        await writeFile(join(this.uploadDir, filename), file.buffer, { flag: 'wx' });
        return { url: `/uploads/${filename}` };
      }
      throw new ServiceUnavailableException('Cloudinary media storage is not configured on this server.');
    }

    await this.checkUsageAllowance();

    const publicId = `${kind === 'category' ? 'category' : 'event'}-media-${ownerId}-${randomUUID()}`;
    const result = await this.router.upload(file.buffer, kind === 'category' ? 'eventai/categories' : this.folder, publicId);

    await this.prisma.eventMediaAsset.create({
      data: {
        url: result.url,
        providerId: result.providerId,
        publicId: result.publicId,
        kind,
      },
    });

    return { url: result.url, publicId: result.publicId, providerId: result.providerId };
  }

  /**
   * Associates previously-uploaded generic media assets with a newly created or
   * updated event. This is a no-op for URLs that do not originate from this
   * service (e.g., external URLs or legacy `/uploads/` paths).
   */
  async attachUrlsToEvent(eventId: string, urls: string[]): Promise<void> {
    if (urls.length === 0) return;
    const uniqueUrls = [...new Set(urls)];
    await this.prisma.eventMediaAsset.updateMany({
      where: {
        url: { in: uniqueUrls },
        eventId: null,
        kind: 'generic',
      },
      data: { eventId },
    });
  }

  async delete(
    userId: string,
    eventId: string,
    mediaUrlOrPublicId: string,
  ): Promise<{ success: boolean; removed: string }> {
    if (!mediaUrlOrPublicId || typeof mediaUrlOrPublicId !== 'string') {
      throw new NotFoundException('Media identifier is required');
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId);
    const event = await this.prisma.event.findFirst({
      where: isUuid ? { id: eventId } : { slug: eventId },
      select: {
        id: true,
        status: true,
        coverImage: true,
        images: true,
        organizer: { select: { userId: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.organizer.userId !== userId) throw new ForbiddenException('You do not own this event');
    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      throw new ConflictException('Images cannot be changed for cancelled or completed events');
    }

    const isReferencedInImages = event.images.includes(mediaUrlOrPublicId);
    const isCoverImage = event.coverImage === mediaUrlOrPublicId;
    const hasEventIdPrefix = mediaUrlOrPublicId.includes(`event-${event.id}-`);

    if (!isReferencedInImages && !isCoverImage && !hasEventIdPrefix) {
      throw new ForbiddenException('The specified media does not belong to this event');
    }

    if (mediaUrlOrPublicId.startsWith('/uploads/')) {
      const filename = basename(mediaUrlOrPublicId);
      const localPath = join(this.uploadDir, filename);
      if (existsSync(localPath)) {
        await unlink(localPath).catch(() => undefined);
      }
    } else if (this.isCloudinaryConfigured()) {
      await this.destroyCloudinaryAsset(mediaUrlOrPublicId, event.id);
    }

    // Clean up tracked media asset row if present
    if (this.prisma.eventMediaAsset) {
      await this.prisma.eventMediaAsset
        .deleteMany({
          where: {
            url: mediaUrlOrPublicId,
            kind: { not: 'category' },
            OR: [{ eventId: event.id }, { eventId: null }],
          },
        })
        .catch(() => undefined);
    }

    const newCover = isCoverImage ? null : event.coverImage;
    const newImages = event.images.filter((img) => img !== mediaUrlOrPublicId);
    if (isCoverImage || newImages.length !== event.images.length) {
      await this.prisma.event.update({
        where: { id: event.id },
        data: {
          coverImage: newCover,
          images: newImages,
        },
      });
    }

    return { success: true, removed: mediaUrlOrPublicId };
  }

  public async cleanupUnsharedEventAssets(
    eventId: string,
    candidateAssets: { url: string; publicId: string }[],
  ): Promise<void> {
    for (const asset of candidateAssets) {
      try {
        const [sharedEventsCount, sharedAssetsCount] = await Promise.all([
          this.prisma.event.count({
            where: {
              OR: [{ coverImage: asset.url }, { images: { has: asset.url } }],
            },
          }),
          this.prisma.eventMediaAsset
            ? this.prisma.eventMediaAsset.count({
                where: {
                  url: asset.url,
                },
              })
            : Promise.resolve(0),
        ]);

        if (sharedEventsCount === 0 && sharedAssetsCount === 0) {
          if (this.isCloudinaryConfigured()) {
            await this.destroyCloudinaryAsset(asset.url, eventId);
          }
        }
      } catch (err) {
        this.logger.warn(
          `Failed safe cleanup of asset ${asset.url} for deleted event ${eventId}: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      }
    }
  }

  public async destroyCloudinaryAsset(urlOrId: string, eventId: string): Promise<void> {
    const publicId = this.extractCloudinaryPublicId(urlOrId);
    if (!publicId) return;

    const allowedPrefix = this.folder.replace(/\/.*$/, '');
    if (!publicId.startsWith(allowedPrefix) && !publicId.startsWith('event-')) {
      throw new ForbiddenException('Unauthorized media namespace deletion');
    }

    // Prefer the stored asset record to identify the exact provider.
    if (this.prisma.eventMediaAsset) {
      const asset = await this.prisma.eventMediaAsset.findFirst({
        where: {
          url: urlOrId,
          OR: [{ eventId }, { eventId: null }],
        },
      });

      if (asset) {
        // Category covers are shared platform media, not organizer-owned event files.
        if (asset.kind === 'category') return;
        const provider = this.providers.find((p) => p.id === asset.providerId);
        if (provider) {
          await provider.destroy(asset.publicId);
          return;
        }
        // Provider no longer configured: fall through to cloud-name matching.
      }
    }

    const cloudName = this.extractCloudNameFromUrl(urlOrId);
    if (cloudName) {
      const provider = MediaProviderFactory.findProviderByCloudName(this.providers, cloudName);
      if (provider) {
        await provider.destroy(publicId);
        return;
      }
    }

    // If still not determined, fallback to primary or single provider if configured
    const primary =
      this.providers.find((p) => p.id === 'primary') ??
      (this.providers.length === 1 ? this.providers[0] : null);
    if (primary && primary.isConfigured()) {
      await primary.destroy(publicId);
      return;
    }

    this.logger.warn(
      `Could not determine provider for deletion of ${urlOrId}; asset reference may remain in Cloudinary`,
    );
  }

  public extractCloudinaryPublicId(urlOrId: string): string | null {
    if (!urlOrId.startsWith('http://') && !urlOrId.startsWith('https://')) {
      return urlOrId.replace(/\.[a-zA-Z0-9]+$/, '');
    }
    const match = urlOrId.match(/\/upload\/(?:v\d+\/)?([^.]+?)(?:\.[a-zA-Z0-9]+)?$/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
    return null;
  }

  public extractCloudNameFromUrl(url: string): string | null {
    const match = url.match(/res\.cloudinary\.com\/([^/]+)\//);
    return match?.[1] ?? null;
  }
}
