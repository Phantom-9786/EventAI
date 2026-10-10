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
  const SENSITIVE_KEY = /(authorization|cookie|password|passwd|secret|token|api[-_]?key|razorpay|card|cvv|cvc|otp|pin|signature|ticket[-_]?code|qr[-_]?data|holder[-_]?name|email|phone|mobile|first[-_]?name|last[-_]?name)/i;
  const redactText = (value: string) => value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [Filtered]')
    .replace(/\b(authorization|cookie|password|passwd|secret|token|api[-_]?key|razorpay[-_]?\w+|signature|ticket[-_]?code|email|phone|mobile)\s*[:=]\s*([^\s,;]+)/gi, '$1=[Filtered]')
    .replace(/\b(?:sk|gsk|rzp)_(?:live|test)_[A-Za-z0-9_-]+/gi, '[Filtered]');

  const redact = (value: unknown, depth = 0): unknown => {
    if (depth > 6) return '[Truncated]';
    if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
    if (typeof value === 'string') return redactText(value);
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
    if (event.request.url) {
      try {
        const url = new URL(event.request.url);
        url.search = '';
        url.hash = '';
        event.request.url = url.toString();
      } catch {
        event.request.url = event.request.url.split(/[?#]/, 1)[0];
      }
    }
    if (event.request.query_string !== undefined) delete event.request.query_string;
    if (event.request.cookies !== undefined) delete event.request.cookies;
    if (event.request.headers) {
      const headers = { ...event.request.headers } as Record<string, unknown>;
      for (const key of Object.keys(headers)) if (SENSITIVE_KEY.test(key)) delete headers[key];
      event.request.headers = headers as typeof event.request.headers;
    }
    if (event.request.data) event.request.data = redact(event.request.data);
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
