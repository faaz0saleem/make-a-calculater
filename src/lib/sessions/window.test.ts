import { describe, expect, it } from 'vitest';

import {
  DISPUTE_WINDOW_HOURS,
  dueWarningMinutes,
  elapsedSeconds,
  GRACE_MINUTES_AFTER,
  JOIN_OPENS_MINUTES_BEFORE,
  joinState,
  remainingSeconds,
  sessionWindow,
} from './window';

const START = new Date('2026-04-15T18:00:00.000Z');
const WINDOW = sessionWindow(START, 60);
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

describe('sessionWindow', () => {
  it('derives every boundary from the scheduled start (SPEC.md §7)', () => {
    expect(WINDOW.startUtc.toISOString()).toBe('2026-04-15T18:00:00.000Z');
    expect(WINDOW.endUtc.toISOString()).toBe('2026-04-15T19:00:00.000Z');
    expect(WINDOW.joinOpensUtc.toISOString()).toBe('2026-04-15T17:55:00.000Z');
    expect(WINDOW.joinClosesUtc.toISOString()).toBe('2026-04-15T19:10:00.000Z');
  });

  it('uses the values the spec names', () => {
    expect([JOIN_OPENS_MINUTES_BEFORE, GRACE_MINUTES_AFTER, DISPUTE_WINDOW_HOURS]).toEqual([5, 10, 24]);
  });

  it('settles a day after the session ends', () => {
    expect(WINDOW.settlesAfterUtc.toISOString()).toBe('2026-04-16T19:00:00.000Z');
  });

  it('handles a 30-minute booking', () => {
    const half = sessionWindow(START, 30);
    expect(half.endUtc.toISOString()).toBe('2026-04-15T18:30:00.000Z');
  });
});

describe('joinState', () => {
  it('refuses before the room opens, and says how long to wait', () => {
    const state = joinState(WINDOW, at(-10));
    expect(state.canJoin).toBe(false);
    expect(state.phase).toBe('too_early');
    expect(state.canJoin === false && state.opensInSeconds).toBe(300);
  });

  it('opens five minutes early', () => {
    expect(joinState(WINDOW, at(-5)).canJoin).toBe(true);
    expect(joinState(WINDOW, at(-5)).phase).toBe('early');
  });

  it('is live between the start and the end', () => {
    expect(joinState(WINDOW, at(0)).phase).toBe('live');
    expect(joinState(WINDOW, at(59)).phase).toBe('live');
    expect(joinState(WINDOW, at(60)).phase).toBe('live');
  });

  it('stays open through the grace period, so a session can run slightly long', () => {
    expect(joinState(WINDOW, at(65)).phase).toBe('grace');
    expect(joinState(WINDOW, at(70)).canJoin).toBe(true);
  });

  it('closes after the grace period', () => {
    const state = joinState(WINDOW, at(71));
    expect(state.canJoin).toBe(false);
    expect(state.phase).toBe('over');
  });
});

describe('the session clock', () => {
  it('counts down the booked duration', () => {
    expect(remainingSeconds(WINDOW, at(0))).toBe(3_600);
    expect(remainingSeconds(WINDOW, at(30))).toBe(1_800);
    expect(remainingSeconds(WINDOW, at(60))).toBe(0);
  });

  it('goes negative in the grace period, so the UI can say "running over"', () => {
    expect(remainingSeconds(WINDOW, at(65))).toBe(-300);
  });

  it('counts elapsed from the scheduled start, not from joining', () => {
    // Joining early does not start the clock.
    expect(elapsedSeconds(WINDOW, at(-3))).toBe(0);
    expect(elapsedSeconds(WINDOW, at(10))).toBe(600);
  });

  it('is a pure function of the scheduled start, so a reconnect cannot reset it', () => {
    const before = remainingSeconds(WINDOW, at(20));
    // Same instant, recomputed after a reconnect: identical.
    expect(remainingSeconds(WINDOW, at(20))).toBe(before);
  });
});

describe('warnings', () => {
  it('fires at five minutes and at one', () => {
    expect(dueWarningMinutes(WINDOW, at(55))).toBe(5);
    expect(dueWarningMinutes(WINDOW, at(59))).toBe(1);
  });

  it('stays quiet the rest of the time', () => {
    expect(dueWarningMinutes(WINDOW, at(30))).toBeNull();
    expect(dueWarningMinutes(WINDOW, at(53))).toBeNull();
    expect(dueWarningMinutes(WINDOW, at(61))).toBeNull();
  });
});
