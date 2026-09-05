/**
 * Tutor pricing (SPEC.md §2).
 *
 * A tutor sets a 60-minute rate between $5 and $200. The 30-minute rate is
 * derived from it and may be overridden inside a 40%-70% band, so nobody can
 * charge the same for half the time.
 *
 * Nothing here touches the database. The booking row snapshots whatever these
 * functions return at creation time, so a later rate change cannot reprice a
 * confirmed booking.
 */

import {
  applyBpsCeil,
  applyBpsFloor,
  assertNonNegativeInt,
  clamp,
  divRoundHalfUp,
  MoneyError,
  roundToNearest50,
} from './cents';

export const HOURLY_FLOOR_CENTS = 500; // $5.00
export const HOURLY_CEILING_CENTS = 20_000; // $200.00

export const HALF_HOUR_MIN_BPS = 4_000; // 40% of the hourly rate
export const HALF_HOUR_MAX_BPS = 7_000; // 70% of the hourly rate

export const DEFAULT_COMMISSION_BPS = 2_000; // 20% platform take rate
export const MAX_COMMISSION_BPS = 10_000;

export const BOOKABLE_DURATIONS = [30, 60] as const;
export type BookableDuration = (typeof BOOKABLE_DURATIONS)[number];

export type TutorRates = {
  hourlyCents: number;
  halfHourCents: number;
  /** Promotional 60-minute rate, or null when the tutor has no promo set. */
  promoCents: number | null;
  promoStartsAt: Date | null;
  promoEndsAt: Date | null;
};

export type BookingPrice = {
  /** What the student is charged, after any active promo. */
  priceCents: number;
  /** The undiscounted price. Shown struck through in the feed when promoted. */
  listPriceCents: number;
  isPromo: boolean;
};

export function isValidHourlyCents(hourlyCents: number): boolean {
  return (
    Number.isInteger(hourlyCents) &&
    hourlyCents >= HOURLY_FLOOR_CENTS &&
    hourlyCents <= HOURLY_CEILING_CENTS
  );
}

export function assertValidHourlyCents(hourlyCents: number): number {
  if (!isValidHourlyCents(hourlyCents)) {
    throw new MoneyError(
      `hourly rate must be an integer between ${HOURLY_FLOOR_CENTS} and ${HOURLY_CEILING_CENTS} cents, got ${hourlyCents}`,
    );
  }
  return hourlyCents;
}

/** The inclusive 30-minute price band a tutor may choose inside. */
export function halfHourBand(hourlyCents: number): { minCents: number; maxCents: number } {
  assertValidHourlyCents(hourlyCents);
  return {
    minCents: applyBpsCeil(hourlyCents, HALF_HOUR_MIN_BPS),
    maxCents: applyBpsFloor(hourlyCents, HALF_HOUR_MAX_BPS),
  };
}

/**
 * The default 30-minute rate: half the hourly rate rounded to the nearest 50c,
 * then pulled inside the 40%-70% band if rounding pushed it out.
 *
 * `roundToNearest50(hourly / 2)` collapses to `round(hourly / 100) * 50`.
 */
export function deriveHalfHourCents(hourlyCents: number): number {
  assertValidHourlyCents(hourlyCents);
  const halved = divRoundHalfUp(hourlyCents, 100) * 50;
  const { minCents, maxCents } = halfHourBand(hourlyCents);
  return clamp(halved, minCents, maxCents);
}

export function isValidHalfHourCents(hourlyCents: number, halfHourCents: number): boolean {
  if (!Number.isInteger(halfHourCents) || halfHourCents <= 0) return false;
  if (!isValidHourlyCents(hourlyCents)) return false;
  const { minCents, maxCents } = halfHourBand(hourlyCents);
  return halfHourCents >= minCents && halfHourCents <= maxCents;
}

export function assertValidHalfHourCents(hourlyCents: number, halfHourCents: number): number {
  if (!isValidHalfHourCents(hourlyCents, halfHourCents)) {
    const { minCents, maxCents } = halfHourBand(hourlyCents);
    throw new MoneyError(
      `30-minute rate must be between ${minCents} and ${maxCents} cents for an hourly rate of ${hourlyCents}, got ${halfHourCents}`,
    );
  }
  return halfHourCents;
}

export function isPromoActive(rates: TutorRates, now: Date): boolean {
  if (rates.promoCents === null) return false;
  if (rates.promoCents >= rates.hourlyCents) return false; // not a discount
  if (rates.promoStartsAt && now.getTime() < rates.promoStartsAt.getTime()) return false;
  if (rates.promoEndsAt && now.getTime() >= rates.promoEndsAt.getTime()) return false;
  return true;
}

/**
 * The rates a student actually sees right now.
 *
 * A promo discounts the 60-minute rate. The 30-minute rate is discounted by the
 * same ratio so a tutor's chosen hourly-to-half-hour relationship is preserved,
 * then rounded to 50c and clamped back into the band.
 */
export function effectiveRates(
  rates: TutorRates,
  now: Date,
): { hourlyCents: number; halfHourCents: number; isPromo: boolean } {
  if (!isPromoActive(rates, now) || rates.promoCents === null) {
    return { hourlyCents: rates.hourlyCents, halfHourCents: rates.halfHourCents, isPromo: false };
  }

  const promoHourly = assertValidHourlyCents(rates.promoCents);
  const scaled = divRoundHalfUp(promoHourly * rates.halfHourCents, rates.hourlyCents);
  const { minCents, maxCents } = halfHourBand(promoHourly);
  const promoHalfHour = clamp(roundToNearest50(scaled), minCents, maxCents);

  return { hourlyCents: promoHourly, halfHourCents: promoHalfHour, isPromo: true };
}

export type PriceForBookingInput = {
  rates: TutorRates;
  durationMinutes: BookableDuration;
  isTrial: boolean;
  now: Date;
};

/**
 * The price to snapshot onto a booking row.
 *
 * Trials are free and move no money at all (SPEC.md §6), so they price to zero
 * regardless of the tutor's rates.
 */
export function priceForBooking(input: PriceForBookingInput): BookingPrice {
  const { rates, durationMinutes, isTrial, now } = input;

  if (isTrial) {
    return { priceCents: 0, listPriceCents: 0, isPromo: false };
  }

  if (durationMinutes !== 30 && durationMinutes !== 60) {
    throw new MoneyError(`bookings are 30 or 60 minutes, got ${durationMinutes}`);
  }

  assertValidHourlyCents(rates.hourlyCents);
  assertValidHalfHourCents(rates.hourlyCents, rates.halfHourCents);

  const effective = effectiveRates(rates, now);
  const priceCents = durationMinutes === 60 ? effective.hourlyCents : effective.halfHourCents;
  const listPriceCents = durationMinutes === 60 ? rates.hourlyCents : rates.halfHourCents;

  return { priceCents, listPriceCents, isPromo: effective.isPromo };
}

export type CommissionSplit = {
  /** The tutor's share, in cents. */
  tutorCents: number;
  /** The platform's share, in cents. */
  platformCents: number;
};

/**
 * Split a chargeable amount between tutor and platform.
 *
 * The platform's cut is floored, so any sub-cent remainder goes to the tutor.
 * The two halves always add back up to the input exactly.
 */
export function applyCommission(chargeableCents: number, commissionBps: number): CommissionSplit {
  assertNonNegativeInt(chargeableCents, 'chargeableCents');
  assertNonNegativeInt(commissionBps, 'commissionBps');
  if (commissionBps > MAX_COMMISSION_BPS) {
    throw new MoneyError(`commission cannot exceed 100% (10000 bps), got ${commissionBps}`);
  }

  const platformCents = applyBpsFloor(chargeableCents, commissionBps);
  return { platformCents, tutorCents: chargeableCents - platformCents };
}
