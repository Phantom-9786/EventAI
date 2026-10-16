import { BadGatewayException, ServiceUnavailableException } from '../../common/exceptions';
import { MediaProviderRouter } from './media-provider.router';
import type { MediaProvider, ProviderHealth, UploadResult } from './media-provider.types';

function createMockProvider(
  id: string,
  cloudName: string,
  options: {
    healthy?: boolean;
    usagePercent?: number | null;
    isConfigured?: boolean;
    uploadDelayMs?: number;
    uploadError?: Error;
  } = {},
): MediaProvider {
  return {
    id,
    cloudName,
    isConfigured: jest.fn().mockReturnValue(options.isConfigured ?? true),
    checkHealth: jest.fn().mockResolvedValue({
      healthy: options.healthy ?? true,
      usagePercent: options.usagePercent ?? 10,
      error: options.healthy === false ? '403 Forbidden: Request forbidden due to missing permissions' : undefined,
    } as ProviderHealth),
    getUsagePercent: jest.fn().mockResolvedValue(options.usagePercent ?? 10),
    upload: jest.fn().mockImplementation(async (_buf, _folder, publicId) => {
      if (options.uploadDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.uploadDelayMs));
      }
      if (options.uploadError) {
        throw options.uploadError;
      }
      return {
        url: `https://res.cloudinary.com/${cloudName}/image/upload/v1/${publicId}.png`,
        publicId,
        providerId: id,
      } as UploadResult;
    }),
    destroy: jest.fn().mockResolvedValue(undefined),
  };
}

describe('MediaProviderRouter', () => {
  const dummyBuffer = Buffer.from('dummy image data');
  const dummyFolder = 'eventai/events';
  const dummyPublicId = 'event-123-abc';

  describe('selectProvider and parallel distribution', () => {
    it('distributes consecutive uploads across all eligible providers in the lowest usage tier', async () => {
      // Both p1 and p2 have near-zero usage (< 5% difference)
      const p1 = createMockProvider('bawrmf0r', 'bawrmf0r', { usagePercent: 0.04 });
      const p2 = createMockProvider('hy5dkfmo', 'hy5dkfmo', { usagePercent: 0.00 });

      const router = new MediaProviderRouter([p1, p2], 'least-used', 95);

      const first = await router.selectProvider();
      const second = await router.selectProvider();
      const third = await router.selectProvider();
      const fourth = await router.selectProvider();

      const selectedIds = [first?.id, second?.id, third?.id, fourth?.id];
      // Proves parallel distribution between both providers without waiting for one to exhaust
      expect(selectedIds).toContain('bawrmf0r');
      expect(selectedIds).toContain('hy5dkfmo');
      expect(first?.id).not.toBe(second?.id);
    });

    it('cycles sequentially under "round-robin" strategy', async () => {
      const p1 = createMockProvider('primary', 'cloud-1', { usagePercent: 10 });
      const p2 = createMockProvider('secondary', 'cloud-2', { usagePercent: 20 });

      const router = new MediaProviderRouter([p1, p2], 'round-robin', 95);

      const first = await router.selectProvider();
      const second = await router.selectProvider();
      const third = await router.selectProvider();

      expect(first?.id).toBe('primary');
      expect(second?.id).toBe('secondary');
      expect(third?.id).toBe('primary');
    });

    it('always selects primary under "primary-only" strategy if healthy', async () => {
      const p1 = createMockProvider('primary', 'cloud-1', { usagePercent: 80 });
      const p2 = createMockProvider('secondary', 'cloud-2', { usagePercent: 10 });

      const router = new MediaProviderRouter([p1, p2], 'primary-only', 95);
      const selected = await router.selectProvider();

      expect(selected?.id).toBe('primary');
    });

    it('skips unhealthy or unauthorized providers like vdugsome', async () => {
      const p1 = createMockProvider('bawrmf0r', 'bawrmf0r', { healthy: true, usagePercent: 0.04 });
      const p2 = createMockProvider('hy5dkfmo', 'hy5dkfmo', { healthy: true, usagePercent: 0.00 });
      // vdugsome has credentials configured but fails permissions check
      const vdugsome = createMockProvider('vdugsome', 'vdugsome', {
        healthy: false,
        usagePercent: null,
      });

      const router = new MediaProviderRouter([p1, p2, vdugsome], 'least-used', 95);

      const eligibleIds = await router.getEligibleProviderIds();
      expect(eligibleIds).toEqual(['bawrmf0r', 'hy5dkfmo']);
      expect(eligibleIds).not.toContain('vdugsome');

      const statusList = await router.getProviderStatusList();
      const vdugsomeStatus = statusList.find((s) => s.id === 'vdugsome');
      expect(vdugsomeStatus?.configured).toBe(true);
      expect(vdugsomeStatus?.healthy).toBe(false);
      expect(vdugsomeStatus?.eligible).toBe(false);

      // Subsequent selections only go to bawrmf0r and hy5dkfmo
      const s1 = await router.selectProvider();
      const s2 = await router.selectProvider();
      expect([s1?.id, s2?.id]).toEqual(expect.arrayContaining(['bawrmf0r', 'hy5dkfmo']));
      expect(s1?.id).not.toBe('vdugsome');
      expect(s2?.id).not.toBe('vdugsome');
    });

    it('skips providers exceeding the max usage percentage threshold', async () => {
      const p1 = createMockProvider('primary', 'cloud-1', { usagePercent: 96 });
      const p2 = createMockProvider('secondary', 'cloud-2', { usagePercent: 40 });

      const router = new MediaProviderRouter([p1, p2], 'least-used', 95);
      const selected = await router.selectProvider();

      expect(selected?.id).toBe('secondary');
    });

    it('returns null when all providers are over quota or unhealthy', async () => {
      const p1 = createMockProvider('primary', 'cloud-1', { usagePercent: 98 });
      const p2 = createMockProvider('secondary', 'cloud-2', { healthy: false });

      const router = new MediaProviderRouter([p1, p2], 'least-used', 95);
      const selected = await router.selectProvider();

      expect(selected).toBeNull();
    });
  });

  describe('concurrent upload distribution', () => {
    it('distributes simultaneous concurrent uploads across different eligible providers', async () => {
      // Configure two providers with a slight delay to simulate network latency
      const p1 = createMockProvider('bawrmf0r', 'bawrmf0r', {
        usagePercent: 0,
        uploadDelayMs: 50,
      });
      const p2 = createMockProvider('hy5dkfmo', 'hy5dkfmo', {
        usagePercent: 0,
        uploadDelayMs: 50,
      });

      const router = new MediaProviderRouter([p1, p2], 'least-used', 95);

      // Launch 2 uploads concurrently
      const [upload1, upload2] = await Promise.all([
        router.upload(dummyBuffer, dummyFolder, 'asset-1'),
        router.upload(dummyBuffer, dummyFolder, 'asset-2'),
      ]);

      // Each image uploaded exactly once to one provider
      expect(upload1.providerId).toBeDefined();
      expect(upload2.providerId).toBeDefined();

      // The two concurrent uploads were assigned to different providers in parallel
      expect(upload1.providerId).not.toBe(upload2.providerId);
      expect(new Set([upload1.providerId, upload2.providerId])).toEqual(
        new Set(['bawrmf0r', 'hy5dkfmo']),
      );

      // Verify each provider executed exactly 1 upload
      expect(p1.upload).toHaveBeenCalledTimes(1);
      expect(p2.upload).toHaveBeenCalledTimes(1);

      // In-flight counts should return to 0 after completion
      expect(router.getInflightCounts()).toEqual({
        bawrmf0r: 0,
        hy5dkfmo: 0,
      });
    });
  });

  describe('upload, failover & bounded retries', () => {
    it('successfully uploads to selected provider', async () => {
      const p1 = createMockProvider('primary', 'cloud-1', { usagePercent: 10 });
      const router = new MediaProviderRouter([p1], 'primary-only', 95);

      const result = await router.upload(dummyBuffer, dummyFolder, dummyPublicId);
      expect(result.providerId).toBe('primary');
      expect(result.url).toContain('cloud-1');
      expect(p1.upload).toHaveBeenCalledWith(dummyBuffer, dummyFolder, dummyPublicId);
    });

    it('throws ServiceUnavailableException when no eligible provider is available', async () => {
      const p1 = createMockProvider('primary', 'cloud-1', { usagePercent: 99 });
      const router = new MediaProviderRouter([p1], 'primary-only', 95);

      await expect(
        router.upload(dummyBuffer, dummyFolder, dummyPublicId),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('fails over to secondary provider when primary encounters retryable error', async () => {
      const p1 = createMockProvider('primary', 'cloud-1', { usagePercent: 10 });
      const p2 = createMockProvider('secondary', 'cloud-2', { usagePercent: 20 });

      // Primary fails with retryable 503 timeout
      (p1.upload as jest.Mock).mockRejectedValue(new Error('Cloudinary 503 Service Temporarily Unavailable'));

      const router = new MediaProviderRouter([p1, p2], 'primary-only', 95);
      const result = await router.upload(dummyBuffer, dummyFolder, dummyPublicId);

      expect(result.providerId).toBe('secondary');
      expect(p1.upload).toHaveBeenCalled();
      expect(p2.upload).toHaveBeenCalled();
    });

    it('aborts immediately and does not failover when encountering non-retryable error', async () => {
      const p1 = createMockProvider('primary', 'cloud-1', { usagePercent: 10 });
      const p2 = createMockProvider('secondary', 'cloud-2', { usagePercent: 20 });

      // Primary fails with non-retryable authentication failure
      (p1.upload as jest.Mock).mockRejectedValue(new Error('Invalid authorization signature'));

      const router = new MediaProviderRouter([p1, p2], 'primary-only', 95);

      await expect(
        router.upload(dummyBuffer, dummyFolder, dummyPublicId),
      ).rejects.toThrow('Invalid authorization signature');

      expect(p1.upload).toHaveBeenCalledTimes(1);
      expect(p2.upload).not.toHaveBeenCalled();
    });

    it('throws BadGatewayException when all available providers fail', async () => {
      const p1 = createMockProvider('primary', 'cloud-1', { usagePercent: 10 });
      const p2 = createMockProvider('secondary', 'cloud-2', { usagePercent: 20 });

      (p1.upload as jest.Mock).mockRejectedValue(new Error('Network timeout'));
      (p2.upload as jest.Mock).mockRejectedValue(new Error('Network timeout'));

      const router = new MediaProviderRouter([p1, p2], 'primary-only', 95);

      await expect(
        router.upload(dummyBuffer, dummyFolder, dummyPublicId),
      ).rejects.toThrow(BadGatewayException);
    });
  });
});
