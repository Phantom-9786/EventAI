import {
  BadGatewayException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  MediaProvider,
  ProviderRouterConfig,
  RoutingStrategy,
  UploadResult,
} from './media-provider.types';
import { isRetryableError } from './media-provider.types';

const DEFAULT_MAX_USAGE_PERCENT = 95;
const DEFAULT_HEALTH_CACHE_TTL_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

interface EligibleProvider {
  provider: MediaProvider;
  usagePercent: number | null;
}

export class MediaProviderRouter {
  private readonly logger = new Logger(MediaProviderRouter.name);
  private roundRobinIndex = 0;
  private readonly inFlightUploads = new Map<string, number>();

  constructor(
    private readonly providers: MediaProvider[],
    private readonly strategy: RoutingStrategy = 'least-used',
    private readonly maxUsagePercent: number = DEFAULT_MAX_USAGE_PERCENT,
    private readonly healthCacheTtlMs: number = DEFAULT_HEALTH_CACHE_TTL_MS,
  ) {}

  hasProviders(): boolean {
    return this.providers.some((p) => p.isConfigured());
  }

  getProviders(): MediaProvider[] {
    return this.providers;
  }

  getInflightCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [id, count] of this.inFlightUploads.entries()) {
      counts[id] = count;
    }
    return counts;
  }

  async selectProvider(): Promise<MediaProvider | null> {
    const eligible = await this.getEligibleProviders();
    if (eligible.length === 0) return null;

    switch (this.strategy) {
      case 'primary-only':
      case 'failover':
        // Both use the first configured provider unless it is unhealthy.
        return eligible[0]?.provider ?? null;
      case 'round-robin':
        return this.selectRoundRobin(eligible);
      case 'least-used':
      default:
        return this.selectParallelDistributed(eligible);
    }
  }

  async getEligibleProviders(): Promise<EligibleProvider[]> {
    const results = await Promise.all(
      this.providers.map(async (provider) => {
        if (!provider.isConfigured()) return null;
        const health = await provider.checkHealth();
        if (!health.healthy) {
          this.logger.warn(
            `Provider ${provider.id} (${provider.cloudName}) is ineligible: ${health.error ?? 'unhealthy'}`,
          );
          return null;
        }
        if (health.usagePercent !== null && health.usagePercent >= this.maxUsagePercent) {
          this.logger.warn(
            `Provider ${provider.id} (${provider.cloudName}) usage ${health.usagePercent}% >= threshold ${this.maxUsagePercent}%`,
          );
          return null;
        }
        return { provider, usagePercent: health.usagePercent };
      }),
    );
    return results.filter((r): r is EligibleProvider => r !== null);
  }

  async getEligibleProviderIds(): Promise<string[]> {
    const eligible = await this.getEligibleProviders();
    return eligible.map((e) => e.provider.id);
  }

  async getProviderStatusList(): Promise<
    Array<{
      id: string;
      cloudName: string;
      configured: boolean;
      healthy: boolean;
      eligible: boolean;
      usagePercent: number | null;
      error?: string;
    }>
  > {
    const list = [];
    for (const p of this.providers) {
      const configured = p.isConfigured();
      let healthy = false;
      let usagePercent: number | null = null;
      let error: string | undefined;

      if (configured) {
        try {
          const health = await p.checkHealth();
          healthy = health.healthy;
          usagePercent = health.usagePercent;
          error = health.error;
        } catch (err) {
          healthy = false;
          error = err instanceof Error ? err.message : String(err);
        }
      }

      const eligible = healthy && (usagePercent === null || usagePercent < this.maxUsagePercent);
      list.push({
        id: p.id,
        cloudName: p.cloudName,
        configured,
        healthy,
        eligible,
        usagePercent,
        error,
      });
    }
    return list;
  }

  private selectRoundRobin(eligible: EligibleProvider[]): MediaProvider {
    const index = this.roundRobinIndex % eligible.length;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % Number.MAX_SAFE_INTEGER;
    return eligible[index].provider;
  }

  /**
   * Parallel multi-provider distribution:
   * Normal incoming uploads are distributed across all healthy, eligible providers
   * rather than exhausting one provider before touching the next.
   * Takes concurrent in-flight uploads and overall usage percentage into account.
   * Providers within the same lowest-usage tier rotate via round-robin.
   */
  private selectParallelDistributed(eligible: EligibleProvider[]): MediaProvider {
    if (eligible.length === 1) return eligible[0].provider;

    const scored = eligible.map((ep) => {
      const inFlight = this.inFlightUploads.get(ep.provider.id) ?? 0;
      const usage = ep.usagePercent ?? 0;
      // Weight active in-flight uploads so concurrent requests distribute in parallel
      const effectiveScore = usage + inFlight * 5;
      return { ep, inFlight, usage, effectiveScore };
    });

    let minScore = Infinity;
    for (const item of scored) {
      if (item.effectiveScore < minScore) {
        minScore = item.effectiveScore;
      }
    }

    // Providers within 5 points of the lowest effective score form the active tier
    const candidates = scored.filter((item) => item.effectiveScore <= minScore + 5);

    const selectedIndex = this.roundRobinIndex % candidates.length;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % Number.MAX_SAFE_INTEGER;
    return candidates[selectedIndex].ep.provider;
  }

  async upload(buffer: Buffer, folder: string, publicId: string): Promise<UploadResult> {
    const initialProvider = await this.selectProvider();
    if (!initialProvider) {
      throw new ServiceUnavailableException(
        'No eligible media provider is available. Uploads are temporarily paused.',
      );
    }

    const attemptedProviders = new Set<string>();
    let currentProvider = initialProvider;
    let lastError: Error | undefined;

    while (currentProvider && !attemptedProviders.has(currentProvider.id)) {
      attemptedProviders.add(currentProvider.id);
      try {
        const inFlight = this.inFlightUploads.get(currentProvider.id) ?? 0;
        this.inFlightUploads.set(currentProvider.id, inFlight + 1);
        try {
          return await this.uploadWithRetries(currentProvider, buffer, folder, publicId);
        } finally {
          const remaining = this.inFlightUploads.get(currentProvider.id) ?? 1;
          this.inFlightUploads.set(currentProvider.id, Math.max(0, remaining - 1));
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (!isRetryableError(lastError)) {
          throw lastError;
        }

        // Try the next eligible provider for transient failures.
        const remaining = (await this.getEligibleProviders()).filter(
          (p) => !attemptedProviders.has(p.provider.id),
        );
        currentProvider = remaining[0]?.provider;
        if (currentProvider) {
          this.logger.warn(
            `Retrying upload on provider ${currentProvider.id} after failure on previous provider`,
          );
        }
      }
    }

    if (
      lastError instanceof BadGatewayException ||
      lastError instanceof ServiceUnavailableException
    ) {
      throw lastError;
    }

    throw new BadGatewayException(
      lastError
        ? `Storage service failure: ${lastError.message}`
        : 'Failed to upload media to any available storage provider.',
    );
  }

  private async uploadWithRetries(
    provider: MediaProvider,
    buffer: Buffer,
    folder: string,
    publicId: string,
  ): Promise<UploadResult> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= DEFAULT_MAX_RETRIES; attempt++) {
      try {
        return await provider.upload(buffer, folder, publicId);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          `Upload attempt ${attempt + 1} failed on provider ${provider.id}: ${lastError.message}`,
        );

        if (!isRetryableError(lastError)) {
          this.logger.warn(`Non-retryable error on provider ${provider.id}; will not retry`);
          throw lastError;
        }

        if (attempt < DEFAULT_MAX_RETRIES) {
          // Short exponential backoff before retrying the same provider.
          await this.delay(Math.min(500 * 2 ** attempt, 2000));
        }
      }
    }

    throw (
      lastError ??
      new BadGatewayException(`Failed to upload media on provider ${provider.id}`)
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
