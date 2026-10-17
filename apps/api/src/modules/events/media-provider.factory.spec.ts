import { MediaProviderFactory, LEGACY_PROVIDER_ID } from './media-provider.factory';

describe('MediaProviderFactory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CLOUDINARY_PROVIDERS;
    delete process.env.CLOUDINARY_PRIMARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_PRIMARY_API_KEY;
    delete process.env.CLOUDINARY_PRIMARY_API_SECRET;
    delete process.env.CLOUDINARY_SECONDARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_SECONDARY_API_KEY;
    delete process.env.CLOUDINARY_SECONDARY_API_SECRET;
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('parseProviderList', () => {
    it('splits comma-separated identifiers and trims whitespace', () => {
      expect(MediaProviderFactory.parseProviderList('primary, secondary, backup')).toEqual([
        'primary',
        'secondary',
        'backup',
      ]);
    });

    it('returns empty array when input is undefined or empty', () => {
      expect(MediaProviderFactory.parseProviderList(undefined)).toEqual([]);
      expect(MediaProviderFactory.parseProviderList('')).toEqual([]);
      expect(MediaProviderFactory.parseProviderList('   ')).toEqual([]);
    });
  });

  describe('createProviders', () => {
    it('creates multiple providers from configured multi-provider environment variables', () => {
      process.env.CLOUDINARY_PROVIDERS = 'primary,secondary';
      process.env.CLOUDINARY_PRIMARY_CLOUD_NAME = 'bawrmf0r';
      process.env.CLOUDINARY_PRIMARY_API_KEY = 'key-primary';
      process.env.CLOUDINARY_PRIMARY_API_SECRET = 'sec-primary';

      process.env.CLOUDINARY_SECONDARY_CLOUD_NAME = 'hy5dkfmo';
      process.env.CLOUDINARY_SECONDARY_API_KEY = 'key-secondary';
      process.env.CLOUDINARY_SECONDARY_API_SECRET = 'sec-secondary';

      const providers = MediaProviderFactory.createProviders();

      expect(providers).toHaveLength(2);
      expect(providers[0].id).toBe('primary');
      expect(providers[0].cloudName).toBe('bawrmf0r');
      expect(providers[1].id).toBe('secondary');
      expect(providers[1].cloudName).toBe('hy5dkfmo');
    });

    it('creates all three independent providers when bawrmf0r, hy5dkfmo, and vdugsome are listed', () => {
      process.env.CLOUDINARY_PROVIDERS = 'bawrmf0r,hy5dkfmo,vdugsome';
      process.env.CLOUDINARY_BAWRMF0R_CLOUD_NAME = 'bawrmf0r';
      process.env.CLOUDINARY_BAWRMF0R_API_KEY = 'k-bawr';
      process.env.CLOUDINARY_BAWRMF0R_API_SECRET = 's-bawr';

      process.env.CLOUDINARY_HY5DKFMO_CLOUD_NAME = 'hy5dkfmo';
      process.env.CLOUDINARY_HY5DKFMO_API_KEY = 'k-hy5d';
      process.env.CLOUDINARY_HY5DKFMO_API_SECRET = 's-hy5d';

      process.env.CLOUDINARY_VDUGSOME_CLOUD_NAME = 'vdugsome';
      process.env.CLOUDINARY_VDUGSOME_API_KEY = 'k-vdug';
      process.env.CLOUDINARY_VDUGSOME_API_SECRET = 's-vdug';

      const providers = MediaProviderFactory.createProviders();

      expect(providers).toHaveLength(3);
      expect(providers.map((p) => p.id)).toEqual(['bawrmf0r', 'hy5dkfmo', 'vdugsome']);
      expect(providers.map((p) => p.cloudName)).toEqual(['bawrmf0r', 'hy5dkfmo', 'vdugsome']);
      expect(providers.every((p) => p.isConfigured())).toBe(true);
    });

    it('falls back to single legacy provider if CLOUDINARY_PROVIDERS is not specified', () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'bawrmf0r';
      process.env.CLOUDINARY_API_KEY = 'key-legacy';
      process.env.CLOUDINARY_API_SECRET = 'sec-legacy';

      const providers = MediaProviderFactory.createProviders();

      expect(providers).toHaveLength(1);
      expect(providers[0].id).toBe(LEGACY_PROVIDER_ID);
      expect(providers[0].cloudName).toBe('bawrmf0r');
    });

    it('falls back to PRIMARY credentials if CLOUDINARY_PROVIDERS is not specified', () => {
      process.env.CLOUDINARY_PRIMARY_CLOUD_NAME = 'bawrmf0r';
      process.env.CLOUDINARY_PRIMARY_API_KEY = 'k-primary';
      process.env.CLOUDINARY_PRIMARY_API_SECRET = 's-primary';

      const providers = MediaProviderFactory.createProviders();

      expect(providers).toHaveLength(1);
      expect(providers[0].id).toBe('primary');
      expect(providers[0].cloudName).toBe('bawrmf0r');
    });

    it('falls back to CLOUDINARY_URL connection string if present', () => {
      process.env.CLOUDINARY_URL = 'cloudinary://my_key:my_secret@my_cloud';

      const providers = MediaProviderFactory.createProviders();

      expect(providers).toHaveLength(1);
      expect(providers[0].id).toBe('default');
      expect(providers[0].cloudName).toBe('my_cloud');
    });

    it('returns empty list if neither multi-provider nor legacy credentials are set', () => {
      const providers = MediaProviderFactory.createProviders();
      expect(providers).toEqual([]);
    });
  });

  describe('findProviderByCloudName', () => {
    it('matches provider by cloud name case-insensitively', () => {
      process.env.CLOUDINARY_PROVIDERS = 'primary,secondary';
      process.env.CLOUDINARY_PRIMARY_CLOUD_NAME = 'bawrmf0r';
      process.env.CLOUDINARY_PRIMARY_API_KEY = 'k1';
      process.env.CLOUDINARY_PRIMARY_API_SECRET = 's1';
      process.env.CLOUDINARY_SECONDARY_CLOUD_NAME = 'hy5dkfmo';
      process.env.CLOUDINARY_SECONDARY_API_KEY = 'k2';
      process.env.CLOUDINARY_SECONDARY_API_SECRET = 's2';

      const providers = MediaProviderFactory.createProviders();
      const found = MediaProviderFactory.findProviderByCloudName(providers, 'BAWRMF0R');

      expect(found).toBeDefined();
      expect(found?.id).toBe('primary');
    });
  });
});
