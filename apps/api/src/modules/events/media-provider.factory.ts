import { Logger } from '../../common/exceptions';
import { CloudinaryMediaProvider, type CloudinaryProviderConfig } from './cloudinary-media.provider';
import type { MediaProvider } from './media-provider.types';

export const LEGACY_PROVIDER_ID = 'legacy';

export class MediaProviderFactory {
  private static readonly logger = new Logger(MediaProviderFactory.name);

  static cleanEnv(val: string | undefined): string | undefined {
    if (!val || typeof val !== 'string') return undefined;
    const trimmed = val.trim().replace(/^["']|["']$/g, '').trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

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

    // Fallback: check standard primary alias if CLOUDINARY_PROVIDERS was not explicitly defined
    if (providers.length === 0) {
      const primaryConfig = this.readProviderConfig('primary');
      if (primaryConfig) {
        providers.push(CloudinaryMediaProvider.create(primaryConfig));
      }
    }

    // Backward-compatible fallback: a single provider from legacy env vars.
    if (providers.length === 0) {
      const legacy = this.readLegacyConfig();
      if (legacy) {
        providers.push(CloudinaryMediaProvider.create(legacy));
      }
    }

    // Standard integration fallback: CLOUDINARY_URL (cloudinary://api_key:api_secret@cloud_name)
    if (providers.length === 0) {
      const urlConfig = this.parseCloudinaryUrl(process.env.CLOUDINARY_URL);
      if (urlConfig) {
        providers.push(CloudinaryMediaProvider.create(urlConfig));
      }
    }

    // Auto-discovery fallback: detect any explicit CLOUDINARY_<ID>_API_KEY pairs present in environment
    if (providers.length === 0) {
      const discovered = this.autoDiscoverProviders();
      for (const config of discovered) {
        providers.push(CloudinaryMediaProvider.create(config));
      }
    }

    return providers;
  }

  static parseCloudinaryUrl(url: string | undefined): CloudinaryProviderConfig | null {
    const cleaned = this.cleanEnv(url);
    if (!cleaned) return null;
    const match = cleaned.match(/^cloudinary:\/\/([^:]+):([^@]+)@([^/?#]+)/i);
    if (!match) return null;
    return {
      id: 'default',
      apiKey: decodeURIComponent(match[1]),
      apiSecret: decodeURIComponent(match[2]),
      cloudName: decodeURIComponent(match[3]),
    };
  }

  static parseProviderList(value: string | undefined): string[] {
    const cleaned = this.cleanEnv(value);
    if (!cleaned) return [];
    return cleaned
      .split(',')
      .map((s) => this.cleanEnv(s))
      .filter((s): s is string => Boolean(s && s.length > 0));
  }

  static readProviderConfig(id: string): CloudinaryProviderConfig | null {
    const upper = id.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    let cloudName = this.cleanEnv(process.env[`CLOUDINARY_${upper}_CLOUD_NAME`]);
    let apiKey = this.cleanEnv(process.env[`CLOUDINARY_${upper}_API_KEY`]);
    let apiSecret = this.cleanEnv(process.env[`CLOUDINARY_${upper}_API_SECRET`]);

    // Check alias mappings if needed (e.g. if id is 'bawrmf0r', check if PRIMARY has that cloudName)
    if (!apiKey || !apiSecret) {
      for (const alias of ['PRIMARY', 'SECONDARY', 'TERTIARY']) {
        const aliasCloud = this.cleanEnv(process.env[`CLOUDINARY_${alias}_CLOUD_NAME`]);
        if (aliasCloud && aliasCloud.toLowerCase() === id.toLowerCase()) {
          cloudName = cloudName || aliasCloud;
          apiKey = apiKey || this.cleanEnv(process.env[`CLOUDINARY_${alias}_API_KEY`]);
          apiSecret = apiSecret || this.cleanEnv(process.env[`CLOUDINARY_${alias}_API_SECRET`]);
          break;
        }
      }
    }

    // Check un-prefixed standard env variables if id explicitly matches CLOUDINARY_CLOUD_NAME
    if (!apiKey || !apiSecret) {
      const standardCloud = this.cleanEnv(process.env.CLOUDINARY_CLOUD_NAME);
      if (standardCloud && standardCloud.toLowerCase() === id.toLowerCase()) {
        cloudName = cloudName || standardCloud;
        apiKey = apiKey || this.cleanEnv(process.env.CLOUDINARY_API_KEY);
        apiSecret = apiSecret || this.cleanEnv(process.env.CLOUDINARY_API_SECRET);
      }
    }

    if (!cloudName && apiKey && apiSecret) {
      cloudName = id;
    }

    if (!cloudName || !apiKey || !apiSecret) return null;

    return { id, cloudName, apiKey, apiSecret };
  }

  static readLegacyConfig(): CloudinaryProviderConfig | null {
    const cloudName = this.cleanEnv(process.env.CLOUDINARY_CLOUD_NAME);
    const apiKey = this.cleanEnv(process.env.CLOUDINARY_API_KEY);
    const apiSecret = this.cleanEnv(process.env.CLOUDINARY_API_SECRET);

    if (!cloudName || !apiKey || !apiSecret) return null;

    return { id: LEGACY_PROVIDER_ID, cloudName, apiKey, apiSecret };
  }

  static autoDiscoverProviders(): CloudinaryProviderConfig[] {
    const discovered: CloudinaryProviderConfig[] = [];
    const seen = new Set<string>();

    for (const key of Object.keys(process.env)) {
      const match = key.match(/^CLOUDINARY_([A-Z0-9_]+)_API_KEY$/i);
      if (!match) continue;
      const id = match[1].toLowerCase();
      if (['url', 'folder', 'providers', 'routing_strategy', 'max_usage_percent'].includes(id)) {
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);

      const config = this.readProviderConfig(id);
      if (config) {
        discovered.push(config);
      }
    }

    return discovered;
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

