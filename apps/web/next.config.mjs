import { withSentryConfig } from '@sentry/nextjs/config';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@eventai/types', '@eventai/validation'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

/**
 * Sentry wraps the config to inject the sentry.*.config.ts init files and
 * (optionally) upload source maps. Without SENTRY_AUTH_TOKEN no upload is
 * attempted; without a DSN the SDKs never initialize at runtime.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Only upload source maps when an auth token is present (i.e. CI/prod).
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  silent: true,
  disableLogger: true,
});
