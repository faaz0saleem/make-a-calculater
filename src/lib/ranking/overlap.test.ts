import { describe, expect, it } from 'vitest';

import { ratingToBps, WEIGHTS } from './score';
import {
  ALL_HOURS_MASK,
  hoursFromMask,
  localWindowMaskUtc,
  maskFromUtcHours,
  OVERLAP_MAX_BPS,
  OVERLAP_TARGET_HOURS,
  OVERLAP_UNKNOWN_BPS,
  overlapBonusBps,
  overlapHours,
  studyWindowMaskUtc,
} from './overlap';

// Mid-January: the northern hemisphere is on standard time, Karachi never
// changes, and Sydney is on daylight saving. A good instant for offsets.
const WINTER = new Date('2026-01-15T12:00:00.000Z');
const SUMMER = new Date('2026-07-15T12:00:00.000Z');

describe('localWindowMaskUtc', () => {
  it('is the identity in UTC', () => {
    expect(hoursFromMask(localWindowMaskUtc('UTC', 7, 22, WINTER))).toEqual([
      7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    ]);
  });

  it('shifts by the offset, wrapping around midnight', () => {
    // Karachi is UTC+5 all year: 07:00-22:00 local is 02:00-17:00 UTC.
    expect(hoursFromMask(localWindowMaskUtc('Asia/Karachi', 7, 22, WINTER))).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);

    // Los Angeles is UTC-8 in winter: 07:00 local is 15:00 UTC and the window
    // runs past midnight into the next UTC day.
    expect(hoursFromMask(localWindowMaskUtc('America/Los_Angeles', 7, 22, WINTER))).toEqual([
      0, 1, 2, 3, 4, 5, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    ]);
  });

  it('follows daylight saving rather than a fixed table', () => {
    const winter = localWindowMaskUtc('Europe/London', 7, 22, WINTER);
    const summer = localWindowMaskUtc('Europe/London', 7, 22, SUMMER);
    expect(winter).not.toBe(summer);
    // BST is an hour ahead, so every UTC hour moves back by one.
    expect(hoursFromMask(summer)).toEqual(hoursFromMask(winter).map((hour) => hour - 1));
  });

  it('covers both UTC hours a half-hour offset straddles', () => {
    // Kolkata is +05:30, so 07:00-08:00 IST is 01:30-02:30 UTC and touches both.
    const mask = localWindowMaskUtc('Asia/Kolkata', 7, 8, WINTER);
    expect(hoursFromMask(mask)).toEqual([1, 2]);
  });

  it('handles a three-quarter-hour offset', () => {
    // Kathmandu is +05:45.
    expect(hoursFromMask(localWindowMaskUtc('Asia/Kathmandu', 7, 8, WINTER))).toEqual([1, 2]);
  });

  it('opens the whole day rather than narrowing a feed to nothing on a bad zone', () => {
    expect(localWindowMaskUtc('Mars/Olympus_Mons', 7, 22, WINTER)).toBe(ALL_HOURS_MASK);
  });

  it('is empty for an empty window', () => {
    expect(localWindowMaskUtc('UTC', 9, 9, WINTER)).toBe(0);
  });
});

describe('overlapHours', () => {
  it('counts the shared bits', () => {
    expect(overlapHours(maskFromUtcHours([1, 2, 3]), maskFromUtcHours([3, 4, 5]))).toBe(1);
    expect(overlapHours(maskFromUtcHours([1, 2, 3]), maskFromUtcHours([1, 2, 3]))).toBe(3);
    expect(overlapHours(maskFromUtcHours([1, 2]), maskFromUtcHours([8, 9]))).toBe(0);
    expect(overlapHours(ALL_HOURS_MASK, ALL_HOURS_MASK)).toBe(24);
  });
});

describe('maskFromUtcHours', () => {
  it('ignores anything that is not an hour of the day', () => {
    expect(hoursFromMask(maskFromUtcHours([0, 23, -1, 24, 7.5, Number.NaN]))).toEqual([0, 23]);
  });
});

describe('overlapBonusBps', () => {
  const karachiStudent = studyWindowMaskUtc('Asia/Karachi', WINTER);

  it('pays nothing to a tutor whose free hours are the student\'s night', () => {
    // 03:00-06:00 Karachi is 22:00-01:00 UTC.
    const tutor = maskFromUtcHours([22, 23, 0]);
    expect(overlapHours(tutor, karachiStudent)).toBe(0);
    expect(overlapBonusBps(tutor, karachiStudent)).toBe(0);
  });

  it('pays in full once the overlap reaches the target', () => {
    const tutor = maskFromUtcHours([10, 11, 12]);
    expect(overlapBonusBps(tutor, karachiStudent)).toBe(OVERLAP_MAX_BPS);
  });

  it('stops paying past the target rather than rewarding an emptier week', () => {
    const three = maskFromUtcHours([10, 11, 12]);
    const twelve = maskFromUtcHours([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(overlapBonusBps(twelve, karachiStudent)).toBe(overlapBonusBps(three, karachiStudent));
  });

  it('is graduated, not a threshold: one shared hour is worth a third', () => {
    // One shared hour is a lesson a week that actually happens. It should not
    // fall off a cliff to nothing just because it is not three.
    const one = overlapBonusBps(maskFromUtcHours([10]), karachiStudent);
    const two = overlapBonusBps(maskFromUtcHours([10, 11]), karachiStudent);

    expect(one).toBe(Math.round(OVERLAP_MAX_BPS / 3));
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
    expect(two).toBeLessThan(OVERLAP_MAX_BPS);
  });

  it('does not fail a Lahore student looking at a London tutor', () => {
    // The corridor this product is built for. A London tutor teaching their own
    // evening shares about an hour with a Karachi student's day — thin, and
    // real, and worth more than nothing.
    const londonEvening = maskFromUtcHours([16, 17, 18, 19, 20]);
    expect(overlapHours(londonEvening, karachiStudent)).toBeGreaterThan(0);
    expect(overlapBonusBps(londonEvening, karachiStudent)).toBeGreaterThan(0);

    // A London tutor teaching in the daytime shares plenty, and maxes the term.
    const londonDaytime = maskFromUtcHours([9, 10, 11, 12, 13, 14, 15, 16]);
    expect(overlapBonusBps(londonDaytime, karachiStudent)).toBe(OVERLAP_MAX_BPS);
  });

  it('treats an empty mask as unknown, not as never free', () => {
    // A tutor who has published no hours at all has told us nothing. Scoring
    // that zero would bury every tutor who has not set a calendar up yet.
    expect(overlapBonusBps(0, karachiStudent)).toBe(OVERLAP_UNKNOWN_BPS);
    expect(OVERLAP_UNKNOWN_BPS).toBeGreaterThan(0);
    expect(OVERLAP_UNKNOWN_BPS).toBeLessThan(OVERLAP_MAX_BPS);
  });

  it('outweighs three tenths of a star', () => {
    // The whole point of the term. A 4.9 tutor asleep when the student is
    // awake should lose to a 4.6 tutor who is free at 6pm Karachi time.
    const ratingGap =
      ((ratingToBps(4_900) - ratingToBps(4_600)) * WEIGHTS.bayesianRating) / 10_000;
    expect(OVERLAP_MAX_BPS).toBeGreaterThan(ratingGap);
  });

  it('never moves a score by more than its cap', () => {
    for (let mask = 0; mask < 4096; mask += 7) {
      const bonus = overlapBonusBps(mask, karachiStudent);
      expect(bonus).toBeGreaterThanOrEqual(0);
      expect(bonus).toBeLessThanOrEqual(OVERLAP_MAX_BPS);
    }
  });

  it('keeps the target small enough to be reachable across a continent', () => {
    expect(OVERLAP_TARGET_HOURS).toBeLessThanOrEqual(hoursFromMask(karachiStudent).length);

    // A five-hour offset — Lahore to London — must not on its own fail the bar
    // for a tutor working ordinary hours.
    const london = studyWindowMaskUtc('Europe/London', WINTER);
    expect(overlapHours(london, karachiStudent)).toBeGreaterThanOrEqual(OVERLAP_TARGET_HOURS);
  });
});

describe('two students in different timezones', () => {
  it('rank the same two tutors in opposite orders', () => {
    const karachi = studyWindowMaskUtc('Asia/Karachi', WINTER);
    const newYork = studyWindowMaskUtc('America/New_York', WINTER);

    // Free 04:00-10:00 UTC: 09:00-15:00 in Karachi, 23:00-05:00 in New York.
    const daytimeInKarachi = maskFromUtcHours([4, 5, 6, 7, 8, 9]);
    // Free 18:00-24:00 UTC: 13:00-19:00 in New York, 23:00-05:00 in Karachi.
    const daytimeInNewYork = maskFromUtcHours([18, 19, 20, 21, 22, 23]);

    expect(overlapBonusBps(daytimeInKarachi, karachi)).toBe(OVERLAP_MAX_BPS);
    expect(overlapBonusBps(daytimeInNewYork, karachi)).toBe(0);

    expect(overlapBonusBps(daytimeInNewYork, newYork)).toBe(OVERLAP_MAX_BPS);
    expect(overlapBonusBps(daytimeInKarachi, newYork)).toBe(0);
  });
});
