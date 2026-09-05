import { beforeEach, describe, expect, it } from 'vitest';
import { clientIp, rateLimit, RATE_LIMITS, resetRateLimits } from './rate-limit';

beforeEach(() => resetRateLimits());

describe('rateLimit', () => {
  it('allows exactly the configured number of requests', () => {
    const rule = { limit: 3, windowMs: 1_000 };
    expect(rateLimit('a', rule, 0).ok).toBe(true);
    expect(rateLimit('a', rule, 0).ok).toBe(true);
    expect(rateLimit('a', rule, 0).ok).toBe(true);
    expect(rateLimit('a', rule, 0).ok).toBe(false);
  });

  it('counts each key separately', () => {
    const rule = { limit: 1, windowMs: 1_000 };
    expect(rateLimit('a', rule, 0).ok).toBe(true);
    expect(rateLimit('b', rule, 0).ok).toBe(true);
    expect(rateLimit('a', rule, 0).ok).toBe(false);
  });

  it('opens a fresh window once the old one expires', () => {
    const rule = { limit: 1, windowMs: 1_000 };
    expect(rateLimit('a', rule, 0).ok).toBe(true);
    expect(rateLimit('a', rule, 999).ok).toBe(false);
    expect(rateLimit('a', rule, 1_000).ok).toBe(true);
  });

  it('reports what is left and when it resets', () => {
    const result = rateLimit('a', { limit: 5, windowMs: 60_000 }, 1_000);
    expect(result.remaining).toBe(4);
    expect(result.resetAt).toBe(61_000);
  });

  it('never reports negative headroom', () => {
    const rule = { limit: 1, windowMs: 1_000 };
    rateLimit('a', rule, 0);
    rateLimit('a', rule, 0);
    expect(rateLimit('a', rule, 0).remaining).toBe(0);
  });

  it('uses the limits from the spec', () => {
    expect(RATE_LIMITS.auth).toEqual({ limit: 5, windowMs: 60_000 });
    expect(RATE_LIMITS.bookingCreate).toEqual({ limit: 10, windowMs: 3_600_000 });
    expect(RATE_LIMITS.message).toEqual({ limit: 30, windowMs: 60_000 });
  });
});

describe('clientIp', () => {
  it('takes the first hop of x-forwarded-for', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip, then to a shared bucket', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});
