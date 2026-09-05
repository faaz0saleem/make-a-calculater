/**
 * Who may review, and what a rating adds up to (SPEC.md §9).
 *
 * Pure. The rules are small but they decide what a tutor's public number is, so
 * they are written down in one place rather than implied by a query.
 *
 * The displayed rating is the same Bayesian average the ranking score uses —
 * imported from `@/lib/ranking/score` rather than re-derived, so the number on
 * the profile and the number in the feed ordering can never disagree.
 */

import { PRIOR_MEAN_MILLI, PRIOR_WEIGHT, bayesianRatingMilli } from '@/lib/ranking/score';

export { PRIOR_MEAN_MILLI, PRIOR_WEIGHT, bayesianRatingMilli };

/** How long a student may keep editing what they wrote (SPEC.md §9). */
export const REVIEW_EDIT_WINDOW_DAYS = 7;

export const MIN_RATING = 1;
export const MAX_RATING = 5;
/** Long enough to say something useful, short enough to stay a review. */
export const MAX_REVIEW_CHARS = 2_000;
export const MAX_REPLY_CHARS = 1_000;

export type ReviewableBooking = {
  studentId: string;
  isTrial: boolean;
  priceCents: number;
  /** Stamped when the session actually happened. Null means it did not. */
  completedAt: Date | null;
};

export type ReviewProblem =
  | 'not_your_session'
  | 'trial'
  | 'not_completed'
  | 'already_reviewed'
  | 'edit_window_closed'
  | 'bad_rating';

const MESSAGES: Record<ReviewProblem, string> = {
  not_your_session: 'You can only review a session you took.',
  trial: 'Free trials cannot be reviewed. Book a full session first.',
  not_completed: 'You can review this once the session has happened.',
  already_reviewed: 'You have already reviewed this session.',
  edit_window_closed: `Reviews can be edited for ${REVIEW_EDIT_WINDOW_DAYS} days. This one is now fixed.`,
  bad_rating: `A rating is a whole number of stars from ${MIN_RATING} to ${MAX_RATING}.`,
};

export function reviewProblemMessage(problem: ReviewProblem): string {
  return MESSAGES[problem];
}

/** Whether this booking can carry a review at all, whoever is asking. */
export function isReviewable(booking: ReviewableBooking): boolean {
  return !booking.isTrial && booking.priceCents > 0 && booking.completedAt !== null;
}

/**
 * Whether this student may write a first review for this booking.
 *
 * A paid session that happened, reviewed once, by the person who took it.
 */
export function canWriteReview(
  booking: ReviewableBooking,
  viewerId: string,
  hasExistingReview: boolean,
): ReviewProblem | null {
  if (booking.studentId !== viewerId) return 'not_your_session';
  if (booking.isTrial) return 'trial';
  if (!isReviewable(booking)) return 'not_completed';
  if (hasExistingReview) return 'already_reviewed';
  return null;
}

/** Whether an existing review may still be changed. */
export function canEditReview(review: { studentId: string; createdAt: Date }, viewerId: string, now: Date) {
  if (review.studentId !== viewerId) return 'not_your_session' as const;
  if (!withinEditWindow(review.createdAt, now)) return 'edit_window_closed' as const;
  return null;
}

export function withinEditWindow(createdAt: Date, now: Date): boolean {
  const days = (now.getTime() - createdAt.getTime()) / 86_400_000;
  return days >= 0 && days < REVIEW_EDIT_WINDOW_DAYS;
}

export function editWindowClosesAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + REVIEW_EDIT_WINDOW_DAYS * 86_400_000);
}

/** A rating is a whole number of stars. */
export function isValidRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= MIN_RATING && rating <= MAX_RATING;
}

// ---------------------------------------------------------------------------
// What a tutor's rating adds up to
// ---------------------------------------------------------------------------

export type RatingDistribution = Record<1 | 2 | 3 | 4 | 5, number>;

export const EMPTY_DISTRIBUTION: RatingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

export type RatingSummary = {
  count: number;
  /** The plain mean, in thousandths. Null with no reviews at all. */
  rawMilli: number | null;
  /** What is displayed: the Bayesian average, in thousandths. */
  displayedMilli: number;
  distribution: RatingDistribution;
  /** Each star's share of the total, 0-100, for the breakdown bar. */
  sharePercent: RatingDistribution;
};

export function summariseRatings(distribution: RatingDistribution): RatingSummary {
  const stars = [1, 2, 3, 4, 5] as const;
  const count = stars.reduce((total, star) => total + distribution[star], 0);
  const sum = stars.reduce((total, star) => total + star * distribution[star], 0);

  const sharePercent = { ...EMPTY_DISTRIBUTION };
  for (const star of stars) {
    sharePercent[star] = count === 0 ? 0 : Math.round((distribution[star] * 100) / count);
  }

  return {
    count,
    rawMilli: count === 0 ? null : Math.round((sum * 1_000) / count),
    displayedMilli: bayesianRatingMilli(sum, count),
    distribution,
    sharePercent,
  };
}

/** "4.6" from 4_617. One decimal is all a star rating can honestly carry. */
export function formatStars(milli: number): string {
  return (Math.round(milli / 100) / 10).toFixed(1);
}
