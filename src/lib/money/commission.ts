/**
 * What the platform takes, and why it changes (SPEC.md §2, amended).
 *
 * The spec's original model was a rate stored per tutor — 20% by default, 15%
 * negotiated for early or high-volume tutors. That is not what we want the
 * commission to reward. This model is **retention-based**: a tutor pays 20% the
 * first time a student books them, and 15% every time after. Keeping a student
 * is worth more to us than acquiring one, and the pricing now says so.
 *
 * `tutor_profiles.commission_bps` is still read, as a **floor**: the effective
 * rate is the lower of the tutor's negotiated rate and the retention rate. A
 * rate negotiated during recruitment is a promise — "you will never pay more
 * than this" — and the retention discount stacks on top of it rather than
 * overriding it. At the default of 2000 the floor never binds, so it costs
 * nothing for the tutors who never negotiated anything.
 *
 * The rate is decided **once**, at creation, and snapshotted onto the booking.
 * A student's second booking being cheaper for the tutor cannot retroactively
 * change the first one, and neither can a later renegotiation.
 *
 * Pure, so the rule is one function with a test rather than a `case` inside a
 * transaction.
 */

/** A student's first paid booking with this tutor. */
export const FIRST_BOOKING_COMMISSION_BPS = 2_000;
/** Every paid booking after that, with the same tutor. */
export const REBOOKING_COMMISSION_BPS = 1_500;

/**
 * The rate for a booking about to be created.
 *
 * `hasCompletedPaidSession` means exactly that: a paid session between these
 * two that actually happened (`bookings.completed_at is not null`). A free
 * trial does not count, and neither does a paid session that is booked but has
 * not happened yet — so a student booking two sessions in one sitting pays the
 * first-booking rate on both, and the tutor earns the retention rate from the
 * third onwards.
 *
 * `negotiatedBps` is `tutor_profiles.commission_bps`, and it can only ever help
 * the tutor: a tutor recruited on 12% pays 12% on a first session and 12% on a
 * rebooking, never 15% or 20%.
 */
export function commissionBpsFor(
  hasCompletedPaidSession: boolean,
  negotiatedBps?: number | null,
): number {
  const retention = hasCompletedPaidSession ? REBOOKING_COMMISSION_BPS : FIRST_BOOKING_COMMISSION_BPS;

  if (negotiatedBps === null || negotiatedBps === undefined) return retention;
  if (!Number.isInteger(negotiatedBps) || negotiatedBps < 0) return retention;

  return Math.min(negotiatedBps, retention);
}

/** For the tutor-facing explanation of what they will be charged. */
export function describeCommission(commissionBps: number): string {
  const percent = (commissionBps / 100).toFixed(0);

  if (commissionBps < REBOOKING_COMMISSION_BPS) return `${percent}% — your negotiated rate`;

  return commissionBps === REBOOKING_COMMISSION_BPS
    ? `${percent}% — the returning-student rate`
    : `${percent}% — this student's first session with you`;
}
