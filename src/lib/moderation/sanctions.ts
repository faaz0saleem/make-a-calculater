/**
 * The graduated response to somebody trying to take a relationship off Tutorly
 * (SPEC.md §8, §10).
 *
 * The shape of this ladder is a product decision, not a moderation convention,
 * and it is worth stating plainly because the obvious design is wrong.
 *
 * The obvious design is: detect a phone number, ban the account. It fails twice
 * over. It fails on precision — a maths tutor typing "question 15 on page 240"
 * or "x = 03" is indistinguishable to a regex from somebody passing a mobile
 * number, and being wrong once mid-lesson costs a lesson and a tutor's trust.
 * And it fails on strategy: banning a tutor who has fifteen regular students
 * does not stop those fifteen going to WhatsApp — it *sends* them, which is the
 * exact leak the platform exists to close.
 *
 * So the ladder is built around two rules.
 *
 *  1. **Nothing is automatic.** Every step below is issued by a person who has
 *     read the message. The scorer in `lib/messaging/contact-intent.ts` only
 *     decides what a person is shown.
 *  2. **No step takes a student away from a tutor.** A restriction removes new
 *     trial requests and ranking position — things that cost the tutor future
 *     business and cost their current students nothing. There is no rung that
 *     stops somebody teaching the people they already teach.
 *
 * And the honest part: determined evasion wins. Somebody who says "my name on
 * Instagram is my first name and my birth year" cannot be caught by any of
 * this. The ladder is for the ordinary case — a tutor who has not thought about
 * it — and the durable fix is the platform being worth staying on.
 */

export const SANCTION_LEVELS = ['warning', 'restriction', 'review'] as const;
export type SanctionLevel = (typeof SANCTION_LEVELS)[number];

/** How long a restriction lasts before it lifts on its own. */
export const RESTRICTION_DAYS = 30;

/**
 * What a restriction takes away.
 *
 * Both cost the tutor future work. Neither touches a booking, a message thread
 * or a student they already have — which is the point.
 */
export const RESTRICTED_PRIVILEGES = ['new_trial_requests', 'ranking_boost'] as const;
export type RestrictedPrivilege = (typeof RESTRICTED_PRIVILEGES)[number];

/**
 * The step after `priorConfirmed` confirmed attempts.
 *
 * Confirmed means an admin looked and agreed. A flag nobody has reviewed counts
 * for nothing, which is why the ladder cannot advance on its own.
 */
export function nextSanctionLevel(priorConfirmed: number): SanctionLevel {
  if (priorConfirmed <= 0) return 'warning';
  if (priorConfirmed === 1) return 'restriction';
  return 'review';
}

export type SanctionCopy = {
  /** What the admin's button says. */
  action: string;
  /** The heading the person sees. */
  title: string;
  /** What actually happens to them, in their words. */
  consequence: string;
  /** What the admin is told they are about to do, before they do it. */
  adminWarning: string;
};

export const SANCTION_COPY: Record<SanctionLevel, SanctionCopy> = {
  warning: {
    action: 'Send a warning',
    title: 'A warning about contact details',
    consequence:
      'Nothing changes about your account. You need to read this and confirm you have, and that is all — but a second confirmed attempt limits new students.',
    adminWarning:
      'They keep every student and every booking. They will be asked to acknowledge this before they can carry on messaging.',
  },
  restriction: {
    action: 'Restrict new students',
    title: 'Limits on new students',
    consequence: `For ${RESTRICTION_DAYS} days you will not receive new trial requests and you will not be boosted in search. Your current students, bookings and messages are untouched.`,
    adminWarning: `For ${RESTRICTION_DAYS} days: no new trial requests, no ranking boost. Existing students, bookings and threads are deliberately untouched — taking those away would push them off the platform, which is the thing we are trying to prevent.`,
  },
  review: {
    action: 'Send to human review',
    title: 'Your account is being reviewed',
    consequence:
      'Someone is reading the whole history, not just the last message. You can teach normally while they do. You can add anything you want them to know below.',
    adminWarning:
      'This does not suspend anybody. It puts the account in front of a person to decide, and they can still teach in the meantime.',
  },
};

/** Warnings are permanent record; restrictions expire. */
export function restrictionEndsAt(now: Date, days = RESTRICTION_DAYS): Date | null {
  return new Date(now.getTime() + days * 86_400_000);
}

export type SanctionLike = {
  level: SanctionLevel | string;
  restrictedUntil: Date | null;
  status: string;
};

/**
 * Is this person under a live restriction right now?
 *
 * A lifted one does not count, and neither does an expired one — the row stays
 * for the record, but the restriction is over.
 */
export function isRestricted(sanctions: readonly SanctionLike[], now = new Date()): boolean {
  return sanctions.some(
    (sanction) =>
      sanction.level === 'restriction' &&
      sanction.status !== 'lifted' &&
      sanction.restrictedUntil !== null &&
      sanction.restrictedUntil.getTime() > now.getTime(),
  );
}

/** A warning that has been issued and not yet read. Blocks nothing; asks once. */
export function unacknowledgedWarning<T extends { level: SanctionLevel | string; acknowledgedAt: Date | null }>(
  sanctions: readonly T[],
): T | null {
  return sanctions.find((sanction) => sanction.acknowledgedAt === null) ?? null;
}
