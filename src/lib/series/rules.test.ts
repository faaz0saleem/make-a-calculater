import { describe, expect, it } from 'vitest';

import { FIRST_BOOKING_COMMISSION_BPS, REBOOKING_COMMISSION_BPS } from '@/lib/money/commission';
import {
  chargeDueAt,
  commissionForOccurrence,
  END_NOTICE_DAYS,
  monthlyCommitmentCents,
  noticeEndsOn,
  warnDueAt,
} from './rules';

describe('commission across a series', () => {
  it('charges the first-session rate once and the rebooking rate after', () => {
    expect(commissionForOccurrence(0, false)).toBe(FIRST_BOOKING_COMMISSION_BPS);
    expect(commissionForOccurrence(1, false)).toBe(REBOOKING_COMMISSION_BPS);
    expect(commissionForOccurrence(7, false)).toBe(REBOOKING_COMMISSION_BPS);
  });

  it('does not re-charge the first-session rate to somebody already returning', () => {
    expect(commissionForOccurrence(0, true)).toBe(REBOOKING_COMMISSION_BPS);
  });

  /**
   * The reason this is index-based rather than a database question: four weeks
   * are materialised at once, before any of them has happened. Asking "has a
   * session completed?" would answer no eight times and price a month of
   * committed work at the acquisition rate.
   */
  it('does not price a whole committed month at the first-session rate', () => {
    const month = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => commissionForOccurrence(index, false));
    expect(month.filter((rate) => rate === FIRST_BOOKING_COMMISSION_BPS)).toHaveLength(1);
  });

  it('still honours a negotiated floor', () => {
    expect(commissionForOccurrence(0, false, 1_200)).toBe(1_200);
    expect(commissionForOccurrence(3, false, 1_200)).toBe(1_200);
    // And never lets a high negotiated rate override the retention discount.
    expect(commissionForOccurrence(3, false, 9_000)).toBe(REBOOKING_COMMISSION_BPS);
  });

  it('ignores a nonsense negotiated rate', () => {
    expect(commissionForOccurrence(0, false, 0)).toBe(FIRST_BOOKING_COMMISSION_BPS);
    expect(commissionForOccurrence(0, false, -5)).toBe(FIRST_BOOKING_COMMISSION_BPS);
  });
});

describe('when money moves', () => {
  const start = new Date('2026-09-15T13:00:00Z');

  it('takes credits 48 hours before, not a month up front', () => {
    expect(chargeDueAt(start).toISOString()).toBe('2026-09-13T13:00:00.000Z');
  });

  it('warns a day before it charges, so there is time to top up', () => {
    expect(warnDueAt(start).toISOString()).toBe('2026-09-12T13:00:00.000Z');
    expect(warnDueAt(start).getTime()).toBeLessThan(chargeDueAt(start).getTime());
  });
});

describe('ending a series', () => {
  it('gives a full week, so nobody loses a session they planned around', () => {
    expect(noticeEndsOn('2026-09-08')).toBe('2026-09-15');
    expect(END_NOTICE_DAYS).toBe(7);
  });

  it('crosses a month boundary without arithmetic on month numbers', () => {
    expect(noticeEndsOn('2026-09-28')).toBe('2026-10-05');
    expect(noticeEndsOn('2026-12-29')).toBe('2027-01-05');
  });
});

describe('what a commitment costs', () => {
  it('is the sticker a student should see before agreeing to one', () => {
    // Three sessions a week at $13.70 — the Lahore quote, in cents.
    expect(monthlyCommitmentCents(1_370, 3)).toBe(16_440);
  });
});
