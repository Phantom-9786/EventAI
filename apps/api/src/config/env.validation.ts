// ═══════════════════════════════════════════════════
// Environment variable validation (fail fast on boot)
// ═══════════════════════════════════════════════════

export interface EnvConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  FRONTEND_URL: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRY: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  GROK_API_KEY?: string;
  GROK_MODEL?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const errors: string[] = [];

  const required = ['DATABASE_URL', 'JWT_SECRET'] as const;
  for (const key of required) {
    if (!config[key] || String(config[key]).trim() === '') {
      errors.push(`Missing required environment variable: ${key}`);
    }
  }

  if (typeof config.JWT_SECRET === 'string' && config.JWT_SECRET.length < 16) {
    errors.push('JWT_SECRET must be at least 16 characters');
  }

  if (config.JWT_SECRET === 'change-this-to-a-long-random-secret') {
    errors.push('JWT_SECRET is still the placeholder value — set a real secret');
  }

  const port = Number(config.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`PORT must be an integer between 1 and 65535, got: ${config.PORT}`);
  }

  if (config.NODE_ENV === 'production') {
    for (const key of [
      'FRONTEND_URL',
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
    ] as const) {
      if (!config[key] || String(config[key]).trim() === '') {
        errors.push(`Missing required environment variable in production: ${key}`);
      }
    }
    if (typeof config.FRONTEND_URL === 'string' && !config.FRONTEND_URL.startsWith('https://')) {
      errors.push('FRONTEND_URL must be an https:// origin in production');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n  - ${errors.join('\n  - ')}`);
  }

  return config as unknown as EnvConfig;
}
