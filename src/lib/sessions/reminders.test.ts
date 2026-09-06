import { describe, expect, it } from 'vitest';

import { NO_SHOW_WAIT_SECONDS } from '@/lib/money/outcomes';
import {
  ALONE_AFTER_MINUTES,
  REMINDER_GRACE_MINUTES,
  reminderCopy,
  reminderKey,
  remindersDue,
  waitingConsequence,
  waitingState,
} from './reminders';

const START = new Date('2026-09-15T13:00:00Z');
const at = (minutesBeforeStart: number) =>
  new Date(START.getTime() - minutesBeforeStart * 60_000);

describe('the schedule', () => {
  it('sends nothing two days out', () => {
    expect(remindersDue(START, at(48 * 60))).toEqual([]);
  });

  it('tells both sides a day before', () => {
    const due = remindersDue(START, at(24 * 60));
    expect(due.map((slot) => `${slot.kind}:${slot.audience}`).sort()).toEqual([
      'day:student',
      'day:tutor',
    ]);
  });

  it('tells both sides an hour before', () => {
    const due = remindersDue(START, at(60));
    expect(due.map((slot) => slot.audience).sort()).toEqual(['student', 'tutor']);
  });

  /**
   * The asymmetry, and the reason for it: the tutor is being paid, so the
   * professional should be in the room first.
   */
  it('gives the last nudge to the tutor alone', () => {
    const due = remindersDue(START, at(10));
    expect(due).toHaveLength(1);
    expect(due[0]!.audience).toBe('tutor');
    expect(due[0]!.kind).toBe('final');
  });

  it('still sends a late reminder while it is useful', () => {
    expect(remindersDue(START, at(60 - REMINDER_GRACE_MINUTES + 1))).toHaveLength(2);
  });

  it('stops sending one that has gone stale', () => {
    expect(remindersDue(START, at(60 - REMINDER_GRACE_MINUTES - 5))).toEqual([]);
  });

  it('never sends a reminder for a lesson already under way', () => {
    expect(remindersDue(START, new Date(START.getTime() + 60_000))).toEqual([]);
  });

  it('keys each nudge so a job running every five minutes sends it once', () => {
    const [slot] = remindersDue(START, at(10));
    expect(reminderKey('abc', slot!)).toBe('reminder:abc:final:tutor');
  });
});

describe('what they say', () => {
  const context = { otherName: 'Sadia', whenLocal: '6:00 PM', isTrial: false };

  it('names a consequence only where there is one', () => {
    expect(reminderCopy({ kind: 'day', audience: 'student', minutesBefore: 1440 }, context).body)
      .not.toContain('refund');
    expect(reminderCopy({ kind: 'final', audience: 'tutor', minutesBefore: 10 }, context).body)
      .toContain('refund');
  });

  it('has a short form for a phone', () => {
    const copy = reminderCopy({ kind: 'hour', audience: 'student', minutesBefore: 60 }, context);
    expect(copy.whatsapp.length).toBeLessThan(160);
    expect(copy.whatsapp).toContain('Sadia');
  });
});

describe('the empty room', () => {
  const aloneSince = new Date('2026-09-15T12:55:00Z');

  it('says nothing for the first couple of minutes', () => {
    const state = waitingState(aloneSince, START, new Date(START.getTime() + 60_000), 'tutor');
    expect(state.kind).toBe('too_early');
  });

  it('counts down once somebody is genuinely alone', () => {
    const state = waitingState(
      aloneSince,
      START,
      new Date(START.getTime() + ALONE_AFTER_MINUTES * 60_000),
      'tutor',
    );
    expect(state.kind).toBe('waiting');
    if (state.kind === 'waiting') expect(state.secondsLeft).toBeGreaterThan(0);
  });

  /**
   * The load-bearing one. The countdown a waiting person sees has to be the
   * same clock that decides who gets paid, or the screen is lying to them
   * about their own money.
   */
  it('runs on exactly the clock that settles the money', () => {
    const oneSecondBefore = new Date(aloneSince.getTime() + NO_SHOW_WAIT_SECONDS * 1_000 - 1_000);
    const atZero = new Date(aloneSince.getTime() + NO_SHOW_WAIT_SECONDS * 1_000);

    expect(waitingState(aloneSince, START, oneSecondBefore, 'tutor').kind).toBe('waiting');
    expect(waitingState(aloneSince, START, atZero, 'tutor').kind).toBe('settled');
  });

  it('counts from when the waiting started, not from the hour', () => {
    // Somebody who joined five minutes early has been alone five minutes
    // longer, and their clock should say so.
    const early = waitingState(aloneSince, START, new Date(START.getTime() + 3 * 60_000), 'tutor');
    const onTime = waitingState(START, START, new Date(START.getTime() + 3 * 60_000), 'tutor');

    if (early.kind === 'waiting' && onTime.kind === 'waiting') {
      expect(early.secondsLeft).toBeLessThan(onTime.secondsLeft);
    } else {
      throw new Error('both should still be waiting');
    }
  });

  it('tells each side who gets paid, from their own end', () => {
    expect(waitingConsequence('tutor', false)).toContain('every credit back');
    expect(waitingConsequence('tutor', true)).toContain('refunded in full');
    expect(waitingConsequence('student', true)).toContain('paid in full');
  });
});
