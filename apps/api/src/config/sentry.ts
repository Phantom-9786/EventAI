import * as Sentry from '@sentry/node';

/**
 * Optional Sentry error monitoring for the API.
 *
 * Everything here degrades gracefully: without a real SENTRY_DSN the SDK is
 * never initialized, no events are sent, and the app behaves exactly as
 * before. The structured logger and X-Request-Id correlation are untouched —
 * the request ID is attached to Sentry events so the two views line up.
 */

/** Placeholder DSNs must not initialize the SDK. */
export function isSentryConfigured(dsn: string | undefined): boolean {
  return !!dsn && /^https:\/\/[^@]+@[^/]+\/[^/]+$/.test(dsn) && !dsn.includes('xxxx');
}

type Json = Record<string, unknown>;

const SENSITIVE_KEY = /(authorization|cookie|password|passwd|secret|token|api[-_]?key|razorpay|card|cvv|cvc|otp|pin|signature|ticket[-_]?code|qr[-_]?data|holder[-_]?name|email|phone|mobile|first[-_]?name|last[-_]?name)/i;
const SECRET_ASSIGNMENT = /\b(authorization|cookie|password|passwd|secret|token|api[-_]?key|razorpay[-_]?\w+|signature|ticket[-_]?code|email|phone|mobile)\s*[:=]\s*([^\s,;]+)/gi;

function redactText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [Filtered]')
    .replace(SECRET_ASSIGNMENT, '$1=[Filtered]')
    .replace(/\b(?:sk|gsk|rzp)_(?:live|test)_[A-Za-z0-9_-]+/gi, '[Filtered]');
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[Truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'string') return redactText(value);
  if (value && typeof value === 'object') {
    const out: Json = {};
    for (const [k, v] of Object.entries(value as Json)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[Filtered]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Defensive scrubbing before any event leaves the process:
 * - never sends auth/cookie headers, passwords, tokens, payment fields
 * - strips query strings (they can carry reset tokens / OAuth params)
 * - attaches the request ID so events correlate with the structured logs
 */
export function scrubSentryEvent(
  event: Sentry.ErrorEvent,
  hint?: Sentry.EventHint,
): Sentry.ErrorEvent | null {
  const request = event.request;
  if (request) {
    if (request.url) {
      try {
        const url = new URL(request.url);
        url.search = '';
        url.hash = '';
        request.url = url.toString();
      } catch {
        request.url = request.url.split(/[?#]/, 1)[0];
      }
    }
    if (request.query_string !== undefined) delete request.query_string;
    if (request.cookies !== undefined) delete request.cookies;
    if (request.headers) {
      const headers = { ...request.headers } as Record<string, unknown>;
      for (const key of Object.keys(headers)) {
        if (SENSITIVE_KEY.test(key)) delete headers[key];
      }
      request.headers = headers as typeof request.headers;
    }
    if (request.data) request.data = redact(request.data);
  }
  if (event.message) event.message = redactText(event.message);
  if (event.exception?.values) {
    for (const value of event.exception.values) {
      if (value.value) value.value = redactText(value.value);
      for (const frame of value.stacktrace?.frames ?? []) {
        if (frame.vars) frame.vars = redact(frame.vars) as typeof frame.vars;
      }
    }
  }
  if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = redact(event.contexts) as typeof event.contexts;
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = redactText(crumb.message);
    if (crumb.data) crumb.data = redact(crumb.data) as typeof crumb.data;
  }
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
  }
  if (event.tags) {
    const tags: Record<string, string> = {};
    for (const [key, value] of Object.entries(event.tags)) {
      if (typeof value === 'string' && !SENSITIVE_KEY.test(key)) tags[key] = value;
    }
    event.tags = tags;
  }

  const response = (hint as { response?: { req?: { headers?: Record<string, unknown> } } })
    ?.response?.req;
  if (response?.headers) {
    for (const key of Object.keys(response.headers)) {
      if (SENSITIVE_KEY.test(key)) delete response.headers[key];
    }
  }

  const requestId =
    ((request?.headers as Json | undefined)?.['x-request-id'] as string | undefined) ??
    (hint as { requestId?: string } | undefined)?.requestId;
  if (requestId && !event.tags?.request_id) {
    event.tags = { ...event.tags, request_id: requestId };
  }

  return event;
}

/** Initializes Sentry when a real DSN is configured; otherwise does nothing. */
export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  const dsn = env.SENTRY_DSN;
  if (!isSentryConfigured(dsn)) return false;

  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT ?? (env.NODE_ENV === 'production' ? 'production' : 'development'),
    release: env.SENTRY_RELEASE,
    // No PII beyond what the scrubbed event already contains (v11 default).
    tracesSampleRate: Number(env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    beforeSend: scrubSentryEvent,
  });
  return true;
}
