import { describe, expect, it } from 'vitest';

import {
  FIRST_BOOKING_COMMISSION_BPS,
  REBOOKING_COMMISSION_BPS,
  commissionBpsFor,
  describeCommission,
  takeHomeFor,
} from './commission';

describe('commissionBpsFor', () => {
  it('takes 22% on a first booking and 16% on a rebooking', () => {
    expect(commissionBpsFor(false)).toBe(2_200);
    expect(commissionBpsFor(true)).toBe(1_600);
  });

  it('always leaves the tutor with more of a returning student', () => {
    const price = 5_000;
    const first = price - Math.floor((price * FIRST_BOOKING_COMMISSION_BPS) / 10_000);
    const again = price - Math.floor((price * REBOOKING_COMMISSION_BPS) / 10_000);
    expect(again).toBeGreaterThan(first);
    expect(again - first).toBe(300);
  });
});

describe('a negotiated rate, as a floor', () => {
  it('never makes a tutor pay more than they were promised', () => {
    // Recruited on 12%: 12% on a first session, 12% on a rebooking.
    expect(commissionBpsFor(false, 1_200)).toBe(1_200);
    expect(commissionBpsFor(true, 1_200)).toBe(1_200);
  });

  it('does not let a high negotiated rate override the retention discount', () => {
    expect(commissionBpsFor(false, 2_000)).toBe(2_000);
    expect(commissionBpsFor(true, 2_000)).toBe(1_600);
    expect(commissionBpsFor(true, 9_000)).toBe(1_600);
  });

  it('takes the lower of the two at the boundary', () => {
    expect(commissionBpsFor(false, 1_600)).toBe(1_600);
    expect(commissionBpsFor(true, 1_600)).toBe(1_600);
  });

  it('falls back to the retention rate when there is nothing negotiated', () => {
    // Which is what most tutors have. The column used to default to 2000, and
    // that default would now cap everybody at a rate we no longer charge.
    expect(commissionBpsFor(false, null)).toBe(2_200);
    expect(commissionBpsFor(true, undefined)).toBe(1_600);
  });

  it('ignores a nonsense value rather than charging it', () => {
    expect(commissionBpsFor(false, -100)).toBe(2_200);
    expect(commissionBpsFor(true, 12.5)).toBe(1_600);
  });
});

describe('takeHomeFor', () => {
  it('tells a tutor what actually reaches them, both ways', () => {
    // The number the rate screen shows: $8.00 an hour is not $8.00 of income.
    const take = takeHomeFor(800);
    expect(take.firstCents).toBe(624);
    expect(take.rebookingCents).toBe(672);
    expect(take.negotiated).toBe(false);
  });

  it('is honest about the floor of the price band', () => {
    // $5 an hour leaves $3.90 for a first lesson. Showing that is a better
    // argument against pricing there than a rule forbidding it.
    expect(takeHomeFor(500).firstCents).toBe(390);
  });

  it('shows a negotiated rate as one number, because it is one number', () => {
    const take = takeHomeFor(800, 1_200);
    expect(take.firstBps).toBe(1_200);
    expect(take.rebookingBps).toBe(1_200);
    expect(take.firstCents).toBe(take.rebookingCents);
    expect(take.negotiated).toBe(true);
  });

  it('does not call the ordinary retention rates a negotiation', () => {
    expect(takeHomeFor(800, null).negotiated).toBe(false);
    expect(takeHomeFor(800, 9_000).negotiated).toBe(false);
  });

  it('never loses a cent between the two halves', () => {
    for (const price of [500, 799, 1_237, 8_000, 20_000]) {
      const take = takeHomeFor(price);
      expect(take.firstCents).toBeLessThan(price);
      expect(take.rebookingCents).toBeGreaterThan(take.firstCents);
    }
  });
});

describe('describeCommission', () => {
  it('says which rate a tutor is on, in their terms', () => {
    expect(describeCommission(REBOOKING_COMMISSION_BPS)).toContain('returning-student');
    expect(describeCommission(FIRST_BOOKING_COMMISSION_BPS)).toContain('first session');
    expect(describeCommission(1_200)).toContain('negotiated');
  });
});
