import { Logger } from '../../common/exceptions';
import { CloudinaryMediaProvider, type CloudinaryProviderConfig } from './cloudinary-media.provider';
import type { MediaProvider } from './media-provider.types';

export const LEGACY_PROVIDER_ID = 'legacy';

export class MediaProviderFactory {
  private static readonly logger = new Logger(MediaProviderFactory.name);

  static createProviders(): MediaProvider[] {
    const providers: MediaProvider[] = [];

    const configuredIds = this.parseProviderList(process.env.CLOUDINARY_PROVIDERS);

    if (configuredIds.length > 0) {
      for (const id of configuredIds) {
        const config = this.readProviderConfig(id);
        if (config) {
          providers.push(CloudinaryMediaProvider.create(config));
        } else {
          this.logger.warn(`Cloudinary provider "${id}" is listed but missing credentials`);
        }
      }
    }

    // Backward-compatible fallback: a single provider from the legacy env vars.
    if (providers.length === 0) {
      const legacy = this.readLegacyConfig();
      if (legacy) {
        providers.push(CloudinaryMediaProvider.create(legacy));
      }
    }

    return providers;
  }

  static parseProviderList(value: string | undefined): string[] {
    if (!value) return [];
    return value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  static readProviderConfig(id: string): CloudinaryProviderConfig | null {
    const upper = id.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    let cloudName = process.env[`CLOUDINARY_${upper}_CLOUD_NAME`]?.trim();
    let apiKey = process.env[`CLOUDINARY_${upper}_API_KEY`]?.trim();
    let apiSecret = process.env[`CLOUDINARY_${upper}_API_SECRET`]?.trim();

    // Check alias mappings if needed (e.g. if id is 'bawrmf0r', check if PRIMARY has that cloudName)
    if (!apiKey || !apiSecret) {
      for (const alias of ['PRIMARY', 'SECONDARY', 'TERTIARY']) {
        if (process.env[`CLOUDINARY_${alias}_CLOUD_NAME`]?.trim().toLowerCase() === id.toLowerCase()) {
          cloudName = cloudName || process.env[`CLOUDINARY_${alias}_CLOUD_NAME`]?.trim();
          apiKey = apiKey || process.env[`CLOUDINARY_${alias}_API_KEY`]?.trim();
          apiSecret = apiSecret || process.env[`CLOUDINARY_${alias}_API_SECRET`]?.trim();
          break;
        }
      }
    }

    if (!cloudName && apiKey && apiSecret) {
      cloudName = id;
    }

    if (!cloudName || !apiKey || !apiSecret) return null;

    return { id, cloudName, apiKey, apiSecret };
  }

  static readLegacyConfig(): CloudinaryProviderConfig | null {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
    const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

    if (!cloudName || !apiKey || !apiSecret) return null;

    return { id: LEGACY_PROVIDER_ID, cloudName, apiKey, apiSecret };
  }

  static findProviderByCloudName(
    providers: MediaProvider[],
    cloudNameOrId: string,
  ): MediaProvider | undefined {
    const lower = cloudNameOrId.toLowerCase();
    return providers.find(
      (p) => p.cloudName.toLowerCase() === lower || p.id.toLowerCase() === lower,
    );
  }
}
