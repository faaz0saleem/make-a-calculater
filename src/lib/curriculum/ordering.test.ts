import { describe, expect, it } from 'vitest';

import { maskFromUtcHours, OVERLAP_MAX_BPS, studyWindowMaskUtc } from '@/lib/ranking/overlap';
import { computeRanking } from '@/lib/ranking/score';
import { MATCH_TIERS } from './match';
import { adjustedScore, compareForViewer, sortForViewer, type FeedOrderInputs } from './ordering';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const KARACHI = studyWindowMaskUtc('Asia/Karachi', NOW);
/** Free 09:00-15:00 in Karachi. */
const GOOD_HOURS = maskFromUtcHours([4, 5, 6, 7, 8, 9]);
/** Free 02:00-07:00 in Karachi — the middle of the night. */
const BAD_HOURS = maskFromUtcHours([21, 22, 23, 0, 1]);

/** The score the nightly job would give a tutor with this star average. */
function scoreForRating(stars: number): number {
  return computeRanking(
    {
      tutorId: 't',
      ratingSum: stars * 400,
      reviewCount: 400,
      settledCount: 200,
      terminalCount: 200,
      trialCount: 40,
      trialConvertedCount: 20,
      responseMedianSeconds: 900,
      lastActiveAt: NOW,
      verifiedAt: new Date('2024-01-01T00:00:00.000Z'),
      availabilityDensityBps: 6_000,
    },
    NOW,
  ).score;
}

function tutor(overrides: Partial<FeedOrderInputs> & { name: string }): FeedOrderInputs {
  return {
    tier: MATCH_TIERS.none,
    score: 5_000,
    freeHoursMask: GOOD_HOURS,
    tutorId: overrides.name.toLowerCase(),
    ...overrides,
  };
}

describe('an exact curriculum match outweighs a rating', () => {
  it('puts a 4.6 exact match above a 4.9 who teaches something else', () => {
    const exact46 = tutor({ name: 'Exact 4.6', tier: MATCH_TIERS.exact, score: scoreForRating(4.6) });
    const none49 = tutor({ name: 'Other 4.9', tier: MATCH_TIERS.none, score: scoreForRating(4.9) });

    expect(scoreForRating(4.9)).toBeGreaterThan(scoreForRating(4.6));
    expect(compareForViewer(exact46, none49, KARACHI)).toBeLessThan(0);
  });

  it('holds however wide the rating gap gets', () => {
    // Not "usually wins" — always. The tier is a key, not a weight, so no
    // rating, completion rate or response time can buy its way past it.
    const exact = tutor({ name: 'Exact 3.0', tier: MATCH_TIERS.exact, score: scoreForRating(3.0) });
    const perfect = tutor({ name: 'Other 5.0', tier: MATCH_TIERS.none, score: 10_000 });
    expect(compareForViewer(exact, perfect, KARACHI)).toBeLessThan(0);
  });

  it('orders the tiers the way the product means them to be ordered', () => {
    const ordered = sortForViewer(
      [
        tutor({ name: 'D none', tier: MATCH_TIERS.none, score: 9_000 }),
        tutor({ name: 'B board', tier: MATCH_TIERS.board, score: 3_000 }),
        tutor({ name: 'A exact', tier: MATCH_TIERS.exact, score: 1_000 }),
        tutor({ name: 'C stage', tier: MATCH_TIERS.stage, score: 6_000 }),
      ],
      KARACHI,
    );

    expect(ordered.map((entry) => entry.name)).toEqual(['A exact', 'B board', 'C stage', 'D none']);
  });

  it('falls back to the score when nobody matches', () => {
    const ordered = sortForViewer(
      [tutor({ name: 'Low', score: 2_000 }), tutor({ name: 'High', score: 8_000 })],
      KARACHI,
    );
    expect(ordered.map((entry) => entry.name)).toEqual(['High', 'Low']);
  });
});

describe('timezone overlap inside a tier', () => {
  it('puts a workable 4.6 above an unreachable 4.9', () => {
    const reachable = tutor({
      name: 'Reachable 4.6',
      tier: MATCH_TIERS.exact,
      score: scoreForRating(4.6),
      freeHoursMask: GOOD_HOURS,
    });
    const asleep = tutor({
      name: 'Asleep 4.9',
      tier: MATCH_TIERS.exact,
      score: scoreForRating(4.9),
      freeHoursMask: BAD_HOURS,
    });

    expect(compareForViewer(reachable, asleep, KARACHI)).toBeLessThan(0);
  });

  it('does not let overlap cross a tier boundary', () => {
    const perfectHoursNoMatch = tutor({
      name: 'Perfect hours',
      tier: MATCH_TIERS.none,
      score: 10_000,
      freeHoursMask: GOOD_HOURS,
    });
    const badHoursExact = tutor({
      name: 'Right syllabus',
      tier: MATCH_TIERS.exact,
      score: 0,
      freeHoursMask: BAD_HOURS,
    });

    expect(compareForViewer(badHoursExact, perfectHoursNoMatch, KARACHI)).toBeLessThan(0);
  });

  it('adds at most the capped bonus to a score', () => {
    expect(adjustedScore(5_000, GOOD_HOURS, KARACHI)).toBe(5_000 + OVERLAP_MAX_BPS);
    expect(adjustedScore(5_000, BAD_HOURS, KARACHI)).toBe(5_000);
  });

  it('never lets thin hours cost a tutor their curriculum match', () => {
    // The guarantee behind lowering the overlap bar: a tutor teaching the
    // student's exact board, class and subject with two workable evening hours
    // stays above a tutor with neither, whatever the term returns. The tier is
    // a key, so this holds by construction rather than by arithmetic.
    const twoEveningHours = maskFromUtcHours([13, 14]);
    const exact = tutor({
      name: 'Exact, two hours',
      tier: MATCH_TIERS.exact,
      score: scoreForRating(4.0),
      freeHoursMask: twoEveningHours,
    });
    const neither = tutor({
      name: 'No match, all day',
      tier: MATCH_TIERS.none,
      score: 10_000,
      freeHoursMask: GOOD_HOURS,
    });

    expect(compareForViewer(exact, neither, KARACHI)).toBeLessThan(0);
  });
});

describe('a tutor with no nightly score', () => {
  it('sorts last rather than first', () => {
    const ordered = sortForViewer(
      [tutor({ name: 'Unranked', score: null }), tutor({ name: 'Ranked', score: 10 })],
      KARACHI,
    );
    expect(ordered.map((entry) => entry.name)).toEqual(['Ranked', 'Unranked']);
  });
});

describe('the ordering is total', () => {
  it('breaks a dead heat by name, then by id, so paging is stable', () => {
    const left = tutor({ name: 'Same', tutorId: 'a' });
    const right = tutor({ name: 'Same', tutorId: 'b' });
    expect(compareForViewer(left, right, KARACHI)).toBeLessThan(0);
    expect(compareForViewer(right, left, KARACHI)).toBeGreaterThan(0);
    expect(compareForViewer(left, left, KARACHI)).toBe(0);
  });
});
