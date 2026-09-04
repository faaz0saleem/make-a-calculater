/**
 * What the platform takes, and why it changes (SPEC.md §2, amended).
 *
 * The spec's original model was a rate stored per tutor — 20% by default, 15%
 * negotiated for early or high-volume tutors. That is not what we want the
 * commission to reward. This model is **retention-based**: a tutor pays 22% the
 * first time a student books them, and 16% every time after. Keeping a student
 * is worth more to us than acquiring one, and the pricing now says so.
 *
 * `tutor_profiles.commission_bps` is still read, as a **floor**: the effective
 * rate is the lower of the tutor's negotiated rate and the retention rate. A
 * rate negotiated during recruitment is a promise — "you will never pay more
 * than this" — and the retention discount stacks on top of it rather than
 * overriding it.
 *
 * The column is **null for a tutor who negotiated nothing**, which is most of
 * them. It used to default to 2000, and that stopped being harmless the moment
 * the first-booking rate rose past 20%: a floor of 2000 on every profile would
 * have silently capped everybody at the old rate and made the change a no-op.
 * Null means "no promise was made", which is what the column always meant.
 *
 * The rate is decided **once**, at creation, and snapshotted onto the booking.
 * A student's second booking being cheaper for the tutor cannot retroactively
 * change the first one, and neither can a later renegotiation.
 *
 * Pure, so the rule is one function with a test rather than a `case` inside a
 * transaction.
 */

import { applyCommission } from './pricing';

/** A student's first paid booking with this tutor. */
export const FIRST_BOOKING_COMMISSION_BPS = 2_200;
/** Every paid booking after that, with the same tutor. */
export const REBOOKING_COMMISSION_BPS = 1_600;

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
 * `negotiatedBps` is `tutor_profiles.commission_bps`, null for the tutors who
 * negotiated nothing. It can only ever help the tutor: one recruited on 12%
 * pays 12% on a first session and 12% on a rebooking, never 16% or 22%.
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

/**
 * What a tutor actually receives for a lesson at a given price.
 *
 * Both numbers, because a tutor's rate is one figure and their income is two:
 * a student's first lesson and every one after carry different commission. A
 * screen that shows only the headline rate is showing them a number they never
 * see in their bank account.
 *
 * It is also, deliberately, a discouragement. At the $5 floor a tutor receives
 * $3.90 for an hour, and reading that is a better argument against pricing
 * there than a rule forbidding it would be.
 */
export type TakeHome = {
  priceCents: number;
  firstBps: number;
  firstCents: number;
  rebookingBps: number;
  rebookingCents: number;
  /** True when a negotiated floor is what decides the rate. */
  negotiated: boolean;
};

export function takeHomeFor(priceCents: number, negotiatedBps?: number | null): TakeHome {
  const firstBps = commissionBpsFor(false, negotiatedBps);
  const rebookingBps = commissionBpsFor(true, negotiatedBps);

  return {
    priceCents,
    firstBps,
    firstCents: applyCommission(priceCents, firstBps).tutorCents,
    rebookingBps,
    rebookingCents: applyCommission(priceCents, rebookingBps).tutorCents,
    negotiated: firstBps === rebookingBps && firstBps !== FIRST_BOOKING_COMMISSION_BPS,
  };
}

/** For the tutor-facing explanation of what they will be charged. */
export function describeCommission(commissionBps: number): string {
  const percent = (commissionBps / 100).toFixed(0);

  if (commissionBps < REBOOKING_COMMISSION_BPS) return `${percent}% — your negotiated rate`;

  return commissionBps === REBOOKING_COMMISSION_BPS
    ? `${percent}% — the returning-student rate`
    : `${percent}% — this student's first session with you`;
}
