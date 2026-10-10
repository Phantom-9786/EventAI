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
      EMAIL_FROM: 'EventAI <notifications@eventai.test>',
    }).NODE_ENV).toBe('production');
  });
});
