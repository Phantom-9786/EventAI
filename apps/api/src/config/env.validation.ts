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
  GROQ_API_KEY?: string;
  GROQ_API_KEYS?: string;
  GROQ_MODEL?: string;
  GROQ_SIMPLE_MODEL?: string;
  GROQ_MODERATE_MODEL?: string;
  GROQ_COMPLEX_MODEL?: string;
  AI_RATE_LIMIT_USER_PER_MINUTE?: number;
  AI_RATE_LIMIT_GLOBAL_PER_MINUTE?: number;
  AI_MAX_CONCURRENT_REQUESTS?: number;
  AI_REQUEST_TIMEOUT_MS?: number;
  AI_MAX_OUTPUT_TOKENS?: number;
  // Sentry (optional — error monitoring stays disabled without a DSN)
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string;
  // Google OAuth 2.0 (optional — sign-in with Google is feature-gated)
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_CALLBACK_URL?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const errors: string[] = [];

  const nodeEnv = config.NODE_ENV;
  if (!['development', 'test', 'production'].includes(String(nodeEnv))) {
    errors.push('NODE_ENV must be development, test, or production');
  }

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

  if (config.SENTRY_TRACES_SAMPLE_RATE !== undefined) {
    const sampleRate = Number(config.SENTRY_TRACES_SAMPLE_RATE);
    if (
      String(config.SENTRY_TRACES_SAMPLE_RATE).trim() === '' ||
      !Number.isFinite(sampleRate) ||
      sampleRate < 0 ||
      sampleRate > 1
    ) {
      errors.push('SENTRY_TRACES_SAMPLE_RATE must be a number between 0 and 1');
    }
  }

  const port = Number(config.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT must be an integer between 1 and 65535');
  }

  const numericRanges: Record<string, [number, number]> = {
    AI_RATE_LIMIT_USER_PER_MINUTE: [1, 1000],
    AI_RATE_LIMIT_GLOBAL_PER_MINUTE: [1, 100_000],
    AI_MAX_CONCURRENT_REQUESTS: [1, 10_000],
    AI_REQUEST_TIMEOUT_MS: [1000, 120_000],
    AI_MAX_OUTPUT_TOKENS: [64, 4096],
  };
  for (const [key, [min, max]] of Object.entries(numericRanges)) {
    if (config[key] === undefined) continue;
    const value = Number(config[key]);
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push(`${key} must be an integer between ${min} and ${max}`);
    } else {
      config[key] = value;
    }
  }
  for (const key of [
    'GROQ_MODEL',
    'GROQ_SIMPLE_MODEL',
    'GROQ_MODERATE_MODEL',
    'GROQ_COMPLEX_MODEL',
  ]) {
    const model = config[key];
    if (model !== undefined && (typeof model !== 'string' || !/^[a-z0-9][a-z0-9._/-]{1,127}$/i.test(model.trim()))) {
      errors.push(`${key} must be a valid Groq model ID`);
    }
  }

  if (config.NODE_ENV === 'production') {
    for (const key of [
      'FRONTEND_URL',
      'REDIS_URL',
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
      'BREVO_API_KEY',
      'EMAIL_FROM',
    ] as const) {
      if (!config[key] || String(config[key]).trim() === '') {
        errors.push(`Missing required environment variable in production: ${key}`);
      }
    }

    if (typeof config.JWT_SECRET === 'string' && config.JWT_SECRET.length < 32) {
      errors.push('JWT_SECRET must be at least 32 characters in production');
    }

    if (typeof config.FRONTEND_URL === 'string') {
      try {
        const url = new URL(config.FRONTEND_URL);
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          (url.pathname !== '/' && url.pathname !== '') ||
          url.search ||
          url.hash
        ) {
          errors.push('FRONTEND_URL must be an https:// origin in production');
        }
      } catch {
        errors.push('FRONTEND_URL must be a valid https:// origin in production');
      }
    }

    for (const key of ['DATABASE_URL', 'REDIS_URL'] as const) {
      const value = config[key];
      if (typeof value !== 'string') continue;
      try {
        const url = new URL(value);
        const validProtocol = key === 'DATABASE_URL'
          ? ['postgres:', 'postgresql:'].includes(url.protocol)
          : ['redis:', 'rediss:'].includes(url.protocol);
        if (!validProtocol || !url.hostname) {
          errors.push(`${key} must be a valid ${key === 'DATABASE_URL' ? 'PostgreSQL' : 'Redis'} URL in production`);
        }
      } catch {
        errors.push(`${key} must be a valid ${key === 'DATABASE_URL' ? 'PostgreSQL' : 'Redis'} URL in production`);
      }
    }

    for (const key of [
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
      'BREVO_API_KEY',
    ] as const) {
      const value = String(config[key] ?? '');
      if (/x{6,}|placeholder|change[-_ ]?me|your[-_ ]?(key|secret)|example/i.test(value)) {
        errors.push(`${key} must not contain a placeholder value in production`);
      }
    }

    if (typeof config.EMAIL_FROM === 'string') {
      const email = config.EMAIL_FROM.match(/<([^>]+)>/)?.[1] ?? config.EMAIL_FROM;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /your[-_ ]?domain|example\./i.test(email)) {
        errors.push('EMAIL_FROM must be a valid, non-placeholder sender address in production');
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n  - ${errors.join('\n  - ')}`);
  }

  return config as unknown as EnvConfig;
}
