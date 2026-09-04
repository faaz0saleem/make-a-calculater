/**
 * How well a tutor's curriculum matches a student's.
 *
 * A student's position is a triple — board, level, subject — and so is each of
 * a tutor's. Matching is a tier, not a percentage, because the differences are
 * categorical: teaching the exact syllabus a student sits is a different thing
 * from teaching the same subject at the same stage under a different board,
 * and no amount of arithmetic makes one shade into the other.
 *
 * The tiers, best first:
 *
 *   3 EXACT     same board, same level, same subject
 *   2 BOARD     same board and subject, a different level
 *   1 STAGE     same subject at the same stage, under a different board
 *   0 NONE      neither
 *
 * Board sits above level on purpose. A tutor who knows the CAIE Physics
 * syllabus can adjust from AS to A2 in an evening; a tutor who has taught
 * Class 11 Physics under the Punjab Board has never seen the CAIE paper. The
 * syllabus is the expensive knowledge, the year is the cheap one.
 *
 * Pure. Nothing here reads a database or a clock.
 */

import type { CurriculumStage } from './boards';

export const MATCH_TIERS = {
  none: 0,
  stage: 1,
  board: 2,
  exact: 3,
} as const;

export type MatchTier = (typeof MATCH_TIERS)[keyof typeof MATCH_TIERS];

export const MAX_MATCH_TIER = MATCH_TIERS.exact;

/** A curriculum position. `stage` is the level's board-independent rung. */
export type CurriculumPosition = {
  boardId: string;
  levelId: string;
  stage: CurriculumStage;
  subjectId: string;
};

export const MATCH_TIER_LABELS: Record<MatchTier, string> = {
  [MATCH_TIERS.exact]: 'Teaches your exact board, class and subject',
  [MATCH_TIERS.board]: 'Teaches your board and subject at another level',
  [MATCH_TIERS.stage]: 'Teaches your subject at your level on another board',
  [MATCH_TIERS.none]: '',
};

/** The tier for one tutor triple against one student triple. */
export function tierFor(student: CurriculumPosition, tutor: CurriculumPosition): MatchTier {
  if (student.subjectId !== tutor.subjectId) return MATCH_TIERS.none;

  if (student.boardId === tutor.boardId) {
    return student.levelId === tutor.levelId ? MATCH_TIERS.exact : MATCH_TIERS.board;
  }

  // `other` is the catch-all board. Two tutors who both picked it have not
  // told us they teach the same syllabus, only that neither list had theirs,
  // so it never earns a same-stage near match.
  if (student.boardId === 'other' || tutor.boardId === 'other') return MATCH_TIERS.none;

  return student.stage === tutor.stage ? MATCH_TIERS.stage : MATCH_TIERS.none;
}

/**
 * The best tier across every pairing.
 *
 * A student may declare more than one position and a tutor up to fifteen, so
 * the answer is the best any pair reaches. Being a great match on one of a
 * student's subjects is a match; it is not diluted by the others.
 */
export function bestTier(
  studentPositions: readonly CurriculumPosition[],
  tutorPositions: readonly CurriculumPosition[],
): MatchTier {
  let best: MatchTier = MATCH_TIERS.none;

  for (const student of studentPositions) {
    for (const tutor of tutorPositions) {
      const tier = tierFor(student, tutor);
      if (tier > best) best = tier;
      if (best === MAX_MATCH_TIER) return best;
    }
  }

  return best;
}

/**
 * Whether a tier clears the bar for a "near match" — the relaxed search a
 * student is offered when a strict curriculum filter finds nobody.
 */
export const NEAR_MATCH_MIN_TIER: MatchTier = MATCH_TIERS.stage;

export function isNearMatch(tier: MatchTier): boolean {
  return tier >= NEAR_MATCH_MIN_TIER;
}
