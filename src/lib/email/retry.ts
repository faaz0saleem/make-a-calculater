/**
 * When to try again, and when to stop (SPEC.md §11).
 *
 * Pure, so the schedule can be read and argued with without a database. The
 * shape is exponential with a cap: a provider having a bad minute should not
 * cost a reminder its usefulness, and a provider having a bad day should not
 * have us hammering it for a week.
 *
 * The last attempt matters more than the total. A T-1h reminder retried for six
 * hours is not a reminder any more, so the queue drops anything whose moment
 * has passed rather than sending yesterday's news — `expiresAt` on the row is
 * what says so, and it is set by whoever enqueued it.
 */

/** How many times a retryable failure is tried before the row is dead. */
export const MAX_EMAIL_ATTEMPTS = 5;

/** Backoff between attempts, in seconds. Index is the attempt just completed. */
export const EMAIL_BACKOFF_SECONDS = [60, 300, 900, 3_600] as const;

/**
 * When the next attempt is due, or null when there should not be one.
 *
 * Jitter is deliberate and small: a provider outage means every queued row
 * comes due at once, and a thundering herd against a service that has just
 * come back is how you get rate-limited into a second outage.
 */
export function nextAttemptAt(
  attempts: number,
  now: Date,
  jitter: () => number = Math.random,
): Date | null {
  if (attempts >= MAX_EMAIL_ATTEMPTS) return null;

  const index = Math.min(attempts - 1, EMAIL_BACKOFF_SECONDS.length - 1);
  const base = EMAIL_BACKOFF_SECONDS[Math.max(0, index)]!;
  const spread = Math.floor(base * 0.2 * jitter());

  return new Date(now.getTime() + (base + spread) * 1_000);
}

/** True when this failure has used up its attempts and belongs in dead letters. */
export function isDead(attempts: number): boolean {
  return attempts >= MAX_EMAIL_ATTEMPTS;
}
