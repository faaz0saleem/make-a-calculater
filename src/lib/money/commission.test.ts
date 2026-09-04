import { describe, expect, it } from 'vitest';

import {
  FIRST_BOOKING_COMMISSION_BPS,
  REBOOKING_COMMISSION_BPS,
  commissionBpsFor,
  describeCommission,
} from './commission';

describe('commissionBpsFor', () => {
  it('takes 20% on a first booking and 15% on a rebooking', () => {
    expect(commissionBpsFor(false)).toBe(2_000);
    expect(commissionBpsFor(true)).toBe(1_500);
  });

  it('always leaves the tutor with more of a returning student', () => {
    const price = 5_000;
    const first = price - Math.floor((price * FIRST_BOOKING_COMMISSION_BPS) / 10_000);
    const again = price - Math.floor((price * REBOOKING_COMMISSION_BPS) / 10_000);
    expect(again).toBeGreaterThan(first);
    expect(again - first).toBe(250);
  });
});

describe('a negotiated rate, as a floor', () => {
  it('never makes a tutor pay more than they were promised', () => {
    // Recruited on 12%: 12% on a first session, 12% on a rebooking.
    expect(commissionBpsFor(false, 1_200)).toBe(1_200);
    expect(commissionBpsFor(true, 1_200)).toBe(1_200);
  });

  it('does not let a high negotiated rate override the retention discount', () => {
    // The column defaults to 2000, so for most tutors the floor never binds.
    expect(commissionBpsFor(false, 2_000)).toBe(2_000);
    expect(commissionBpsFor(true, 2_000)).toBe(1_500);
    expect(commissionBpsFor(true, 9_000)).toBe(1_500);
  });

  it('takes the lower of the two at the boundary', () => {
    expect(commissionBpsFor(false, 1_500)).toBe(1_500);
    expect(commissionBpsFor(true, 1_500)).toBe(1_500);
  });

  it('falls back to the retention rate when there is nothing negotiated', () => {
    expect(commissionBpsFor(false, null)).toBe(2_000);
    expect(commissionBpsFor(true, undefined)).toBe(1_500);
  });

  it('ignores a nonsense value rather than charging it', () => {
    expect(commissionBpsFor(false, -100)).toBe(2_000);
    expect(commissionBpsFor(true, 12.5)).toBe(1_500);
  });
});

describe('describeCommission', () => {
  it('says which rate a tutor is on, in their terms', () => {
    expect(describeCommission(REBOOKING_COMMISSION_BPS)).toContain('returning-student');
    expect(describeCommission(FIRST_BOOKING_COMMISSION_BPS)).toContain('first session');
    expect(describeCommission(1_200)).toContain('negotiated');
  });
});
