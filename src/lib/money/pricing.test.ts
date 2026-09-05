import { describe, expect, it } from 'vitest';
import { MoneyError } from './cents';
import {
  applyCommission,
  assertValidHalfHourCents,
  assertValidHourlyCents,
  DEFAULT_COMMISSION_BPS,
  deriveHalfHourCents,
  effectiveRates,
  halfHourBand,
  HOURLY_CEILING_CENTS,
  HOURLY_FLOOR_CENTS,
  isPromoActive,
  isValidHalfHourCents,
  priceForBooking,
  type TutorRates,
} from './pricing';

const NOW = new Date('2026-03-01T12:00:00.000Z');

function rates(overrides: Partial<TutorRates> = {}): TutorRates {
  return {
    hourlyCents: 2_500,
    halfHourCents: 1_250,
    promoCents: null,
    promoStartsAt: null,
    promoEndsAt: null,
    ...overrides,
  };
}

describe('hourly rate bounds', () => {
  it('accepts the floor and the ceiling', () => {
    expect(assertValidHourlyCents(HOURLY_FLOOR_CENTS)).toBe(500);
    expect(assertValidHourlyCents(HOURLY_CEILING_CENTS)).toBe(20_000);
  });

  it('rejects anything below $5 or above $200', () => {
    expect(() => assertValidHourlyCents(499)).toThrow(MoneyError);
    expect(() => assertValidHourlyCents(20_001)).toThrow(MoneyError);
  });

  it('rejects a non-integer rate', () => {
    expect(() => assertValidHourlyCents(2_500.5)).toThrow(MoneyError);
  });
});

describe('deriveHalfHourCents', () => {
  it('is half the hourly rate rounded to 50c', () => {
    expect(deriveHalfHourCents(2_500)).toBe(1_250);
    expect(deriveHalfHourCents(3_000)).toBe(1_500);
    expect(deriveHalfHourCents(2_999)).toBe(1_500);
    expect(deriveHalfHourCents(2_949)).toBe(1_450);
  });

  it('always lands on a 50c step and inside the 40%-70% band', () => {
    for (let hourly = HOURLY_FLOOR_CENTS; hourly <= HOURLY_CEILING_CENTS; hourly += 13) {
      const half = deriveHalfHourCents(hourly);
      const band = halfHourBand(hourly);
      expect(half).toBeGreaterThanOrEqual(band.minCents);
      expect(half).toBeLessThanOrEqual(band.maxCents);
    }
  });
});

describe('half-hour override band', () => {
  it('permits 40% to 70% of the hourly rate', () => {
    // $25/hr -> band is $10.00 to $17.50
    expect(halfHourBand(2_500)).toEqual({ minCents: 1_000, maxCents: 1_750 });
    expect(isValidHalfHourCents(2_500, 1_000)).toBe(true);
    expect(isValidHalfHourCents(2_500, 1_750)).toBe(true);
  });

  it('blocks the "30 minutes costs the same as 60" trick', () => {
    expect(isValidHalfHourCents(2_500, 2_500)).toBe(false);
    expect(isValidHalfHourCents(2_500, 1_751)).toBe(false);
    expect(() => assertValidHalfHourCents(2_500, 2_500)).toThrow(MoneyError);
  });

  it('blocks an implausibly cheap half hour', () => {
    expect(isValidHalfHourCents(2_500, 999)).toBe(false);
  });
});

describe('promos', () => {
  it('is inactive with no promo set', () => {
    expect(isPromoActive(rates(), NOW)).toBe(false);
  });

  it('is inactive before it starts and after it ends', () => {
    const promo = rates({
      promoCents: 2_000,
      promoStartsAt: new Date('2026-03-02T00:00:00.000Z'),
      promoEndsAt: new Date('2026-03-10T00:00:00.000Z'),
    });
    expect(isPromoActive(promo, NOW)).toBe(false);
    expect(isPromoActive(promo, new Date('2026-03-05T00:00:00.000Z'))).toBe(true);
    expect(isPromoActive(promo, new Date('2026-03-10T00:00:00.000Z'))).toBe(false);
  });

  it('ignores a "promo" that is not actually cheaper', () => {
    expect(isPromoActive(rates({ promoCents: 2_500 }), NOW)).toBe(false);
    expect(isPromoActive(rates({ promoCents: 3_000 }), NOW)).toBe(false);
  });

  it('discounts the half-hour rate by the same ratio', () => {
    // $25/hr, $12.50 per half hour, promo down to $20/hr -> $10.00 per half hour.
    const promo = rates({ promoCents: 2_000 });
    expect(effectiveRates(promo, NOW)).toEqual({
      hourlyCents: 2_000,
      halfHourCents: 1_000,
      isPromo: true,
    });
  });

  it('keeps the promo half-hour rate inside the band', () => {
    const promo = rates({ hourlyCents: 10_000, halfHourCents: 7_000, promoCents: 5_000 });
    const effective = effectiveRates(promo, NOW);
    const band = halfHourBand(5_000);
    expect(effective.halfHourCents).toBeGreaterThanOrEqual(band.minCents);
    expect(effective.halfHourCents).toBeLessThanOrEqual(band.maxCents);
  });
});

describe('priceForBooking', () => {
  it('prices 60 minutes at the hourly rate', () => {
    expect(priceForBooking({ rates: rates(), durationMinutes: 60, isTrial: false, now: NOW })).toEqual({
      priceCents: 2_500,
      listPriceCents: 2_500,
      isPromo: false,
    });
  });

  it('prices 30 minutes at the half-hour rate', () => {
    expect(priceForBooking({ rates: rates(), durationMinutes: 30, isTrial: false, now: NOW })).toEqual({
      priceCents: 1_250,
      listPriceCents: 1_250,
      isPromo: false,
    });
  });

  it('prices a trial at zero', () => {
    expect(priceForBooking({ rates: rates(), durationMinutes: 30, isTrial: true, now: NOW })).toEqual({
      priceCents: 0,
      listPriceCents: 0,
      isPromo: false,
    });
  });

  it('returns the list price alongside the promo price so the feed can strike it through', () => {
    const promo = rates({ promoCents: 2_000 });
    expect(priceForBooking({ rates: promo, durationMinutes: 60, isTrial: false, now: NOW })).toEqual({
      priceCents: 2_000,
      listPriceCents: 2_500,
      isPromo: true,
    });
  });

  it('rejects a duration that is not 30 or 60 minutes', () => {
    expect(() =>
      priceForBooking({ rates: rates(), durationMinutes: 45 as 30, isTrial: false, now: NOW }),
    ).toThrow(MoneyError);
  });

  it('rejects a tutor whose stored half-hour rate is out of band', () => {
    expect(() =>
      priceForBooking({
        rates: rates({ halfHourCents: 2_500 }),
        durationMinutes: 30,
        isTrial: false,
        now: NOW,
      }),
    ).toThrow(MoneyError);
  });
});

describe('applyCommission', () => {
  it('takes 20% by default and gives the rest to the tutor', () => {
    expect(applyCommission(2_500, DEFAULT_COMMISSION_BPS)).toEqual({
      platformCents: 500,
      tutorCents: 2_000,
    });
  });

  it('supports a negotiated 15% rate', () => {
    expect(applyCommission(2_500, 1_500)).toEqual({ platformCents: 375, tutorCents: 2_125 });
  });

  it('gives the rounding remainder to the tutor', () => {
    // 20% of 999 is 199.8. The platform floors to 199, the tutor keeps 800.
    expect(applyCommission(999, 2_000)).toEqual({ platformCents: 199, tutorCents: 800 });
  });

  it('always splits the input exactly, with no cent created or lost', () => {
    for (let amount = 0; amount <= 20_000; amount += 7) {
      for (const bps of [0, 1_500, 2_000, 3_333, 10_000]) {
        const split = applyCommission(amount, bps);
        expect(split.platformCents + split.tutorCents).toBe(amount);
        expect(split.platformCents).toBeGreaterThanOrEqual(0);
        expect(split.tutorCents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('handles a zero charge', () => {
    expect(applyCommission(0, 2_000)).toEqual({ platformCents: 0, tutorCents: 0 });
  });

  it('rejects a commission above 100%', () => {
    expect(() => applyCommission(1_000, 10_001)).toThrow(MoneyError);
  });
});
