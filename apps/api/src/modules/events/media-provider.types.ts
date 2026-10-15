// ═══════════════════════════════════════════════════
// Multi-environment media provider contracts
// ═══════════════════════════════════════════════════

export interface UploadResult {
  url: string;
  publicId: string;
  providerId: string;
}

export interface ProviderHealth {
  healthy: boolean;
  usagePercent: number | null;
  error?: string;
}

export interface MediaProvider {
  readonly id: string;
  readonly cloudName: string;
  isConfigured(): boolean;
  checkHealth(): Promise<ProviderHealth>;
  getUsagePercent(): Promise<number | null>;
  upload(buffer: Buffer, folder: string, publicId: string): Promise<UploadResult>;
  destroy(publicId: string): Promise<void>;
}

export type RoutingStrategy = 'least-used' | 'round-robin' | 'primary-only' | 'failover';

export interface ProviderRouterConfig {
  strategy: RoutingStrategy;
  maxUsagePercent: number;
  healthCacheTtlMs: number;
}

export function parseRoutingStrategy(value: string | undefined): RoutingStrategy {
  switch (value?.toLowerCase().trim()) {
    case 'round-robin':
      return 'round-robin';
    case 'primary-only':
      return 'primary-only';
    case 'failover':
      return 'failover';
    case 'least-used':
    default:
      return 'least-used';
  }
}

export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const message = error.message.toLowerCase();
  // Permanent auth/permission/validation failures should not be retried.
  if (
    message.includes('authentication') ||
    message.includes('authorization') ||
    message.includes('permission') ||
    message.includes('forbidden') ||
    message.includes('invalid') ||
    message.includes('not allowed') ||
    message.includes('unsupported')
  ) {
    return false;
  }
  // Timeouts and transient network errors are retryable.
  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('socket') ||
    message.includes('network') ||
    message.includes('temporarily') ||
    message.includes('503') ||
    message.includes('502') ||
    message.includes('504')
  ) {
    return true;
  }
  // Default: retry once for unknown transient failures.
  return true;
}
