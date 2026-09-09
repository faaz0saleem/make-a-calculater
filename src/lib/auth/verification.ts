/**
 * Where a confirmed email address is actually required (SPEC.md §1).
 *
 * The decision, made deliberately: **verification nudges, it does not gate.**
 * An unverified person browses, books, pays for a lesson with credits they
 * already have, and teaches. Signing up is not where a wrong address costs
 * anybody anything.
 *
 * It costs somebody something in exactly two places, and both of them are
 * money leaving or entering the system for the first time:
 *
 *   - **A tutor's payout.** The address is where the receipt goes and where
 *     support would write if the bank details looked wrong. Paying out against
 *     an address nobody has ever proved is how the wrong person gets told the
 *     money is on its way.
 *   - **A purchase above $25.** Small purchases are how somebody tries the
 *     product; the threshold is where a mistaken address stops being an
 *     inconvenience and starts being a chargeback with no way to reach the
 *     buyer.
 *
 * Both gates are pure functions so the rule is one line in a test rather than
 * a condition buried in a form handler. The server enforces them in
 * `startPurchase` and `requestPayout`; the screens read the same functions so
 * nobody is told "yes" and then refused.
 */

/** Above this, a purchase needs a confirmed address. Inclusive: $25 is fine. */
export const VERIFIED_PURCHASE_THRESHOLD_CENTS = 2_500;

export type Gate =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Buying credits.
 *
 * Compared with `>`, not `>=`: a $25 pack is allowed. The threshold is the
 * largest purchase somebody may make on an unproven address, not the smallest
 * one they may not.
 */
export function purchaseGate(paidCents: number, emailVerified: boolean): Gate {
  if (emailVerified) return { allowed: true };
  if (paidCents <= VERIFIED_PURCHASE_THRESHOLD_CENTS) return { allowed: true };

  return {
    allowed: false,
    reason:
      'Confirm your email address before a purchase this size. We sent you a link when you signed up, and you can ask for another from your email settings.',
  };
}

/**
 * Asking to be paid.
 *
 * Every payout, not only the first — though in practice only the first can be
 * refused, because a tutor cannot reach a second one without having passed
 * this. Written as a plain check rather than "have they been paid before" so
 * there is no state to get wrong.
 */
export function payoutGate(emailVerified: boolean): Gate {
  if (emailVerified) return { allowed: true };

  return {
    allowed: false,
    reason:
      'Confirm your email address before your first payout. It is where the receipt goes, and where we would write if anything looked wrong with your bank details.',
  };
}

// ---------------------------------------------------------------------------
// The nudge
// ---------------------------------------------------------------------------

/** Set when somebody dismisses the banner. Per browser, and it expires. */
export const VERIFY_BANNER_COOKIE = 'tutorly_verify_dismissed';

/**
 * How long a dismissal lasts.
 *
 * A week, not forever. This banner is the only warning between a tutor and a
 * payout request that will be refused, so it has to come back — but coming back
 * the next morning would make it noise, and noise is how people learn to click
 * past the thing that mattered.
 */
export const VERIFY_BANNER_SNOOZE_DAYS = 7;
