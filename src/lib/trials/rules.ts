/**
 * The rules a free trial has to obey (SPEC.md §6).
 *
 * Pure. Trials are the cheapest thing in the product to abuse — they cost a
 * student nothing and cost a tutor a slot — so the guards are gathered in one
 * place where they can be read and tested, rather than spread across an action.
 *
 * The one rule that is *not* here is "one trial per student-tutor pair, for
 * life". That is a partial unique index on `(student_id, tutor_id) where
 * is_trial` (`one_trial_per_pair` in the schema) and it stays there: a check in
 * application code loses the race between two clicks, and a unique index does
 * not.
 */

/** The lengths a tutor may offer (SPEC.md §6). */
export const TRIAL_LENGTH_OPTIONS = [10, 15, 20] as const;
export type TrialLength = (typeof TRIAL_LENGTH_OPTIONS)[number];

/** A request the tutor never answers dies this long after it was made. */
export const TRIAL_RESPONSE_WINDOW_HOURS = 12;
/** ...or this long before the slot starts, whichever comes first. */
export const TRIAL_CUTOFF_MINUTES_BEFORE_START = 120;

/** How many unanswered requests one student may have out at a time. */
export const MAX_OUTSTANDING_TRIAL_REQUESTS = 3;
/** How many trials one student may take in a week, across all tutors. */
export const MAX_TRIALS_PER_STUDENT_PER_WEEK = 5;
/** The window "per week" means, in days. */
export const TRIAL_WEEK_DAYS = 7;

/** A trial holds the tutor's calendar for its own length plus this (SPEC.md §6). */
export const TRIAL_BUFFER_MINUTES = 5;

const HOUR_MS = 60 * 60_000;
const MINUTE_MS = 60_000;

/**
 * When a pending request stops being answerable.
 *
 * Twelve hours after it was made, or two hours before the slot starts —
 * whichever comes first, which for a request made the night before a morning
 * slot is the second one.
 */
export function trialExpiresAt(requestedAt: Date, startAtUtc: Date): Date {
  const byResponseWindow = requestedAt.getTime() + TRIAL_RESPONSE_WINDOW_HOURS * HOUR_MS;
  const byStart = startAtUtc.getTime() - TRIAL_CUTOFF_MINUTES_BEFORE_START * MINUTE_MS;
  return new Date(Math.min(byResponseWindow, byStart));
}

/**
 * Whether a pending request has run out of time.
 *
 * Checked wherever a request is read, not by a sweeper: a job that runs every
 * five minutes leaves a five-minute window in which a tutor can accept
 * something that should already be dead.
 */
export function isTrialRequestExpired(
  request: { requestedAt: Date; startAtUtc: Date },
  now: Date,
): boolean {
  return now.getTime() >= trialExpiresAt(request.requestedAt, request.startAtUtc).getTime();
}

/** Seconds left to answer, floored at zero. */
export function trialSecondsRemaining(
  request: { requestedAt: Date; startAtUtc: Date },
  now: Date,
): number {
  const expiry = trialExpiresAt(request.requestedAt, request.startAtUtc).getTime();
  return Math.max(0, Math.round((expiry - now.getTime()) / 1_000));
}

export type TrialRequestProblem =
  | 'not_offered'
  | 'own_profile'
  | 'already_used'
  | 'too_many_outstanding'
  | 'too_many_this_week'
  | 'tutor_full_this_week'
  | 'too_late'
  | 'not_verified'
  | 'tutor_restricted';

export type TrialRequestFacts = {
  /** The tutor's own settings. */
  offersTrial: boolean;
  verified: boolean;
  maxTrialsPerWeek: number;
  /**
   * The tutor is under a live restriction (see `lib/moderation/sanctions.ts`).
   *
   * This is the *only* thing a restriction stops. Their existing students book,
   * message and attend exactly as before — taking those away would push the
   * relationship off the platform, which is the behaviour the restriction is a
   * response to in the first place.
   */
  tutorRestricted: boolean;
  /** Who is asking. */
  isSelf: boolean;
  /** This pair has had a trial before, ever. */
  pairHasTrial: boolean;
  /** The student's unanswered requests, across all tutors. */
  outstandingRequests: number;
  /** Trials this student has taken or requested in the last seven days. */
  trialsThisWeek: number;
  /** Trials this tutor has given in the last seven days. */
  tutorTrialsThisWeek: number;
  /** The slot being asked for. */
  startAtUtc: Date;
};

const MESSAGES: Record<TrialRequestProblem, string> = {
  not_offered: 'This tutor does not offer a free trial.',
  own_profile: 'You cannot book a trial with yourself.',
  already_used: 'You have already had your free trial with this tutor. Book a full session instead.',
  too_many_outstanding: `You already have ${MAX_OUTSTANDING_TRIAL_REQUESTS} trial requests waiting for an answer. Wait for one of them before asking for another.`,
  too_many_this_week: `Free trials are limited to ${MAX_TRIALS_PER_STUDENT_PER_WEEK} a week. Try again in a few days.`,
  tutor_full_this_week: 'This tutor has given out all of their free trials for this week.',
  too_late: `A trial has to be requested more than ${TRIAL_CUTOFF_MINUTES_BEFORE_START / 60} hours before it starts, so the tutor has time to answer.`,
  not_verified: 'This tutor has not completed verification yet.',
  tutor_restricted: 'This tutor is not taking new trial requests at the moment. You can still book a paid session with them.',
};

export function trialProblemMessage(problem: TrialRequestProblem): string {
  return MESSAGES[problem];
}

/**
 * The first reason this request cannot go ahead, or null.
 *
 * Order matters only in that the most useful thing to say comes first: being
 * told "you have already had your trial with this tutor" is more helpful than
 * "you have three requests outstanding" when both are true.
 */
export function trialRequestProblem(facts: TrialRequestFacts, now: Date): TrialRequestProblem | null {
  if (facts.isSelf) return 'own_profile';
  if (!facts.verified) return 'not_verified';
  if (!facts.offersTrial) return 'not_offered';
  if (facts.tutorRestricted) return 'tutor_restricted';
  if (facts.pairHasTrial) return 'already_used';

  // A request that would already be expired the moment it was made.
  if (facts.startAtUtc.getTime() - now.getTime() <= TRIAL_CUTOFF_MINUTES_BEFORE_START * MINUTE_MS) {
    return 'too_late';
  }

  if (facts.outstandingRequests >= MAX_OUTSTANDING_TRIAL_REQUESTS) return 'too_many_outstanding';
  if (facts.trialsThisWeek >= MAX_TRIALS_PER_STUDENT_PER_WEEK) return 'too_many_this_week';
  if (facts.tutorTrialsThisWeek >= facts.maxTrialsPerWeek) return 'tutor_full_this_week';

  return null;
}

/** The start of the rolling week the two per-week guards count over. */
export function weekWindowStart(now: Date): Date {
  return new Date(now.getTime() - TRIAL_WEEK_DAYS * 24 * HOUR_MS);
}
