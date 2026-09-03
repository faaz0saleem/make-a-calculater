import { describe, expect, it } from 'vitest';

import {
  AVAILABILITY_UNKNOWN_BPS,
  bayesianRatingMilli,
  completionRateBps,
  computeRanking,
  EXPLORATION_MAX_BPS,
  explorationBoost,
  PRIOR_MEAN_MILLI,
  ratingToBps,
  recencyBps,
  responseSpeedBps,
  trialToPaidBps,
  WEIGHTS,
  type RankingInputs,
} from './score';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function inputs(overrides: Partial<RankingInputs> = {}): RankingInputs {
  return {
    tutorId: 't1',
    ratingSum: 0,
    reviewCount: 0,
    settledCount: 0,
    terminalCount: 0,
    trialCount: 0,
    trialConvertedCount: 0,
    responseMedianSeconds: null,
    lastActiveAt: null,
    verifiedAt: null,
    availabilityDensityBps: null,
    ...overrides,
  };
}

describe('the weights match SPEC.md §4', () => {
  it('sums to 10000 basis points', () => {
    expect(Object.values(WEIGHTS).reduce((total, weight) => total + weight, 0)).toBe(10_000);
  });

  it('uses the proportions the spec names', () => {
    expect(WEIGHTS).toEqual({
      bayesianRating: 3_000,
      completionRate: 2_000,
      trialToPaid: 1_500,
      availabilityDensity: 1_500,
      responseSpeed: 1_000,
      recency: 1_000,
    });
  });
});

describe('bayesianRatingMilli', () => {
  it('falls back to the prior with no reviews', () => {
    expect(bayesianRatingMilli(0, 0)).toBe(PRIOR_MEAN_MILLI);
  });

  it('stops one 5-star review outranking a tutor with two hundred', () => {
    const single = bayesianRatingMilli(5, 1);
    const many = bayesianRatingMilli(5 * 200, 200);
    expect(single).toBeLessThan(many);
    expect(single).toBe(4_417);
  });

  it('converges on the true average as reviews pile up', () => {
    expect(bayesianRatingMilli(5 * 1_000, 1_000)).toBeGreaterThan(4_990);
  });

  it('drags a bad tutor down slowly rather than instantly', () => {
    expect(bayesianRatingMilli(1, 1)).toBe(3_750);
    expect(bayesianRatingMilli(20, 20)).toBeLessThan(2_000);
  });
});

describe('ratingToBps', () => {
  it('maps one to five stars onto the full range', () => {
    expect(ratingToBps(1_000)).toBe(0);
    expect(ratingToBps(3_000)).toBe(5_000);
    expect(ratingToBps(5_000)).toBe(10_000);
  });

  it('clamps rather than escaping the range', () => {
    expect(ratingToBps(0)).toBe(0);
    expect(ratingToBps(9_000)).toBe(10_000);
  });
});

describe('completionRateBps', () => {
  it('scores the share of finished bookings that completed', () => {
    expect(completionRateBps(9, 10)).toBe(9_000);
    expect(completionRateBps(10, 10)).toBe(10_000);
    expect(completionRateBps(0, 10)).toBe(0);
  });

  it('stays neutral with no history, rather than scoring zero', () => {
    expect(completionRateBps(0, 0)).toBe(AVAILABILITY_UNKNOWN_BPS);
  });
});

describe('trialToPaidBps', () => {
  it('scores conversion, and stays neutral with no trials', () => {
    expect(trialToPaidBps(3, 10)).toBe(3_000);
    expect(trialToPaidBps(0, 0)).toBe(AVAILABILITY_UNKNOWN_BPS);
  });
});

describe('responseSpeedBps', () => {
  it('rewards fast replies and gives up after a day', () => {
    expect(responseSpeedBps(60)).toBe(10_000);
    expect(responseSpeedBps(15 * 60)).toBe(10_000);
    expect(responseSpeedBps(24 * 60 * 60)).toBe(0);
    expect(responseSpeedBps(48 * 60 * 60)).toBe(0);
  });

  it('decreases monotonically in between', () => {
    const points = [20, 60, 120, 360, 720].map((minutes) => responseSpeedBps(minutes * 60));
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i]!).toBeLessThan(points[i - 1]!);
    }
  });

  it('decays on a log curve, so an hour is meaningfully worse than a minute', () => {
    // Linearly an hour would score ~97%, which makes the whole term useless.
    expect(responseSpeedBps(60 * 60)).toBeGreaterThan(6_500);
    expect(responseSpeedBps(60 * 60)).toBeLessThan(7_500);
    expect(responseSpeedBps(6 * 60 * 60)).toBeLessThan(3_500);
  });

  it('stays neutral for a tutor who has never had to reply', () => {
    expect(responseSpeedBps(null)).toBe(AVAILABILITY_UNKNOWN_BPS);
  });
});

describe('recencyBps', () => {
  it('scores full for the last week and nothing after three months', () => {
    expect(recencyBps(daysAgo(0), NOW)).toBe(10_000);
    expect(recencyBps(daysAgo(7), NOW)).toBe(10_000);
    expect(recencyBps(daysAgo(90), NOW)).toBe(0);
    expect(recencyBps(daysAgo(365), NOW)).toBe(0);
  });

  it('decays in between', () => {
    expect(recencyBps(daysAgo(30), NOW)).toBeGreaterThan(0);
    expect(recencyBps(daysAgo(30), NOW)).toBeLessThan(10_000);
    expect(recencyBps(daysAgo(60), NOW)).toBeLessThan(recencyBps(daysAgo(30), NOW));
  });

  it('scores nothing for a tutor who has never been active', () => {
    expect(recencyBps(null, NOW)).toBe(0);
  });
});

describe('explorationBoost', () => {
  it('gives a brand new tutor the full boost', () => {
    expect(explorationBoost(daysAgo(0), 0, NOW)).toBe(EXPLORATION_MAX_BPS);
  });

  it('decays over 30 days', () => {
    expect(explorationBoost(daysAgo(15), 0, NOW)).toBe(EXPLORATION_MAX_BPS / 2);
    expect(explorationBoost(daysAgo(30), 0, NOW)).toBe(0);
    expect(explorationBoost(daysAgo(60), 0, NOW)).toBe(0);
  });

  it('decays over 20 sessions', () => {
    expect(explorationBoost(daysAgo(1), 10, NOW)).toBe(EXPLORATION_MAX_BPS / 2);
    expect(explorationBoost(daysAgo(1), 20, NOW)).toBe(0);
  });

  it('uses whichever runs out first', () => {
    // 3 days in (90% left by time) but already 18 sessions (10% left by sessions).
    expect(explorationBoost(daysAgo(3), 18, NOW)).toBe(Math.round(EXPLORATION_MAX_BPS * 0.1));
  });

  it('gives nothing to an unverified tutor', () => {
    expect(explorationBoost(null, 0, NOW)).toBe(0);
  });
});

describe('computeRanking', () => {
  it('keeps the score inside the range, plus the boost', () => {
    const perfect = computeRanking(
      inputs({
        ratingSum: 5 * 500,
        reviewCount: 500,
        settledCount: 500,
        terminalCount: 500,
        trialCount: 100,
        trialConvertedCount: 100,
        responseMedianSeconds: 60,
        lastActiveAt: NOW,
        verifiedAt: daysAgo(400),
        availabilityDensityBps: 10_000,
      }),
      NOW,
    );
    expect(perfect.score).toBeGreaterThan(9_500);
    expect(perfect.score).toBeLessThanOrEqual(10_000);
    expect(perfect.explorationBoost).toBe(0);
  });

  it('ranks a proven tutor above an identical one who has gone quiet', () => {
    const base = {
      ratingSum: 5 * 40,
      reviewCount: 40,
      settledCount: 40,
      terminalCount: 42,
      trialCount: 20,
      trialConvertedCount: 12,
      responseMedianSeconds: 900,
      verifiedAt: daysAgo(300),
    };
    const active = computeRanking(inputs({ ...base, lastActiveAt: daysAgo(1) }), NOW);
    const quiet = computeRanking(inputs({ ...base, lastActiveAt: daysAgo(120) }), NOW);
    expect(active.score).toBeGreaterThan(quiet.score);
  });

  it('gives a brand new tutor a foothold without letting them top the feed', () => {
    // A genuinely strong tutor: 4.8 stars over 50 reviews, replies in minutes.
    const strong = computeRanking(
      inputs({
        ratingSum: Math.round(4.8 * 50),
        reviewCount: 50,
        settledCount: 50,
        terminalCount: 53,
        trialCount: 20,
        trialConvertedCount: 12,
        responseMedianSeconds: 600,
        lastActiveAt: daysAgo(1),
        verifiedAt: daysAgo(200),
      }),
      NOW,
    );

    // A middling one: 3.9 stars, converts two trials in ten, replies in an hour.
    const middling = computeRanking(
      inputs({
        ratingSum: Math.round(3.9 * 30),
        reviewCount: 30,
        settledCount: 30,
        terminalCount: 38,
        trialCount: 20,
        trialConvertedCount: 4,
        responseMedianSeconds: 3_600,
        lastActiveAt: daysAgo(5),
        verifiedAt: daysAgo(200),
      }),
      NOW,
    );

    const brandNew = computeRanking(
      inputs({ responseMedianSeconds: 600, lastActiveAt: daysAgo(1), verifiedAt: daysAgo(1) }),
      NOW,
    );

    expect(brandNew.explorationBoost).toBeGreaterThan(1_000);
    // Seen, but not ahead of a tutor who has earned their place.
    expect(brandNew.score).toBeLessThan(strong.score);
    // And ahead of a middling one, which is the point of the exploration slot.
    expect(brandNew.score).toBeGreaterThan(middling.score);
  });

  it('lets the boost expire, after which a new tutor stands on their own record', () => {
    const settings = { responseMedianSeconds: 600, lastActiveAt: daysAgo(1) };
    const week1 = computeRanking(inputs({ ...settings, verifiedAt: daysAgo(1) }), NOW);
    const week6 = computeRanking(inputs({ ...settings, verifiedAt: daysAgo(45) }), NOW);
    expect(week6.explorationBoost).toBe(0);
    expect(week6.score).toBeLessThan(week1.score);
  });

  it('scores unknown availability neutrally, so it cancels out of the ordering', () => {
    const unknown = computeRanking(inputs({ availabilityDensityBps: null }), NOW);
    const neutral = computeRanking(inputs({ availabilityDensityBps: AVAILABILITY_UNKNOWN_BPS }), NOW);
    expect(unknown.score).toBe(neutral.score);
    expect(unknown.availabilityDensityBps).toBe(AVAILABILITY_UNKNOWN_BPS);
  });

  it('is a pure function of its inputs', () => {
    const once = computeRanking(inputs({ ratingSum: 20, reviewCount: 5 }), NOW);
    const twice = computeRanking(inputs({ ratingSum: 20, reviewCount: 5 }), NOW);
    expect(once).toEqual(twice);
  });

  it('returns every term, so admin can see why a tutor ranks where they do', () => {
    const breakdown = computeRanking(inputs({ ratingSum: 20, reviewCount: 5 }), NOW);
    expect(Object.keys(breakdown).sort()).toEqual(
      [
        'availabilityDensityBps',
        'bayesianRatingBps',
        'bayesianRatingMilli',
        'completionRateBps',
        'explorationBoost',
        'recencyBps',
        'responseSpeedBps',
        'score',
        'trialToPaidBps',
        'tutorId',
      ].sort(),
    );
  });
});
