/**
 * Rotation pool for Groq API keys.
 *
 * Keys come exclusively from environment variables (GROQ_API_KEYS as a
 * comma-separated list, falling back to GROQ_API_KEY) — never from the
 * database, logs, or source control. The pool never exposes key values;
 * callers only pass opaque key handles in and out.
 *
 * Rotation semantics:
 *  - 401/403 (invalid or revoked credential): the credential is put on a
 *    long cooldown and another configured credential may be tried.
 *  - 429 (rate limit): the complete configured pool is cooled down for the
 *    server-advised Retry-After (capped). Callers must NOT rotate because
 *    configured credentials are conservatively treated as one shared quota.
 *  - Everything else: the pool is not involved.
 */
export const GROQ_AUTH_COOLDOWN_MS = 30 * 60_000;
export const GROQ_RATE_LIMIT_COOLDOWN_CAP_MS = 15 * 60_000;
export const GROQ_RATE_LIMIT_DEFAULT_COOLDOWN_MS = 5_000;

export function parseRetryAfterMs(headerValue: string | null): number {
  if (headerValue) {
    const seconds = Number(headerValue);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, GROQ_RATE_LIMIT_COOLDOWN_CAP_MS);
    }
    const date = Date.parse(headerValue);
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(date - Date.now(), 0), GROQ_RATE_LIMIT_COOLDOWN_CAP_MS);
    }
  }
  return GROQ_RATE_LIMIT_DEFAULT_COOLDOWN_MS;
}

export function parseRateLimitResetMs(headers: Headers): number {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) return parseRetryAfterMs(retryAfter);
  const resets = [
    headers.get('x-ratelimit-reset-tokens'),
    headers.get('x-ratelimit-reset-requests'),
  ].map(parseDurationMs).filter((value): value is number => value !== null);
  return Math.min(
    Math.max(...resets, GROQ_RATE_LIMIT_DEFAULT_COOLDOWN_MS),
    GROQ_RATE_LIMIT_COOLDOWN_CAP_MS,
  );
}

function parseDurationMs(value: string | null): number | null {
  if (!value) return null;
  const numericSeconds = Number(value);
  if (Number.isFinite(numericSeconds)) return Math.max(0, numericSeconds * 1000);
  const matches = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/gi)];
  if (matches.length === 0) return null;
  const units: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  return matches.reduce((total, match) => total + Number(match[1]) * units[match[2].toLowerCase()], 0);
}

export class GroqKeyPool {
  private readonly keys: string[];
  private readonly cooldownUntil = new Map<string, number>();
  private sharedRateLimitUntil = 0;

  constructor(rawKeys: string[]) {
    // Drop empties, obvious placeholders (gsk_xxxx…), and implausibly short
    // values so a half-edited .env never produces doomed requests.
    this.keys = [
      ...new Set(
        rawKeys
          .map((k) => k.trim())
          .filter((k) => k.length >= 20 && !/^gsk_x{4,}$/i.test(k)),
      ),
    ];
  }

  get size(): number {
    return this.keys.length;
  }

  /** First key not on cooldown, or null when every key is unavailable. */
  pick(): string | null {
    const now = Date.now();
    if (this.sharedRateLimitUntil > now) return null;
    return this.keys.find((k) => (this.cooldownUntil.get(k) ?? 0) <= now) ?? null;
  }

  markAuthFailed(key: string, cooldownMs = GROQ_AUTH_COOLDOWN_MS): void {
    this.cooldownUntil.set(key, Date.now() + Math.max(1, cooldownMs));
  }

  markRateLimited(_key: string, cooldownMs: number): void {
    const capped = Math.max(0, Math.min(cooldownMs, GROQ_RATE_LIMIT_COOLDOWN_CAP_MS));
    this.sharedRateLimitUntil = Date.now() + capped;
  }

  /** Milliseconds until the next key becomes available, or null if one is free now. */
  get availableInMs(): number | null {
    if (this.pick() !== null) return null;
    const now = Date.now();
    if (this.sharedRateLimitUntil > now) return this.sharedRateLimitUntil - now;
    const soonest = Math.min(
      ...this.keys.map((k) => this.cooldownUntil.get(k) ?? 0),
    );
    return Math.max(soonest - now, 0);
  }
}
