import { describe, expect, it } from 'vitest';
import {
  applyBpsCeil,
  applyBpsFloor,
  assertInt,
  assertNonNegativeInt,
  clamp,
  divCeil,
  divFloor,
  divRoundHalfUp,
  dollarsToCents,
  formatCents,
  formatCredits,
  MoneyError,
  roundToNearest50,
} from './cents';

describe('assertInt', () => {
  it('accepts integers', () => {
    expect(assertInt(0)).toBe(0);
    expect(assertInt(-1250)).toBe(-1250);
  });

  it('rejects floats — this is the guard that keeps money off the float path', () => {
    expect(() => assertInt(12.5)).toThrow(MoneyError);
    expect(() => assertInt(0.1 + 0.2)).toThrow(MoneyError);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => assertInt(Number.NaN)).toThrow(MoneyError);
    expect(() => assertInt(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });

  it('rejects values beyond the safe integer range', () => {
    expect(() => assertInt(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
  });
});

describe('assertNonNegativeInt', () => {
  it('rejects negatives', () => {
    expect(() => assertNonNegativeInt(-1)).toThrow(MoneyError);
  });
});

describe('divRoundHalfUp', () => {
  it('rounds halves up', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(7, 2)).toBe(4);
    expect(divRoundHalfUp(4, 2)).toBe(2);
    expect(divRoundHalfUp(0, 2)).toBe(0);
  });

  it('matches Math.round on a sweep of halves', () => {
    for (let n = 0; n < 500; n += 1) {
      expect(divRoundHalfUp(n, 2)).toBe(Math.round(n / 2));
    }
  });

  it('rejects a zero denominator', () => {
    expect(() => divRoundHalfUp(10, 0)).toThrow(MoneyError);
  });
});

describe('divFloor and divCeil', () => {
  it('floor rounds down, ceil rounds up', () => {
    expect(divFloor(999, 2)).toBe(499);
    expect(divCeil(999, 2)).toBe(500);
    expect(divFloor(1000, 2)).toBe(500);
    expect(divCeil(1000, 2)).toBe(500);
  });
});

describe('roundToNearest50', () => {
  it('snaps to the nearest 50c step', () => {
    expect(roundToNearest50(1225)).toBe(1250);
    expect(roundToNearest50(1224)).toBe(1200);
    expect(roundToNearest50(1250)).toBe(1250);
    expect(roundToNearest50(0)).toBe(0);
    expect(roundToNearest50(24)).toBe(0);
    expect(roundToNearest50(25)).toBe(50);
  });

  it('always returns a multiple of 50', () => {
    for (let cents = 0; cents < 5_000; cents += 7) {
      expect(roundToNearest50(cents) % 50).toBe(0);
    }
  });
});

describe('applyBpsFloor / applyBpsCeil', () => {
  it('computes a percentage without floats', () => {
    expect(applyBpsFloor(2_500, 2_000)).toBe(500); // 20% of $25.00
    expect(applyBpsFloor(999, 2_000)).toBe(199); // 199.8 -> 199
    expect(applyBpsCeil(999, 2_000)).toBe(200);
  });

  it('handles the 0% and 100% ends', () => {
    expect(applyBpsFloor(1_234, 0)).toBe(0);
    expect(applyBpsFloor(1_234, 10_000)).toBe(1_234);
  });
});

describe('clamp', () => {
  it('pulls values inside the range', () => {
    expect(clamp(5, 10, 20)).toBe(10);
    expect(clamp(25, 10, 20)).toBe(20);
    expect(clamp(15, 10, 20)).toBe(15);
  });

  it('rejects an inverted range', () => {
    expect(() => clamp(15, 20, 10)).toThrow(MoneyError);
  });
});

describe('formatting', () => {
  it('formats cents as dollars', () => {
    expect(formatCents(1_250)).toBe('$12.50');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(-500)).toBe('-$5.00');
    expect(formatCents(10_000)).toBe('$100.00');
  });

  it('formats credits 1:1 with dollars', () => {
    expect(formatCredits(1_000)).toBe('10.00 credits');
  });

  it('converts config dollars to cents', () => {
    expect(dollarsToCents(12.5)).toBe(1_250);
    expect(dollarsToCents(0.1)).toBe(10);
    expect(dollarsToCents(99.5)).toBe(9_950);
  });
});
