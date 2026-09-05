/**
 * Attendance is what decides whether money moves, so this is tested against the
 * ways a real mobile connection misbehaves rather than only the happy path.
 */

import { describe, expect, it } from 'vitest';

import { resolveBookingOutcome, type BookingForOutcome } from '@/lib/money/outcomes';
import { presenceFor, summariseAttendance, type SessionEvent } from './attendance';
import { sessionWindow } from './window';

const START = new Date('2026-04-15T18:00:00.000Z');
const WINDOW = sessionWindow(START, 60);
const STUDENT = 'student-1';
const TUTOR = 'tutor-1';

/** Minutes after the scheduled start. */
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

function event(kind: SessionEvent['event'], userId: string | null, minutes: number): SessionEvent {
  return { event: kind, userId, atUtc: at(minutes) };
}

function summarise(events: SessionEvent[], now = at(120)) {
  return summariseAttendance({ events, window: WINDOW, studentId: STUDENT, tutorId: TUTOR, now });
}

describe('presenceFor', () => {
  it('pairs a join with its leave', () => {
    const intervals = presenceFor(
      [event('participant_joined', STUDENT, 0), event('participant_left', STUDENT, 30)],
      STUDENT,
      at(60).getTime(),
    );
    expect(intervals).toEqual([{ start: at(0).getTime(), end: at(30).getTime() }]);
  });

  it('closes an interval left open, using the supplied close time', () => {
    const intervals = presenceFor([event('participant_joined', STUDENT, 10)], STUDENT, at(50).getTime());
    expect(intervals).toEqual([{ start: at(10).getTime(), end: at(50).getTime() }]);
  });

  it('ignores a duplicate join rather than reading it as a reconnect', () => {
    const intervals = presenceFor(
      [
        event('participant_joined', STUDENT, 0),
        event('participant_joined', STUDENT, 1),
        event('participant_left', STUDENT, 30),
      ],
      STUDENT,
      at(60).getTime(),
    );
    expect(intervals).toEqual([{ start: at(0).getTime(), end: at(30).getTime() }]);
  });

  it('ignores a leave with no matching join', () => {
    expect(presenceFor([event('participant_left', STUDENT, 5)], STUDENT, at(60).getTime())).toEqual([]);
  });

  it('keeps each reconnect as its own interval', () => {
    const intervals = presenceFor(
      [
        event('participant_joined', STUDENT, 0),
        event('participant_left', STUDENT, 10),
        event('participant_joined', STUDENT, 15),
        event('participant_left', STUDENT, 40),
      ],
      STUDENT,
      at(60).getTime(),
    );
    expect(intervals).toHaveLength(2);
  });

  it('does not mix participants up', () => {
    const events = [event('participant_joined', TUTOR, 0), event('participant_left', TUTOR, 30)];
    expect(presenceFor(events, STUDENT, at(60).getTime())).toEqual([]);
  });

  it('accepts events out of order', () => {
    const intervals = presenceFor(
      [event('participant_left', STUDENT, 30), event('participant_joined', STUDENT, 0)],
      STUDENT,
      at(60).getTime(),
    );
    expect(intervals).toEqual([{ start: at(0).getTime(), end: at(30).getTime() }]);
  });
});

describe('a session that went well', () => {
  const events = [
    event('room_started', null, -1),
    event('participant_joined', TUTOR, -2),
    event('participant_joined', STUDENT, 0),
    event('participant_left', STUDENT, 60),
    event('participant_left', TUTOR, 61),
    event('room_finished', null, 61),
  ];

  it('counts the full hour for both', () => {
    const summary = summarise(events);
    expect(summary.studentSeconds).toBe(3_600);
    expect(summary.tutorSeconds).toBe(3_600);
    expect(summary.bothPresentSeconds).toBe(3_600);
  });

  it('does not credit the tutor for joining early', () => {
    // They joined two minutes before the start; only booked time counts.
    expect(summarise(events).tutorSeconds).toBe(3_600);
  });

  it('settles as a completed session', () => {
    const booking: BookingForOutcome = {
      id: 'bk1',
      studentId: STUDENT,
      tutorId: TUTOR,
      isTrial: false,
      priceCents: 2_500,
      commissionBps: 2_000,
      startAtUtc: START,
      durationMinutes: 60,
    };
    const outcome = resolveBookingOutcome(booking, summarise(events));
    expect(outcome.resolution).toBe('completed');
    expect(outcome.tutorCents).toBe(2_000);
  });
});

describe('a student on a bad mobile connection', () => {
  // Drops twice, rejoins twice. This is the case the whole module exists for.
  const events = [
    event('participant_joined', TUTOR, 0),
    event('participant_joined', STUDENT, 0),
    event('participant_left', STUDENT, 12),
    event('participant_joined', STUDENT, 14),
    event('participant_left', STUDENT, 35),
    event('participant_joined', STUDENT, 38),
    event('participant_left', STUDENT, 60),
    event('participant_left', TUTOR, 60),
    event('room_finished', null, 60),
  ];

  it('adds the pieces up instead of counting only the last one', () => {
    const summary = summarise(events);
    // 12 + 21 + 22 = 55 minutes.
    expect(summary.studentSeconds).toBe(55 * 60);
    expect(summary.tutorSeconds).toBe(3_600);
  });

  it('counts overlap, not the longer of the two', () => {
    expect(summarise(events).bothPresentSeconds).toBe(55 * 60);
  });

  it('records the drops, so support and the tutor can see them', () => {
    expect(summarise(events).studentReconnects).toBe(2);
    expect(summarise(events).tutorReconnects).toBe(0);
  });

  it('still completes: five minutes of dropouts is not a failed session', () => {
    const outcome = resolveBookingOutcome(
      {
        id: 'bk1',
        studentId: STUDENT,
        tutorId: TUTOR,
        isTrial: false,
        priceCents: 2_500,
        commissionBps: 2_000,
        startAtUtc: START,
        durationMinutes: 60,
      },
      summarise(events),
    );
    expect(outcome.resolution).toBe('completed');
    expect(outcome.refundCents).toBe(0);
  });
});

describe('a browser that died without saying goodbye', () => {
  it('closes the interval at room_finished', () => {
    const events = [
      event('participant_joined', TUTOR, 0),
      event('participant_joined', STUDENT, 0),
      event('participant_left', TUTOR, 45),
      event('room_finished', null, 45),
    ];
    // The student never sent a leave; the room closing ends it.
    expect(summarise(events).studentSeconds).toBe(45 * 60);
  });

  it('closes at the booked end when the room never finished either', () => {
    const events = [event('participant_joined', TUTOR, 0), event('participant_joined', STUDENT, 0)];
    // A settlement running a day later must not credit an hour of phantom time.
    const summary = summarise(events, new Date(START.getTime() + 25 * 3_600_000));
    expect(summary.studentSeconds).toBe(3_600);
    expect(summary.tutorSeconds).toBe(3_600);
  });

  it('closes at "now" when settlement runs mid-session', () => {
    const events = [event('participant_joined', TUTOR, 0), event('participant_joined', STUDENT, 0)];
    expect(summarise(events, at(20)).studentSeconds).toBe(20 * 60);
  });
});

describe('time outside the booked window', () => {
  it('does not count joining early', () => {
    const events = [
      event('participant_joined', TUTOR, -5),
      event('participant_joined', STUDENT, -5),
      event('participant_left', STUDENT, 30),
      event('participant_left', TUTOR, 30),
      event('room_finished', null, 30),
    ];
    expect(summarise(events).studentSeconds).toBe(30 * 60);
  });

  it('does not count the grace period past the end', () => {
    const events = [
      event('participant_joined', TUTOR, 0),
      event('participant_joined', STUDENT, 0),
      // Ran eight minutes over, inside the ten-minute grace.
      event('participant_left', STUDENT, 68),
      event('participant_left', TUTOR, 68),
      event('room_finished', null, 68),
    ];
    const summary = summarise(events);
    expect(summary.studentSeconds).toBe(3_600);
    expect(summary.bothPresentSeconds).toBe(3_600);
  });
});

describe('no-shows', () => {
  it('measures how long the tutor waited alone', () => {
    const events = [
      event('participant_joined', TUTOR, 0),
      event('participant_left', TUTOR, 15),
      event('room_finished', null, 15),
    ];
    const summary = summarise(events);
    expect(summary.studentSeconds).toBe(0);
    expect(summary.tutorWaitedAloneSeconds).toBe(15 * 60);
  });

  it('a tutor who waited fifteen minutes gets paid (SPEC.md §2)', () => {
    const events = [
      event('participant_joined', TUTOR, 0),
      event('participant_left', TUTOR, 15),
      event('room_finished', null, 15),
    ];
    const outcome = resolveBookingOutcome(
      {
        id: 'bk1',
        studentId: STUDENT,
        tutorId: TUTOR,
        isTrial: false,
        priceCents: 2_500,
        commissionBps: 2_000,
        startAtUtc: START,
        durationMinutes: 60,
      },
      summarise(events),
    );
    expect(outcome.resolution).toBe('no_show_student');
    expect(outcome.tutorCents).toBe(2_000);
  });

  it('a tutor who gave up after four minutes does not', () => {
    const events = [
      event('participant_joined', TUTOR, 0),
      event('participant_left', TUTOR, 4),
      event('room_finished', null, 4),
    ];
    const outcome = resolveBookingOutcome(
      {
        id: 'bk1',
        studentId: STUDENT,
        tutorId: TUTOR,
        isTrial: false,
        priceCents: 2_500,
        commissionBps: 2_000,
        startAtUtc: START,
        durationMinutes: 60,
      },
      summarise(events),
    );
    expect(outcome.resolution).toBe('technical_failure');
    expect(outcome.refundCents).toBe(2_500);
  });

  it('a tutor who never turned up is a tutor no-show', () => {
    const events = [
      event('participant_joined', STUDENT, 0),
      event('participant_left', STUDENT, 20),
      event('room_finished', null, 20),
    ];
    const summary = summarise(events);
    expect(summary.tutorSeconds).toBe(0);
    expect(summary.tutorWaitedAloneSeconds).toBe(0);
  });

  it('nobody joined at all', () => {
    const summary = summarise([event('room_started', null, 0), event('room_finished', null, 10)]);
    expect(summary.studentSeconds).toBe(0);
    expect(summary.tutorSeconds).toBe(0);
    expect(summary.bothPresentSeconds).toBe(0);
  });
});

describe('overlap', () => {
  it('counts only the time both were there', () => {
    const events = [
      event('participant_joined', TUTOR, 0),
      event('participant_joined', STUDENT, 20),
      event('participant_left', TUTOR, 40),
      event('participant_left', STUDENT, 60),
      event('room_finished', null, 60),
    ];
    const summary = summarise(events);
    expect(summary.tutorSeconds).toBe(40 * 60);
    expect(summary.studentSeconds).toBe(40 * 60);
    expect(summary.bothPresentSeconds).toBe(20 * 60);
    expect(summary.tutorWaitedAloneSeconds).toBe(20 * 60);
  });

  it('falls to a technical failure when they barely overlapped', () => {
    const events = [
      event('participant_joined', TUTOR, 0),
      event('participant_left', TUTOR, 25),
      event('participant_joined', STUDENT, 20),
      event('participant_left', STUDENT, 60),
      event('room_finished', null, 60),
    ];
    const outcome = resolveBookingOutcome(
      {
        id: 'bk1',
        studentId: STUDENT,
        tutorId: TUTOR,
        isTrial: false,
        priceCents: 2_500,
        commissionBps: 2_000,
        startAtUtc: START,
        durationMinutes: 60,
      },
      summarise(events),
    );
    // Five minutes together out of sixty.
    expect(outcome.resolution).toBe('technical_failure');
    expect(outcome.refundCents).toBe(2_500);
  });
});
