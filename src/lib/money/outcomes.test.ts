/**
 * Every row of the cancellation and no-show table in SPEC.md §2 gets a test here,
 * plus the boundaries between the rows and the acceptance tests from §16.
 */

import { describe, expect, it } from 'vitest';
import { MoneyError } from './cents';
import { assertBalanced, projectBalances, type LedgerEntryDraft } from './ledger';
import {
  classifyOutcome,
  minutesBeforeStart,
  requiredOverlapSeconds,
  resolveBookingOutcome,
  type Attendance,
  type BookingForOutcome,
} from './outcomes';

const START = new Date('2026-04-15T18:00:00.000Z');

/** A $25.00, 60-minute booking at the default 20% take rate. */
function booking(overrides: Partial<BookingForOutcome> = {}): BookingForOutcome {
  return {
    id: 'bk_1',
    studentId: 'user_student',
    tutorId: 'user_tutor',
    isTrial: false,
    priceCents: 2_500,
    commissionBps: 2_000,
    startAtUtc: START,
    durationMinutes: 60,
    ...overrides,
  };
}

function cancelledAt(minutesBefore: number): Attendance {
  return {
    kind: 'cancellation',
    by: 'student',
    atUtc: new Date(START.getTime() - minutesBefore * 60_000),
  };
}

/** A session both parties attended for the whole hour. */
const FULL_ATTENDANCE: Attendance = {
  kind: 'session',
  studentSeconds: 3_600,
  tutorSeconds: 3_600,
  bothPresentSeconds: 3_600,
  tutorWaitedAloneSeconds: 0,
};

function amountFor(entries: LedgerEntryDraft[], account: string, ownerId: string | null): number {
  return projectBalances(entries).get(`${account}:${ownerId ?? 'platform'}` as never) ?? 0;
}

describe('minutesBeforeStart', () => {
  it('counts whole minutes of notice and goes negative after the start', () => {
    expect(minutesBeforeStart(START, new Date(START.getTime() - 90 * 60_000))).toBe(90);
    expect(minutesBeforeStart(START, START)).toBe(0);
    expect(minutesBeforeStart(START, new Date(START.getTime() + 60_000))).toBe(-1);
  });
});

describe('requiredOverlapSeconds', () => {
  it('is half the booked duration', () => {
    expect(requiredOverlapSeconds(60)).toBe(1_800);
    expect(requiredOverlapSeconds(30)).toBe(900);
    expect(requiredOverlapSeconds(15)).toBe(450);
  });
});

// ---------------------------------------------------------------------------
// Policy table, row by row
// ---------------------------------------------------------------------------

describe('policy: session completed', () => {
  it('charges in full and splits by commission', () => {
    const outcome = resolveBookingOutcome(booking(), FULL_ATTENDANCE);
    expect(outcome.resolution).toBe('completed');
    expect(outcome.terminalStatus).toBe('settled');
    expect(outcome.refundCents).toBe(0);
    expect(outcome.chargeableCents).toBe(2_500);
    expect(outcome.tutorCents).toBe(2_000);
    expect(outcome.platformCents).toBe(500);
    expect(outcome.tutorStrike).toBe(false);
    expect(outcome.freeSessionCredit).toBe(false);
  });

  it('empties escrow into the tutor and the platform', () => {
    const { entries } = resolveBookingOutcome(booking(), FULL_ATTENDANCE);
    expect(amountFor(entries, 'escrow', 'user_student')).toBe(-2_500);
    expect(amountFor(entries, 'tutor_pending', 'user_tutor')).toBe(2_000);
    expect(amountFor(entries, 'platform_revenue', null)).toBe(500);
    expect(amountFor(entries, 'student_credits', 'user_student')).toBe(0);
    assertBalanced(entries);
  });
});

describe('policy: student cancels more than 24h before', () => {
  it('refunds 100% and pays the tutor nothing', () => {
    const outcome = resolveBookingOutcome(booking(), cancelledAt(24 * 60 + 1));
    expect(outcome.resolution).toBe('cancelled_by_student');
    expect(outcome.terminalStatus).toBe('cancelled_by_student');
    expect(outcome.refundCents).toBe(2_500);
    expect(outcome.tutorCents).toBe(0);
    expect(outcome.platformCents).toBe(0);
    expect(outcome.tutorStrike).toBe(false);
    expect(amountFor(outcome.entries, 'student_credits', 'user_student')).toBe(2_500);
  });

  it('refunds 100% a week out', () => {
    expect(resolveBookingOutcome(booking(), cancelledAt(7 * 24 * 60)).refundCents).toBe(2_500);
  });
});

describe('policy: student cancels 2-24h before', () => {
  it('refunds 50% and gives the tutor 50% of their share', () => {
    const outcome = resolveBookingOutcome(booking(), cancelledAt(12 * 60));
    expect(outcome.refundCents).toBe(1_250);
    expect(outcome.chargeableCents).toBe(1_250);
    expect(outcome.tutorCents).toBe(1_000); // half of the $20 they would have earned
    expect(outcome.platformCents).toBe(250);
    expect(outcome.tutorStrike).toBe(false);
  });

  it('treats exactly 24h as the 50% band', () => {
    expect(resolveBookingOutcome(booking(), cancelledAt(24 * 60)).refundCents).toBe(1_250);
  });

  it('treats exactly 2h as the 50% band', () => {
    expect(resolveBookingOutcome(booking(), cancelledAt(2 * 60)).refundCents).toBe(1_250);
  });

  it('rounds a half refund in the student\'s favour', () => {
    // $9.99 booking: the student gets $5.00 back, the platform and tutor share $4.99.
    const outcome = resolveBookingOutcome(booking({ priceCents: 999 }), cancelledAt(12 * 60));
    expect(outcome.refundCents).toBe(500);
    expect(outcome.chargeableCents).toBe(499);
    expect(outcome.tutorCents).toBe(400);
    expect(outcome.platformCents).toBe(99);
  });
});

describe('policy: student cancels less than 2h before', () => {
  it('refunds nothing and pays the tutor their full share (SPEC.md §16)', () => {
    const outcome = resolveBookingOutcome(booking(), cancelledAt(90));
    expect(outcome.refundCents).toBe(0);
    expect(outcome.chargeableCents).toBe(2_500);
    expect(outcome.tutorCents).toBe(2_000);
    expect(outcome.platformCents).toBe(500);
    expect(outcome.entries.some((entry) => entry.account === 'student_credits')).toBe(false);
  });

  it('treats a cancellation after the start time the same way', () => {
    expect(resolveBookingOutcome(booking(), cancelledAt(-30)).refundCents).toBe(0);
  });
});

describe('policy: tutor cancels', () => {
  it('refunds 100% and takes a strike, whenever it happens', () => {
    for (const minutes of [10, 60, 24 * 60, 7 * 24 * 60]) {
      const outcome = resolveBookingOutcome(booking(), {
        kind: 'cancellation',
        by: 'tutor',
        atUtc: new Date(START.getTime() - minutes * 60_000),
      });
      expect(outcome.resolution).toBe('cancelled_by_tutor');
      expect(outcome.refundCents).toBe(2_500);
      expect(outcome.tutorCents).toBe(0);
      expect(outcome.platformCents).toBe(0);
      expect(outcome.tutorStrike).toBe(true);
      expect(outcome.freeSessionCredit).toBe(false);
    }
  });
});

describe('policy: student no-show', () => {
  it('charges in full when the tutor joined and waited ten minutes', () => {
    const outcome = resolveBookingOutcome(booking(), {
      kind: 'session',
      studentSeconds: 0,
      tutorSeconds: 900,
      bothPresentSeconds: 0,
      tutorWaitedAloneSeconds: 900,
    });
    expect(outcome.resolution).toBe('no_show_student');
    expect(outcome.terminalStatus).toBe('settled');
    expect(outcome.refundCents).toBe(0);
    expect(outcome.tutorCents).toBe(2_000);
    expect(outcome.platformCents).toBe(500);
    expect(outcome.tutorStrike).toBe(false);
  });

  it('counts exactly ten minutes of waiting', () => {
    const outcome = resolveBookingOutcome(booking(), {
      kind: 'session',
      studentSeconds: 0,
      tutorSeconds: 600,
      bothPresentSeconds: 0,
      tutorWaitedAloneSeconds: 600,
    });
    expect(outcome.resolution).toBe('no_show_student');
  });

  it('refunds the student if the tutor gave up before ten minutes', () => {
    const outcome = resolveBookingOutcome(booking(), {
      kind: 'session',
      studentSeconds: 0,
      tutorSeconds: 300,
      bothPresentSeconds: 0,
      tutorWaitedAloneSeconds: 300,
    });
    expect(outcome.resolution).toBe('technical_failure');
    expect(outcome.refundCents).toBe(2_500);
    expect(outcome.tutorStrike).toBe(false);
  });
});

describe('policy: tutor no-show', () => {
  it('fully refunds the student, grants a free session and strikes the tutor (SPEC.md §16)', () => {
    const outcome = resolveBookingOutcome(booking(), {
      kind: 'session',
      studentSeconds: 1_200,
      tutorSeconds: 0,
      bothPresentSeconds: 0,
      tutorWaitedAloneSeconds: 0,
    });
    expect(outcome.resolution).toBe('no_show_tutor');
    expect(outcome.terminalStatus).toBe('refunded');
    expect(outcome.refundCents).toBe(2_500);
    expect(outcome.tutorCents).toBe(0);
    expect(outcome.platformCents).toBe(0);
    expect(outcome.tutorStrike).toBe(true);
    expect(outcome.freeSessionCredit).toBe(true);
    expect(amountFor(outcome.entries, 'student_credits', 'user_student')).toBe(2_500);
  });

  it('is a tutor no-show even when neither party joined', () => {
    expect(
      classifyOutcome(booking(), {
        kind: 'session',
        studentSeconds: 0,
        tutorSeconds: 0,
        bothPresentSeconds: 0,
        tutorWaitedAloneSeconds: 0,
      }),
    ).toBe('no_show_tutor');
  });
});

describe('policy: technical failure', () => {
  it('refunds in full with no strike when the overlap is under 50%', () => {
    const outcome = resolveBookingOutcome(booking(), {
      kind: 'session',
      studentSeconds: 1_700,
      tutorSeconds: 1_700,
      bothPresentSeconds: 1_799, // one second short of half an hour
      tutorWaitedAloneSeconds: 0,
    });
    expect(outcome.resolution).toBe('technical_failure');
    expect(outcome.terminalStatus).toBe('refunded');
    expect(outcome.refundCents).toBe(2_500);
    expect(outcome.tutorStrike).toBe(false);
    expect(outcome.freeSessionCredit).toBe(false);
  });

  it('completes at exactly 50% overlap', () => {
    const outcome = resolveBookingOutcome(booking(), {
      kind: 'session',
      studentSeconds: 1_800,
      tutorSeconds: 1_800,
      bothPresentSeconds: 1_800,
      tutorWaitedAloneSeconds: 0,
    });
    expect(outcome.resolution).toBe('completed');
  });

  it('uses the booked duration, not the wall clock, for the 50% test', () => {
    // A 30-minute booking needs only 15 minutes of overlap.
    const outcome = resolveBookingOutcome(booking({ durationMinutes: 30, priceCents: 1_250 }), {
      kind: 'session',
      studentSeconds: 900,
      tutorSeconds: 900,
      bothPresentSeconds: 900,
      tutorWaitedAloneSeconds: 0,
    });
    expect(outcome.resolution).toBe('completed');
    expect(outcome.tutorCents).toBe(1_000);
    expect(outcome.platformCents).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

describe('settlement invariants', () => {
  const attendances: Attendance[] = [
    FULL_ATTENDANCE,
    cancelledAt(48 * 60),
    cancelledAt(12 * 60),
    cancelledAt(30),
    { kind: 'cancellation', by: 'tutor', atUtc: new Date(START.getTime() - 60_000) },
    {
      kind: 'session',
      studentSeconds: 0,
      tutorSeconds: 900,
      bothPresentSeconds: 0,
      tutorWaitedAloneSeconds: 900,
    },
    {
      kind: 'session',
      studentSeconds: 900,
      tutorSeconds: 0,
      bothPresentSeconds: 0,
      tutorWaitedAloneSeconds: 0,
    },
    {
      kind: 'session',
      studentSeconds: 60,
      tutorSeconds: 60,
      bothPresentSeconds: 60,
      tutorWaitedAloneSeconds: 0,
    },
  ];

  it('always nets to zero and never creates or destroys a cent', () => {
    for (const price of [500, 999, 1_250, 2_500, 9_999, 20_000]) {
      for (const bps of [0, 1_500, 2_000, 3_333]) {
        for (const attendance of attendances) {
          const outcome = resolveBookingOutcome(booking({ priceCents: price, commissionBps: bps }), attendance);
          assertBalanced(outcome.entries);
          expect(outcome.refundCents + outcome.tutorCents + outcome.platformCents).toBe(price);
          expect(outcome.refundCents).toBeGreaterThanOrEqual(0);
          expect(outcome.tutorCents).toBeGreaterThanOrEqual(0);
          expect(outcome.platformCents).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('gives every entry a distinct, replay-safe idempotency key', () => {
    const outcome = resolveBookingOutcome(booking(), cancelledAt(12 * 60));
    const keys = outcome.entries.map((entry) => entry.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key.startsWith('booking:bk_1:settle:')).toBe(true);
    }
  });

  it('produces byte-identical entries when replayed', () => {
    const first = resolveBookingOutcome(booking(), cancelledAt(12 * 60));
    const second = resolveBookingOutcome(booking(), cancelledAt(12 * 60));
    expect(second.entries).toEqual(first.entries);
  });
});

describe('trials', () => {
  const trial = booking({ isTrial: true, priceCents: 0, durationMinutes: 15 });

  it('moves no money at all', () => {
    const outcome = resolveBookingOutcome(trial, {
      kind: 'session',
      studentSeconds: 900,
      tutorSeconds: 900,
      bothPresentSeconds: 900,
      tutorWaitedAloneSeconds: 0,
    });
    expect(outcome.resolution).toBe('completed');
    expect(outcome.entries).toEqual([]);
    expect(outcome.refundCents).toBe(0);
    expect(outcome.tutorCents).toBe(0);
  });

  it('still strikes a tutor who does not turn up to a trial', () => {
    const outcome = resolveBookingOutcome(trial, {
      kind: 'session',
      studentSeconds: 300,
      tutorSeconds: 0,
      bothPresentSeconds: 0,
      tutorWaitedAloneSeconds: 0,
    });
    expect(outcome.tutorStrike).toBe(true);
    expect(outcome.entries).toEqual([]);
  });

  it('refuses a trial that somehow carries a price', () => {
    expect(() => resolveBookingOutcome(booking({ isTrial: true, priceCents: 100 }), FULL_ATTENDANCE)).toThrow(
      MoneyError,
    );
  });
});
