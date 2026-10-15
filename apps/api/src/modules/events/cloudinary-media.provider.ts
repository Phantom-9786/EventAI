import {
  BadGatewayException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { type AxiosResponse } from 'axios';
import FormData from 'form-data';
import { createHash } from 'crypto';
import type { MediaProvider, ProviderHealth, UploadResult } from './media-provider.types';

const UPLOAD_TIMEOUT_MS = 30_000;
const USAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const HEALTH_CACHE_TTL_MS = 30_000;

export interface CloudinaryProviderConfig {
  id: string;
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

interface CloudinaryUploadResponse {
  secure_url: string;
  public_id: string;
  format?: string;
  bytes?: number;
}

interface CloudinaryUsageResponse {
  credits?: { usage?: number; percent_used?: number; limit?: number };
}

export class CloudinaryMediaProvider implements MediaProvider {
  private readonly logger: Logger;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private lastUsageCheck = 0;
  private cachedUsagePercent: number | null = null;
  private lastHealthCheck = 0;
  private cachedHealth: ProviderHealth | null = null;

  constructor(
    public readonly id: string,
    public readonly cloudName: string,
    apiKey: string,
    apiSecret: string,
  ) {
    this.logger = new Logger(`CloudinaryMediaProvider:${id}`);
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  static create(config: CloudinaryProviderConfig): CloudinaryMediaProvider {
    return new CloudinaryMediaProvider(
      config.id,
      config.cloudName,
      config.apiKey,
      config.apiSecret,
    );
  }

  isConfigured(): boolean {
    return Boolean(this.cloudName && this.apiKey && this.apiSecret);
  }

  private baseUrl(): string {
    return `https://api.cloudinary.com/v1_1/${this.cloudName}`;
  }

  private basicAuthHeader(): string {
    const credentials = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');
    return `Basic ${credentials}`;
  }

  private generateSignature(params: Record<string, string>): string {
    const sortedKeys = Object.keys(params).sort();
    const payload = sortedKeys.map((key) => `${key}=${params[key]}`).join('&') + this.apiSecret;
    return createHash('sha1').update(payload).digest('hex');
  }

  async checkHealth(): Promise<ProviderHealth> {
    const now = Date.now();
    if (this.cachedHealth && now - this.lastHealthCheck < HEALTH_CACHE_TTL_MS) {
      return this.cachedHealth;
    }

    try {
      const usagePercent = await this.getUsagePercent();
      const health: ProviderHealth = {
        healthy: true,
        usagePercent,
      };
      this.cachedHealth = health;
      this.lastHealthCheck = now;
      return health;
    } catch (err) {
      const health: ProviderHealth = {
        healthy: false,
        usagePercent: null,
        error: err instanceof Error ? err.message : String(err),
      };
      this.cachedHealth = health;
      this.lastHealthCheck = now;
      return health;
    }
  }

  async getUsagePercent(): Promise<number | null> {
    const now = Date.now();
    if (now - this.lastUsageCheck < USAGE_CACHE_TTL_MS) {
      return this.cachedUsagePercent;
    }

    try {
      const response = await axios.get<CloudinaryUsageResponse>(`${this.baseUrl()}/usage`, {
        headers: { Authorization: this.basicAuthHeader() },
        timeout: 10_000,
      });
      const usage = response.data;
      this.lastUsageCheck = now;
      if (usage?.credits?.percent_used !== undefined) {
        this.cachedUsagePercent = usage.credits.percent_used;
        return this.cachedUsagePercent;
      }
      if (
        usage?.credits?.usage !== undefined &&
        usage?.credits?.limit !== undefined &&
        usage.credits.limit > 0
      ) {
        this.cachedUsagePercent = (usage.credits.usage / usage.credits.limit) * 100;
        return this.cachedUsagePercent;
      }
      this.cachedUsagePercent = null;
      return null;
    } catch (err) {
      this.logger.warn(`Usage check failed: ${err instanceof Error ? err.message : String(err)}`);
      this.lastUsageCheck = now;
      throw err;
    }
  }

  async upload(buffer: Buffer, folder: string, publicId: string): Promise<UploadResult> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signatureParams: Record<string, string> = {
      folder,
      public_id: publicId,
      timestamp,
    };
    const signature = this.generateSignature(signatureParams);

    const form = new FormData();
    form.append('file', buffer, { filename: 'upload' });
    form.append('api_key', this.apiKey);
    form.append('timestamp', timestamp);
    form.append('signature', signature);
    form.append('folder', folder);
    form.append('public_id', publicId);

    let response: AxiosResponse<CloudinaryUploadResponse>;
    try {
      response = await axios.post<CloudinaryUploadResponse>(
        `${this.baseUrl()}/image/upload`,
        form,
        {
          headers: form.getHeaders(),
          timeout: UPLOAD_TIMEOUT_MS,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        },
      );
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        const status = err.response.status;
        const data = err.response.data as { error?: { message?: string } } | undefined;
        const message = data?.error?.message ?? `Cloudinary upload failed with status ${status}`;
        this.logger.error(`Upload failed: ${message}`);
        throw this.mapError(message, status);
      }
      this.logger.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
      throw this.mapError(err instanceof Error ? err.message : 'Unknown upload error', 0);
    }

    if (!response.data?.secure_url || !response.data?.public_id) {
      throw new BadGatewayException('Storage service returned an incomplete response.');
    }

    return {
      url: response.data.secure_url,
      publicId: response.data.public_id,
      providerId: this.id,
    };
  }

  async destroy(publicId: string): Promise<void> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signatureParams: Record<string, string> = {
      public_id: publicId,
      timestamp,
    };
    const signature = this.generateSignature(signatureParams);

    const form = new FormData();
    form.append('public_id', publicId);
    form.append('api_key', this.apiKey);
    form.append('timestamp', timestamp);
    form.append('signature', signature);

    try {
      await axios.post(`${this.baseUrl()}/image/destroy`, form, {
        headers: form.getHeaders(),
        timeout: 10_000,
      });
    } catch (err) {
      this.logger.warn(
        `Destroy failed for ${publicId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private mapError(message: string, status: number): Error {
    const lower = message.toLowerCase();
    if (
      status === 401 ||
      status === 403 ||
      lower.includes('authentication') ||
      lower.includes('authorization') ||
      lower.includes('permission') ||
      lower.includes('forbidden') ||
      lower.includes('invalid signature') ||
      lower.includes('api key') ||
      lower.includes('api secret')
    ) {
      return new ServiceUnavailableException(
        'Media provider rejected the upload due to credentials or permissions.',
      );
    }
    if (status === 400 || lower.includes('not allowed') || lower.includes('unsupported')) {
      return new ServiceUnavailableException('Media provider rejected the upload request.');
    }
    return new BadGatewayException('Failed to upload media to storage service. Please try again later.');
  }
}
