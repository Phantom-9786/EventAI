import { validateEnv } from './env.validation';

const validDevelopmentEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://eventai:local@localhost:5433/eventai',
  JWT_SECRET: 'development-test-secret-long-enough',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateEnv', () => {
  it('rejects unknown or missing runtime environments', () => {
    expect(() => validateEnv({ ...validDevelopmentEnv, NODE_ENV: 'prod' })).toThrow(
      'NODE_ENV must be development, test, or production',
    );
    const { NODE_ENV: _ignored, ...withoutNodeEnv } = validDevelopmentEnv;
    expect(() => validateEnv(withoutNodeEnv)).toThrow(
      'NODE_ENV must be development, test, or production',
    );
  });

  it('accepts a valid development configuration without production-only services', () => {
    expect(validateEnv(validDevelopmentEnv).NODE_ENV).toBe('development');
  });

  it('validates AI request bounds and model identifiers', () => {
    const configured = validateEnv({
      ...validDevelopmentEnv,
      AI_RATE_LIMIT_USER_PER_MINUTE: '12',
      AI_RATE_LIMIT_GLOBAL_PER_MINUTE: '200',
      AI_MAX_CONCURRENT_REQUESTS: '8',
      AI_REQUEST_TIMEOUT_MS: '45000',
      AI_MAX_OUTPUT_TOKENS: '700',
      GROQ_SIMPLE_MODEL: 'openai/gpt-oss-20b',
    });
    expect(configured.AI_RATE_LIMIT_USER_PER_MINUTE).toBe(12);
    expect(configured.AI_MAX_OUTPUT_TOKENS).toBe(700);
    expect(configured.GROQ_SIMPLE_MODEL).toBe('openai/gpt-oss-20b');
    expect(() => validateEnv({
      ...validDevelopmentEnv,
      AI_MAX_CONCURRENT_REQUESTS: '0',
    })).toThrow('AI_MAX_CONCURRENT_REQUESTS must be an integer between 1 and 10000');
  });

  it('rejects insecure production URLs, short signing secrets, and placeholders', () => {
    expect(() => validateEnv({
      ...validDevelopmentEnv,
      NODE_ENV: 'production',
      FRONTEND_URL: 'http://eventai.example',
      REDIS_URL: 'redis://localhost:6379',
      RAZORPAY_KEY_ID: 'rzp_test_xxxxxxxxxxxx',
      RAZORPAY_KEY_SECRET: 'xxxxxxxxxxxxxxxxxxxxxxxx',
      RAZORPAY_WEBHOOK_SECRET: 'xxxxxxxxxxxxxxxxxxxxxxxx',
    })).toThrow('Environment validation failed');
  });

  it('accepts valid production configuration with HTTPS origin and service URLs', () => {
    expect(validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://eventai:secret@db.example:5432/eventai',
      JWT_SECRET: 'production-signing-secret-with-over-32-chars',
      REDIS_URL: 'rediss://cache.example:6380',
      FRONTEND_URL: 'https://eventai.example',
      RAZORPAY_KEY_ID: 'test-payment-key-id',
      RAZORPAY_KEY_SECRET: 'valid-payment-secret-value',
      RAZORPAY_WEBHOOK_SECRET: 'valid-webhook-secret-value',
      BREVO_API_KEY: 'xkeysib-valid-key-material-1234567890',
      EMAIL_FROM: 'EventPoint <notifications@eventai.test>',
    }).NODE_ENV).toBe('production');
  });

  it('validates Cloudinary environment variables and fails on partial config', () => {
    expect(() => validateEnv({
      ...validDevelopmentEnv,
      CLOUDINARY_CLOUD_NAME: 'eventai-cloud',
    })).toThrow('CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET must all be set together');

    expect(() => validateEnv({
      ...validDevelopmentEnv,
      MEDIA_UPLOADS_ENABLED: 'invalid-switch',
    })).toThrow('MEDIA_UPLOADS_ENABLED must be true or false');

    expect(() => validateEnv({
      ...validDevelopmentEnv,
      MEDIA_MAX_FILE_SIZE_BYTES: '100', // too small (< 1024)
    })).toThrow('MEDIA_MAX_FILE_SIZE_BYTES must be an integer between 1024 and 52428800');

    expect(() => validateEnv({
      ...validDevelopmentEnv,
      CLOUDINARY_MAX_USAGE_PERCENT: '150', // > 100
    })).toThrow('CLOUDINARY_MAX_USAGE_PERCENT must be a number between 1 and 100');

    const validMedia = validateEnv({
      ...validDevelopmentEnv,
      CLOUDINARY_CLOUD_NAME: 'eventai-cloud',
      CLOUDINARY_API_KEY: '123456789012345',
      CLOUDINARY_API_SECRET: 'abcdefghijklmnopqrstuvwxyz123',
      CLOUDINARY_FOLDER: 'eventai/events',
      MEDIA_UPLOADS_ENABLED: 'true',
      MEDIA_MAX_FILE_SIZE_BYTES: '10485760',
      CLOUDINARY_MAX_USAGE_PERCENT: '90',
    });
    expect(validMedia.CLOUDINARY_CLOUD_NAME).toBe('eventai-cloud');
    expect(validMedia.MEDIA_MAX_FILE_SIZE_BYTES).toBe(10485760);
    expect(validMedia.CLOUDINARY_MAX_USAGE_PERCENT).toBe(90);
  });

  it('rejects placeholder Cloudinary credentials in production', () => {
    expect(() => validateEnv({
      ...validDevelopmentEnv,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://eventai:secret@db.example:5432/eventai',
      JWT_SECRET: 'production-signing-secret-with-over-32-chars',
      REDIS_URL: 'rediss://cache.example:6380',
      FRONTEND_URL: 'https://eventai.example',
      RAZORPAY_KEY_ID: 'test-payment-key-id',
      RAZORPAY_KEY_SECRET: 'valid-payment-secret-value',
      RAZORPAY_WEBHOOK_SECRET: 'valid-webhook-secret-value',
      BREVO_API_KEY: 'xkeysib-valid-key-material-1234567890',
      EMAIL_FROM: 'EventPoint <notifications@eventai.test>',
      CLOUDINARY_CLOUD_NAME: 'your-cloud-name',
      CLOUDINARY_API_KEY: '123456789012345',
      CLOUDINARY_API_SECRET: 'xxxxxxxxxxxxxxxxxxxxxxxx',
    })).toThrow('must not contain a placeholder value in production');
  });
});
