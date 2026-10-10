import * as Sentry from '@sentry/nextjs';

/**
 * Defensive scrubbing shared by the web app's Sentry init files.
 * Strips query strings (reset tokens, OAuth params arrive in URLs) and
 * redacts obviously sensitive keys before anything leaves the browser/server.
 */
export function scrubWebEvent(
  event: Sentry.ErrorEvent,
  _hint?: Sentry.EventHint,
): Sentry.ErrorEvent | null {
  const SENSITIVE_KEY = /(authorization|cookie|password|passwd|secret|token|api[-_]?key|card|cvv|cvc|otp|pin)/i;

  const redact = (value: unknown, depth = 0): unknown => {
    if (depth > 6) return '[Truncated]';
    if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = SENSITIVE_KEY.test(k) ? '[Filtered]' : redact(v, depth + 1);
      }
      return out;
    }
    return value;
  };

  if (event.request) {
    if (event.request.query_string !== undefined) delete event.request.query_string;
    if (event.request.cookies !== undefined) delete event.request.cookies;
    if (event.request.data) event.request.data = redact(event.request.data);
  }
  if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>;

  // Never send stored access tokens.
  if (typeof window !== 'undefined' && event.user?.other) {
    event.user.other = redact(event.user.other) as Record<string, unknown>;
  }

  return event;
}

export function webEnvironment(): string {
  return (
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    process.env.SENTRY_ENVIRONMENT ??
    (process.env.NODE_ENV === 'production' ? 'production' : 'development')
  );
}
