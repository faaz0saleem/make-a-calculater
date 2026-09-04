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
 * `src/db/discovery.ts` builds the same ordering in SQL. This module is the
 * readable statement of it, and what the tests check.
 */

import { overlapBonusBps } from '@/lib/ranking/overlap';
import type { MatchTier } from './match';

export type FeedOrderInputs = {
  /** 0-3, from `./match.ts`. Zero when the viewer declared no curriculum. */
  tier: MatchTier;
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
): number {
  if (a.tier !== b.tier) return b.tier - a.tier;

  const byScore = adjustedScore(b.score, b.freeHoursMask, viewerMask) -
    adjustedScore(a.score, a.freeHoursMask, viewerMask);
  if (byScore !== 0) return byScore;

  return a.name.localeCompare(b.name) || a.tutorId.localeCompare(b.tutorId);
}

export function sortForViewer<T extends FeedOrderInputs>(tutors: readonly T[], viewerMask: number): T[] {
  return [...tutors].sort((a, b) => compareForViewer(a, b, viewerMask));
}
