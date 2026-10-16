import { BadGatewayException, ServiceUnavailableException } from '../../common/exceptions';
import axios from 'axios';
import { CloudinaryMediaProvider } from './cloudinary-media.provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CloudinaryMediaProvider', () => {
  const config = {
    id: 'primary',
    cloudName: 'test-cloud',
    apiKey: 'key123',
    apiSecret: 'secretABC',
  };

  let provider: CloudinaryMediaProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = CloudinaryMediaProvider.create(config);
  });

  describe('configuration & properties', () => {
    it('initializes with provided configuration', () => {
      expect(provider.id).toBe('primary');
      expect(provider.cloudName).toBe('test-cloud');
      expect(provider.isConfigured()).toBe(true);
    });

    it('reports false when credentials are empty', () => {
      const empty = CloudinaryMediaProvider.create({
        id: 'empty',
        cloudName: '',
        apiKey: '',
        apiSecret: '',
      });
      expect(empty.isConfigured()).toBe(false);
    });
  });

  describe('health and usage checks', () => {
    it('retrieves and calculates usage percent correctly', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          credits: { usage: 25, limit: 100, percent_used: 25 },
        },
      } as any);

      const usage = await provider.getUsagePercent();
      expect(usage).toBe(25);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.cloudinary.com/v1_1/test-cloud/usage',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
          }),
        }),
      );
    });

    it('caches usage percent to avoid excessive API requests within TTL', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          credits: { percent_used: 30 },
        },
      } as any);

      const usage1 = await provider.getUsagePercent();
      const usage2 = await provider.getUsagePercent();

      expect(usage1).toBe(30);
      expect(usage2).toBe(30);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('reports healthy = true when usage check succeeds', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          credits: { percent_used: 40 },
        },
      } as any);

      const health = await provider.checkHealth();
      expect(health.healthy).toBe(true);
      expect(health.usagePercent).toBe(40);
    });

    it('reports healthy = false when usage endpoint fails', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Connection timeout'));

      const health = await provider.checkHealth();
      expect(health.healthy).toBe(false);
      expect(health.usagePercent).toBeNull();
      expect(health.error).toBe('Connection timeout');
    });
  });

  describe('upload', () => {
    const dummyBuffer = Buffer.from('image bytes content');
    const folder = 'eventai/events';
    const publicId = 'event-12345';

    it('successfully uploads file and returns UploadResult', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/eventai/events/event-12345.png',
          public_id: 'eventai/events/event-12345',
        },
      } as any);

      const result = await provider.upload(dummyBuffer, folder, publicId);

      expect(result.url).toBe(
        'https://res.cloudinary.com/test-cloud/image/upload/v1/eventai/events/event-12345.png',
      );
      expect(result.publicId).toBe('eventai/events/event-12345');
      expect(result.providerId).toBe('primary');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.cloudinary.com/v1_1/test-cloud/image/upload',
        expect.anything(),
        expect.objectContaining({
          timeout: 30_000,
        }),
      );
    });

    it('maps 401/403 authentication failures to ServiceUnavailableException', async () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 401,
          data: { error: { message: 'Invalid API key or secret' } },
        },
      };
      (mockedAxios.isAxiosError as unknown as jest.Mock) = jest.fn().mockReturnValue(true);
      mockedAxios.post.mockRejectedValueOnce(axiosError);

      await expect(provider.upload(dummyBuffer, folder, publicId)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('maps server errors to BadGatewayException without exposing internal details', async () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 500,
          data: { error: { message: 'Internal Cloudinary Error with secret-data-123' } },
        },
      };
      (mockedAxios.isAxiosError as unknown as jest.Mock) = jest.fn().mockReturnValue(true);
      mockedAxios.post.mockRejectedValueOnce(axiosError);

      await expect(provider.upload(dummyBuffer, folder, publicId)).rejects.toThrow(
        BadGatewayException,
      );
      await expect(provider.upload(dummyBuffer, folder, publicId)).rejects.not.toThrow(
        'secret-data-123',
      );
    });
  });

  describe('destroy', () => {
    it('sends destroy request to Cloudinary API with signed payload', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { result: 'ok' },
      } as any);

      await provider.destroy('eventai/events/event-12345');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.cloudinary.com/v1_1/test-cloud/image/destroy',
        expect.anything(),
        expect.objectContaining({
          timeout: 10_000,
        }),
      );
    });

    it('does not throw when destroy fails, logging warning gracefully', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Cloudinary destroy 404: Not found'));

      await expect(
        provider.destroy('eventai/events/non-existent'),
      ).resolves.toBeUndefined();
    });
  });
});
