/**
 * What happens when a tutor does not turn up (SPEC.md §2, §7).
 *
 * Escalating, and each rung costs the tutor something the previous one did not:
 *
 *  1. **The session is refunded.** Immediate, automatic, and not a punishment —
 *     the student simply did not get what they paid for.
 *  2. **A ranking penalty.** From the first strike. Reliability is most of what
 *     a student is buying, and a feed that ranked an unreliable tutor as if
 *     nothing had happened would be selling something it cannot deliver.
 *  3. **No more instant booking.** After two. Their sessions stop confirming
 *     themselves and start needing an answer, so nobody's credits sit held
 *     against an hour that tutor has not agreed to be at.
 *
 * What is deliberately *not* on the ladder is removal. A tutor with two strikes
 * and forty good sessions is somebody having a bad month, and the students they
 * already teach would lose their tutor over it. Suspension exists, it is an
 * admin decision, and it is made by a person looking at the whole record.
 */

/** Strikes before a tutor's bookings stop confirming themselves. */
export const STRIKES_BEFORE_MANUAL_ACCEPT = 2;

/** Where a strike stops mattering to the feed. Beyond this the penalty is flat. */
export const STRIKES_AT_FULL_PENALTY = 3;

/**
 * The most reliability can cost in the feed.
 *
 * Fifteen hundred points — larger than the timezone-overlap term (1200) and far
 * larger than the gap between a 4.6 and a 4.9 (~225). That ordering is the
 * point: a tutor who does not turn up should fall below a slightly worse-rated
 * tutor who does, because turning up is the service.
 */
export const RELIABILITY_MAX_PENALTY = 1_500;

/** Graduated, so the first strike is a warning shot and the third is the floor. */
export function reliabilityPenalty(strikes: number): number {
  if (strikes <= 0) return 0;
  const capped = Math.min(strikes, STRIKES_AT_FULL_PENALTY);
  return Math.round((capped * RELIABILITY_MAX_PENALTY) / STRIKES_AT_FULL_PENALTY);
}

/** Whether this tutor's paid bookings still confirm on the spot. */
export function hasInstantBooking(strikes: number): boolean {
  return strikes < STRIKES_BEFORE_MANUAL_ACCEPT;
}

/** What the tutor is told, on their own dashboard, in their own terms. */
export function reliabilityNotice(strikes: number): string | null {
  if (strikes <= 0) return null;

  if (!hasInstantBooking(strikes)) {
    return `${strikes} sessions you did not attend. New bookings now wait for you to accept them instead of confirming straight away, and you are ranked lower until this clears. Turning up to your next sessions is what fixes it.`;
  }

  return `One session you did not attend. It has been refunded and you are ranked slightly lower. A second one means new bookings stop confirming automatically.`;
}
