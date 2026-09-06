/**
 * The ranking score (SPEC.md §4).
 *
 *   score = 0.30 * bayesian_rating
 *         + 0.20 * completion_rate
 *         + 0.15 * trial_to_paid_rate
 *         + 0.15 * availability_density_next_7d
 *         + 0.10 * response_speed
 *         + 0.10 * recency_of_activity
 *         + exploration_boost
 *
 * Pure, and computed nightly into `tutor_ranking` — never in the request path.
 *
 * Everything is in basis points (0-10000) rather than floats. The terms are
 * ratios, so this is not a money rule, but the same reasoning applies: integers
 * compare and sum exactly, and a stored score never drifts by a rounding error
 * between one nightly run and the next.
 */

import { reliabilityPenalty } from '@/lib/tutors/reliability';

/** Weights, in basis points, summing to 10000. */
export const WEIGHTS = {
  bayesianRating: 3_000,
  completionRate: 2_000,
  trialToPaid: 1_500,
  availabilityDensity: 1_500,
  responseSpeed: 1_000,
  recency: 1_000,
} as const;

/** Bayesian prior from SPEC.md §4: m = 4.3, C = 5. */
export const PRIOR_MEAN_MILLI = 4_300;
export const PRIOR_WEIGHT = 5;

/** A reply within this long counts as a perfect response-speed score. */
export const RESPONSE_SPEED_FLOOR_SECONDS = 15 * 60;
/** Beyond this, response speed scores zero. */
export const RESPONSE_SPEED_CEILING_SECONDS = 24 * 60 * 60;

/** Activity within this many days counts as fully recent. */
export const RECENCY_FULL_DAYS = 7;
/** Beyond this, recency scores zero. */
export const RECENCY_ZERO_DAYS = 90;

/** Exploration boost for new tutors (SPEC.md §4). */
export const EXPLORATION_MAX_BPS = 1_200;
/**
 * What a restriction costs in the feed.
 *
 * Fifteen percent of the score: enough that a restricted tutor drops below
 * comparable ones, small enough that a genuinely excellent tutor is still
 * findable by somebody looking for them. The number is a judgement, and it is
 * one number in one place so it can be argued about.
 */
export const RESTRICTION_PENALTY_BPS = 1_500;
export const EXPLORATION_DECAY_DAYS = 30;
export const EXPLORATION_DECAY_SESSIONS = 20;

/**
 * When availability is unknown — which it is until Phase 3 — its term is scored
 * at the neutral midpoint rather than zero.
 *
 * Zero would silently penalise every tutor by the full 15% weight and make the
 * other terms behave differently than they will once the engine exists. A
 * constant applied to everyone cancels out of the ordering entirely.
 */
export const AVAILABILITY_UNKNOWN_BPS = 5_000;

export type RankingInputs = {
  tutorId: string;
  /** Sum of all visible review ratings, 1-5 each. */
  ratingSum: number;
  reviewCount: number;
  /** Paid bookings that reached `settled`. */
  settledCount: number;
  /** Paid bookings that reached a terminal state at all. */
  terminalCount: number;
  /** Trials taken. */
  trialCount: number;
  /** Students who took a trial and later booked a paid session. */
  trialConvertedCount: number;
  /** Median first-reply time, or null when the tutor has never replied. */
  responseMedianSeconds: number | null;
  /** The most recent session or profile update, or null. */
  lastActiveAt: Date | null;
  /** When the tutor was verified, which is when they became discoverable. */
  verifiedAt: Date | null;
  /** From the availability port; unknown until Phase 3. */
  availabilityDensityBps: number | null;
  /**
   * Sessions this tutor did not attend (SPEC.md §2, §7).
   *
   * Costs more than any other single term here, deliberately: turning up is
   * the service, and a feed that ranked an absent tutor as if nothing had
   * happened would be selling something it cannot deliver.
   */
  strikes?: number;
  /**
   * Under a live restriction (`lib/moderation/sanctions.ts`).
   *
   * They stay in the feed, stay searchable, and stay bookable — a restriction
   * is a demotion, not a delisting. Delisting a tutor with regular students
   * does not stop them teaching those students; it only stops new ones finding
   * them here, which is a worse outcome for everybody including us.
   */
  restricted?: boolean;
};

export type RankingBreakdown = {
  tutorId: string;
  score: number;
  bayesianRatingMilli: number;
  bayesianRatingBps: number;
  completionRateBps: number;
  trialToPaidBps: number;
  availabilityDensityBps: number;
  responseSpeedBps: number;
  recencyBps: number;
  explorationBoost: number;
  reliabilityPenalty: number;
  restricted: boolean;
};

function clampBps(value: number): number {
  return Math.max(0, Math.min(10_000, Math.round(value)));
}

/**
 * `(C*m + Σratings) / (C + n)`, in thousandths of a star.
 *
 * Stops one 5★ review outranking a tutor with two hundred of them: a single
 * perfect review lands at 4417, while fifty of them reach 4936.
 */
export function bayesianRatingMilli(ratingSum: number, reviewCount: number): number {
  const numerator = PRIOR_WEIGHT * PRIOR_MEAN_MILLI + ratingSum * 1_000;
  const denominator = PRIOR_WEIGHT + reviewCount;
  return Math.round(numerator / denominator);
}

/** A 1-5 star rating, in thousandths, mapped onto 0-10000. */
export function ratingToBps(ratingMilli: number): number {
  return clampBps(((ratingMilli - 1_000) * 10_000) / 4_000);
}

/** Share of finished bookings that actually completed. */
export function completionRateBps(settledCount: number, terminalCount: number): number {
  if (terminalCount <= 0) return AVAILABILITY_UNKNOWN_BPS; // no history: neither credit nor blame
  return clampBps((settledCount * 10_000) / terminalCount);
}

/** Share of trials that turned into a paid booking. */
export function trialToPaidBps(trialConvertedCount: number, trialCount: number): number {
  if (trialCount <= 0) return AVAILABILITY_UNKNOWN_BPS;
  return clampBps((trialConvertedCount * 10_000) / trialCount);
}

/**
 * Fast replies score high; a day or more scores nothing.
 *
 * The decay is logarithmic, not linear. Linearly, the difference between
 * replying in 15 minutes and replying in an hour is under 4% of the term —
 * which is nonsense when the badge students actually look for is
 * "Responds in <1h". On a log curve an hour scores about 70% and six hours
 * about 30%, which is the shape of how it feels to wait.
 */
export function responseSpeedBps(medianSeconds: number | null): number {
  if (medianSeconds === null) return AVAILABILITY_UNKNOWN_BPS;
  if (medianSeconds <= RESPONSE_SPEED_FLOOR_SECONDS) return 10_000;
  if (medianSeconds >= RESPONSE_SPEED_CEILING_SECONDS) return 0;

  const decay =
    Math.log(medianSeconds / RESPONSE_SPEED_FLOOR_SECONDS) /
    Math.log(RESPONSE_SPEED_CEILING_SECONDS / RESPONSE_SPEED_FLOOR_SECONDS);

  return clampBps(10_000 * (1 - decay));
}

/** Active this week scores full; silent for three months scores nothing. */
export function recencyBps(lastActiveAt: Date | null, now: Date): number {
  if (!lastActiveAt) return 0;

  const days = (now.getTime() - lastActiveAt.getTime()) / 86_400_000;
  if (days <= RECENCY_FULL_DAYS) return 10_000;
  if (days >= RECENCY_ZERO_DAYS) return 0;

  const span = RECENCY_ZERO_DAYS - RECENCY_FULL_DAYS;
  return clampBps(((RECENCY_ZERO_DAYS - days) * 10_000) / span);
}

/**
 * The exploration slot, so new supply is not starved (SPEC.md §4).
 *
 * Decays on whichever runs out first: 30 days since verification, or 20
 * sessions. A tutor who books up quickly stops needing the help.
 */
export function explorationBoost(verifiedAt: Date | null, settledCount: number, now: Date): number {
  if (!verifiedAt) return 0;

  const days = (now.getTime() - verifiedAt.getTime()) / 86_400_000;
  if (days >= EXPLORATION_DECAY_DAYS || settledCount >= EXPLORATION_DECAY_SESSIONS) return 0;
  if (days < 0) return EXPLORATION_MAX_BPS;

  const byTime = 1 - days / EXPLORATION_DECAY_DAYS;
  const bySessions = 1 - settledCount / EXPLORATION_DECAY_SESSIONS;
  return Math.round(EXPLORATION_MAX_BPS * Math.min(byTime, bySessions));
}

/** The whole score, with every term kept so admin can see why. */
export function computeRanking(inputs: RankingInputs, now: Date): RankingBreakdown {
  const ratingMilli = bayesianRatingMilli(inputs.ratingSum, inputs.reviewCount);
  const rating = ratingToBps(ratingMilli);
  const completion = completionRateBps(inputs.settledCount, inputs.terminalCount);
  const trial = trialToPaidBps(inputs.trialConvertedCount, inputs.trialCount);
  const availability = inputs.availabilityDensityBps ?? AVAILABILITY_UNKNOWN_BPS;
  const response = responseSpeedBps(inputs.responseMedianSeconds);
  const recency = recencyBps(inputs.lastActiveAt, now);
  // A restricted tutor loses the new-tutor boost outright: it exists to give
  // somebody a chance, and this is the fortnight they are not being given one.
  const boost = inputs.restricted
    ? 0
    : explorationBoost(inputs.verifiedAt, inputs.settledCount, now);

  const weighted =
    rating * WEIGHTS.bayesianRating +
    completion * WEIGHTS.completionRate +
    trial * WEIGHTS.trialToPaid +
    clampBps(availability) * WEIGHTS.availabilityDensity +
    response * WEIGHTS.responseSpeed +
    recency * WEIGHTS.recency;

  const base = Math.round(weighted / 10_000) + boost - reliabilityPenalty(inputs.strikes ?? 0);

  return {
    tutorId: inputs.tutorId,
    // Weighted terms come back to 0-10000, then the boost is added on top and
    // a restriction, if there is one, is taken off the total.
    score: inputs.restricted
      ? Math.round((base * (10_000 - RESTRICTION_PENALTY_BPS)) / 10_000)
      : base,
    bayesianRatingMilli: ratingMilli,
    bayesianRatingBps: rating,
    completionRateBps: completion,
    trialToPaidBps: trial,
    availabilityDensityBps: clampBps(availability),
    responseSpeedBps: response,
    recencyBps: recency,
    explorationBoost: boost,
    reliabilityPenalty: reliabilityPenalty(inputs.strikes ?? 0),
    restricted: inputs.restricted === true,
  };
}
