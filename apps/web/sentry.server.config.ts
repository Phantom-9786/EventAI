import * as Sentry from '@sentry/nextjs';
import { scrubWebEvent, webEnvironment } from './src/lib/sentry-scrub';

// Server (Node.js) monitoring for the Next.js app. Loaded automatically by
// withSentryConfig. Disabled gracefully without a DSN.
if (process.env.NEXT_PUBLIC_SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN.includes('xxxx')) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: webEnvironment(),
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    beforeSend: scrubWebEvent,
  });
}
