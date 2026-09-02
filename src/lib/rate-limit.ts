/**
 * Fixed-window rate limiting (SPEC.md §13.6).
 *
 * In-memory, so the counters are per server instance. That is genuinely useful
 * on a single node and in development, and it is the wrong shape for a fleet of
 * serverless functions — swap the store for Upstash Redis before the traffic
 * arrives (see DECISIONS_NEEDED.md). The interface does not change.
 */

export type RateLimitResult = {
  ok: boolean;
  /** Requests still allowed in this window. */
  remaining: number;
  /** When the window resets, as an epoch millisecond timestamp. */
  resetAt: number;
};

export type RateLimitRule = {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
};

/** The limits SPEC.md §13.6 names. */
export const RATE_LIMITS = {
  auth: { limit: 5, windowMs: 60_000 },
  bookingCreate: { limit: 10, windowMs: 60 * 60_000 },
  message: { limit: 30, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/** Drops expired windows so a long-lived process does not grow without bound. */
function sweep(now: number): void {
  if (windows.size < 10_000) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export function rateLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
  sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + rule.windowMs;
    windows.set(key, { count: 1, resetAt });
    return { ok: true, remaining: rule.limit - 1, resetAt };
  }

  existing.count += 1;
  const remaining = rule.limit - existing.count;
  return { ok: remaining >= 0, remaining: Math.max(remaining, 0), resetAt: existing.resetAt };
}

/** Only for tests. */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * Best-effort client IP. Behind Vercel the first `x-forwarded-for` hop is the
 * client; the fallback groups unknown callers together, which is deliberately
 * strict rather than deliberately permissive.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const [first] = forwarded.split(',');
    if (first?.trim()) return first.trim();
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
