import { GroqKeyPool, parseRetryAfterMs } from './groq-key-pool';

describe('GroqKeyPool', () => {
  it('filters empty, placeholder, and duplicate keys', () => {
    const pool = new GroqKeyPool([
      '',
      'gsk_xxxxxxxxxxxxxxxxxxxxxxxx',
      'short',
      'gsk-real-key-aaaaaaaaaaaaaaaa',
      'gsk-real-key-aaaaaaaaaaaaaaaa',
      'gsk-real-key-bbbbbbbbbbbbbbbb',
    ]);
    expect(pool.size).toBe(2);
  });

  it('picks keys in order and rotates after auth failure', () => {
    const pool = new GroqKeyPool(['key-aaaaaaaaaaaaaaaaaa', 'key-bbbbbbbbbbbbbbbbbb']);
    expect(pool.pick()).toBe('key-aaaaaaaaaaaaaaaaaa');
    pool.markAuthFailed('key-aaaaaaaaaaaaaaaaaa');
    expect(pool.pick()).toBe('key-bbbbbbbbbbbbbbbbbb');
  });

  it('reports all keys unavailable and time to recovery', () => {
    const pool = new GroqKeyPool(['key-aaaaaaaaaaaaaaaaaa']);
    pool.markRateLimited('key-aaaaaaaaaaaaaaaaaa', 10_000);
    expect(pool.pick()).toBeNull();
    const wait = pool.availableInMs ?? -1;
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(10_000);
  });

  it('recovers keys after their cooldown expires', () => {
    jest.useFakeTimers();
    try {
      const pool = new GroqKeyPool(['key-aaaaaaaaaaaaaaaaaa']);
      pool.markAuthFailed('key-aaaaaaaaaaaaaaaaaa');
      expect(pool.pick()).toBeNull();
      jest.advanceTimersByTime(31 * 60_000);
      expect(pool.pick()).toBe('key-aaaaaaaaaaaaaaaaaa');
    } finally {
      jest.useRealTimers();
    }
  });

  it('caps rate-limit cooldowns', () => {
    jest.useFakeTimers();
    try {
      const pool = new GroqKeyPool(['key-aaaaaaaaaaaaaaaaaa']);
      pool.markRateLimited('key-aaaaaaaaaaaaaaaaaa', 10 * 60_000);
      jest.advanceTimersByTime(61_000);
      expect(pool.pick()).toBe('key-aaaaaaaaaaaaaaaaaa');
    } finally {
      jest.useRealTimers();
    }
  });

  it('parses Retry-After headers (seconds, HTTP-date, garbage) with a cap', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000);
    expect(parseRetryAfterMs('3600')).toBe(60_000);
    expect(parseRetryAfterMs(null)).toBe(5_000);
    expect(parseRetryAfterMs('soon')).toBe(5_000);
    jest.useFakeTimers().setSystemTime(new Date('2026-10-10T00:00:00Z'));
    try {
      expect(parseRetryAfterMs('Sat, 10 Oct 2026 00:00:10 GMT')).toBe(10_000);
    } finally {
      jest.useRealTimers();
    }
  });
});
