/**
 * How a curriculum-matched feed is ordered.
 *
 * The rule, in one line: **an exact curriculum match outweighs a rating.** A
 * 4.6 tutor who teaches the student's exact board, class and subject ranks
 * above a 4.9 who does not, and no other term is allowed to overturn that. So
 * the match tier is a separate, leading key rather than another weighted term —
 * a weight can always be out-argued by a big enough rating gap, a key cannot.
 *
 * Below the tier, the ordering is the nightly score plus the timezone-overlap
 * bonus. That bonus can move a tutor by up to 1200 points, which is more than
 * the roughly 225 points between a 4.6 and a 4.9. Being awake when the student
 * is awake matters more than three tenths of a star; teaching their syllabus
 * matters more than either.
 *
 * Below that again sits the chapter tiebreak, and it is deliberately the
 * smallest term here — see `TOPIC_MAX_BPS`.
 *
 * `src/db/discovery.ts` builds the same ordering in SQL. This module is the
 * readable statement of it, and what the tests check.
 */

import { overlapBonusBps } from '@/lib/ranking/overlap';
import { MATCH_TIERS, type MatchTier } from './match';

/**
 * The most a chapter match can move a tutor.
 *
 * Two hundred points, and the number is chosen against a specific comparison:
 * the gap between a 4.6 and a 4.9 tutor is roughly 225 points, so a chapter
 * match **cannot** overturn three tenths of a star. It orders tutors who are
 * otherwise alike, which is what a tiebreak is for.
 *
 * It applies inside the exact-match tier and nowhere else. A tutor who has
 * ticked "Electrolysis" but teaches a different board does not climb past one
 * who teaches the student's actual syllabus, however many boxes they tick —
 * that is what "never a new tier" means.
 */
export const TOPIC_MAX_BPS = 200;

/** Graduated: half the chapters declared earns half the bonus. */
export function topicBonusBps(matched: number, requested: number): number {
  if (requested <= 0 || matched <= 0) return 0;
  return Math.round((Math.min(matched, requested) * TOPIC_MAX_BPS) / requested);
}

export type FeedOrderInputs = {
  /** 0-3, from `./match.ts`. Zero when the viewer declared no curriculum. */
  tier: MatchTier;
  /** How many of the chapters the viewer is asking about this tutor declares. */
  topicMatches?: number;
  /** The nightly ranking score, or null for a tutor not scored yet. */
  score: number | null;
  /** The tutor's free-hours mask from the nightly job. */
  freeHoursMask: number;
  /** Tie-break, so the order is total and paging is stable. */
  name: string;
  tutorId: string;
};

/**
 * The score a tutor is ordered by inside their tier.
 *
 * A tutor with no `tutor_ranking` row — verified since the last nightly run —
 * sorts last rather than first, which is what `nulls last` does in SQL.
 */
export function adjustedScore(score: number | null, freeHoursMask: number, viewerMask: number): number {
  if (score === null) return -1;
  return score + overlapBonusBps(freeHoursMask, viewerMask);
}

/**
 * Order two tutors for one viewer. Returns the usual negative/zero/positive.
 *
 * Total: two tutors identical on every term still order by name and then id, so
 * a second page never repeats or skips somebody.
 */
export function compareForViewer(
  a: FeedOrderInputs,
  b: FeedOrderInputs,
  viewerMask: number,
  /** How many chapters the viewer asked about. Zero means no tiebreak at all. */
  requestedTopics = 0,
): number {
  if (a.tier !== b.tier) return b.tier - a.tier;

  // Only inside the exact tier, where every tutor already teaches the right
  // board, class and subject and the question is which of them knows these
  // particular chapters.
  const bonus = (tutor: FeedOrderInputs) =>
    a.tier === MATCH_TIERS.exact ? topicBonusBps(tutor.topicMatches ?? 0, requestedTopics) : 0;

  const byScore =
    adjustedScore(b.score, b.freeHoursMask, viewerMask) + bonus(b) -
    (adjustedScore(a.score, a.freeHoursMask, viewerMask) + bonus(a));
  if (byScore !== 0) return byScore;

  return a.name.localeCompare(b.name) || a.tutorId.localeCompare(b.tutorId);
}

export function sortForViewer<T extends FeedOrderInputs>(
  tutors: readonly T[],
  viewerMask: number,
  requestedTopics = 0,
): T[] {
  return [...tutors].sort((a, b) => compareForViewer(a, b, viewerMask, requestedTopics));
}
