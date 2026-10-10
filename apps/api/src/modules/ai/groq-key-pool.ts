/**
 * Rotation pool for Groq API keys.
 *
 * Keys come exclusively from environment variables (GROQ_API_KEYS as a
 * comma-separated list, falling back to GROQ_API_KEY) — never from the
 * database, logs, or source control. The pool never exposes key values;
 * callers only pass opaque key handles in and out.
 *
 * Rotation semantics:
 *  - 401/403 (invalid or revoked credential): the key is put on a long
 *    cooldown and the next key is tried — different credentials are
 *    different quotas, so rotating is legitimate.
 *  - 429 (rate limit): the key is cooled down for the server-advised
 *    Retry-After (capped). Callers must NOT rotate on 429: keys of one
 *    organization share a quota, and rotating would just shift the same
 *    429 onto the next key.
 *  - Everything else: the pool is not involved.
 */
export const GROQ_AUTH_COOLDOWN_MS = 30 * 60_000;
export const GROQ_RATE_LIMIT_COOLDOWN_CAP_MS = 60_000;
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

export class GroqKeyPool {
  private readonly keys: string[];
  private readonly cooldownUntil = new Map<string, number>();

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
    return this.keys.find((k) => (this.cooldownUntil.get(k) ?? 0) <= now) ?? null;
  }

  markAuthFailed(key: string): void {
    this.cooldownUntil.set(key, Date.now() + GROQ_AUTH_COOLDOWN_MS);
  }

  markRateLimited(key: string, cooldownMs: number): void {
    const capped = Math.max(0, Math.min(cooldownMs, GROQ_RATE_LIMIT_COOLDOWN_CAP_MS));
    this.cooldownUntil.set(key, Date.now() + capped);
  }

  /** Milliseconds until the next key becomes available, or null if one is free now. */
  get availableInMs(): number | null {
    if (this.pick() !== null) return null;
    const now = Date.now();
    const soonest = Math.min(
      ...this.keys.map((k) => this.cooldownUntil.get(k) ?? 0),
    );
    return Math.max(soonest - now, 0);
  }
}
