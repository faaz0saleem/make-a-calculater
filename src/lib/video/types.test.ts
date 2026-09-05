import { describe, expect, it } from 'vitest';

import {
  checkIntroLength,
  INTRO_VIDEO_MAX_SECONDS,
  INTRO_VIDEO_MIN_SECONDS,
  PREVIEW_SECONDS,
  previewStartSeconds,
  THUMBNAIL_CANDIDATE_COUNT,
  thumbnailTimestamps,
} from './types';

describe('checkIntroLength', () => {
  it('accepts the 30 to 90 second window from SPEC.md §3', () => {
    expect(checkIntroLength(INTRO_VIDEO_MIN_SECONDS).ok).toBe(true);
    expect(checkIntroLength(60).ok).toBe(true);
    expect(checkIntroLength(INTRO_VIDEO_MAX_SECONDS).ok).toBe(true);
  });

  it('rejects clips outside it, and says how long they were', () => {
    const short = checkIntroLength(12);
    expect(short.ok).toBe(false);
    expect(short.ok === false && short.reason).toContain('12 seconds');

    const long = checkIntroLength(240);
    expect(long.ok).toBe(false);
    expect(long.ok === false && long.reason).toContain('at most 90');
  });

  it('rounds, so a 29.6 second clip is not rejected for four tenths', () => {
    expect(checkIntroLength(29.6).ok).toBe(true);
    expect(checkIntroLength(29.4).ok).toBe(false);
    expect(checkIntroLength(90.4).ok).toBe(true);
    expect(checkIntroLength(90.6).ok).toBe(false);
  });

  it('rejects an unreadable duration rather than trusting it', () => {
    expect(checkIntroLength(0).ok).toBe(false);
    expect(checkIntroLength(-5).ok).toBe(false);
    expect(checkIntroLength(Number.NaN).ok).toBe(false);
    expect(checkIntroLength(Number.POSITIVE_INFINITY).ok).toBe(false);
  });
});

describe('thumbnailTimestamps', () => {
  it('returns three candidates for the tutor to pick from', () => {
    expect(thumbnailTimestamps(60)).toHaveLength(THUMBNAIL_CANDIDATE_COUNT);
  });

  it('skips the first and last 15%, where the recording is usually messy', () => {
    const stamps = thumbnailTimestamps(60);
    expect(stamps[0]).toBeGreaterThanOrEqual(9);
    expect(stamps[stamps.length - 1]!).toBeLessThanOrEqual(51);
  });

  it('spreads them out in order', () => {
    const stamps = thumbnailTimestamps(90);
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it('stays inside the clip for the shortest allowed video', () => {
    for (const stamp of thumbnailTimestamps(30)) {
      expect(stamp).toBeGreaterThan(0);
      expect(stamp).toBeLessThan(30);
    }
  });
});

describe('previewStartSeconds', () => {
  it('starts a little way in', () => {
    expect(previewStartSeconds(60)).toBeCloseTo(9, 5);
  });

  it('never runs past the end of a short clip', () => {
    const duration = 10;
    expect(previewStartSeconds(duration) + PREVIEW_SECONDS).toBeLessThanOrEqual(duration + 0.001);
  });

  it('is never negative', () => {
    expect(previewStartSeconds(3)).toBe(0);
  });
});
