import { describe, expect, it } from 'vitest';

import { maskFromUtcHours, OVERLAP_MAX_BPS, studyWindowMaskUtc } from '@/lib/ranking/overlap';
import { computeRanking } from '@/lib/ranking/score';
import { MATCH_TIERS } from './match';
import {
  adjustedScore,
  compareForViewer,
  sortForViewer,
  topicBonusBps,
  TOPIC_MAX_BPS,
  type FeedOrderInputs,
} from './ordering';

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


describe('the chapter tiebreak', () => {
  const base = { score: 8_000, freeHoursMask: 0, name: 'Alike', tutorId: 'a' } as const;

  it('orders two otherwise identical tutors by chapters declared', () => {
    const declared = { ...base, tier: MATCH_TIERS.exact, topicMatches: 3, tutorId: 'a', name: 'A' };
    const silent = { ...base, tier: MATCH_TIERS.exact, topicMatches: 0, tutorId: 'b', name: 'B' };

    expect(sortForViewer([silent, declared], 0, 3).map((t) => t.tutorId)).toEqual(['a', 'b']);
  });

  it('is graduated — half the chapters earns half the nudge', () => {
    expect(topicBonusBps(3, 3)).toBe(TOPIC_MAX_BPS);
    expect(topicBonusBps(0, 3)).toBe(0);
    expect(topicBonusBps(2, 4)).toBe(TOPIC_MAX_BPS / 2);
  });

  /**
   * The load-bearing one. A chapter match must not out-argue a rating gap that
   * actually means something — 225 points is roughly a 4.6 against a 4.9.
   */
  it('cannot overturn three tenths of a star', () => {
    const worse = { ...base, tier: MATCH_TIERS.exact, score: 7_800, topicMatches: 5, tutorId: 'a', name: 'A' };
    const better = { ...base, tier: MATCH_TIERS.exact, score: 8_025, topicMatches: 0, tutorId: 'b', name: 'B' };

    expect(sortForViewer([worse, better], 0, 5).map((t) => t.tutorId)).toEqual(['b', 'a']);
    expect(TOPIC_MAX_BPS).toBeLessThan(225);
  });

  it('never lifts a tutor out of a lower tier, whatever they declare', () => {
    const lower = { ...base, tier: MATCH_TIERS.board, topicMatches: 99, tutorId: 'a', name: 'A' };
    const exact = { ...base, tier: MATCH_TIERS.exact, topicMatches: 0, score: 1, tutorId: 'b', name: 'B' };

    expect(sortForViewer([lower, exact], 0, 99).map((t) => t.tutorId)).toEqual(['b', 'a']);
  });

  it('does nothing at all when the viewer asked about no chapters', () => {
    const declared = { ...base, tier: MATCH_TIERS.exact, topicMatches: 5, tutorId: 'a', name: 'B' };
    const silent = { ...base, tier: MATCH_TIERS.exact, topicMatches: 0, tutorId: 'b', name: 'A' };

    // Falls through to the name tiebreak, so A comes first.
    expect(sortForViewer([declared, silent], 0, 0).map((t) => t.tutorId)).toEqual(['b', 'a']);
  });
});
