/**
 * Integer-cent arithmetic.
 *
 * Every amount in this codebase is an integer number of US cents. There is no
 * float anywhere near a price, and no `Decimal`. `1 credit = $1.00 = 100 cents`.
 *
 * The helpers here are the only place division is allowed to happen, and they
 * all round explicitly so the rounding rule is visible at the call site.
 */

export const CENTS_PER_CREDIT = 100;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function assertInt(value: number, label = 'value'): number {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of cents, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} is outside the safe integer range: ${value}`);
  }
  return value;
}

export function assertNonNegativeInt(value: number, label = 'value'): number {
  assertInt(value, label);
  if (value < 0) {
    throw new MoneyError(`${label} must not be negative, got ${value}`);
  }
  return value;
}

export function assertPositiveInt(value: number, label = 'value'): number {
  assertNonNegativeInt(value, label);
  if (value === 0) {
    throw new MoneyError(`${label} must be greater than zero`);
  }
  return value;
}

/**
 * Integer division rounding halves up: 5/2 = 3, 4/2 = 2, 7/2 = 4.
 *
 * Both arguments are exact integers, so the intermediate double is exact and
 * `Math.floor` cannot land on the wrong side.
 */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  assertNonNegativeInt(numerator, 'numerator');
  assertPositiveInt(denominator, 'denominator');
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Integer division rounding towards zero (a plain floor for non-negatives). */
export function divFloor(numerator: number, denominator: number): number {
  assertNonNegativeInt(numerator, 'numerator');
  assertPositiveInt(denominator, 'denominator');
  return Math.floor(numerator / denominator);
}

/** Integer division rounding away from zero. */
export function divCeil(numerator: number, denominator: number): number {
  assertNonNegativeInt(numerator, 'numerator');
  assertPositiveInt(denominator, 'denominator');
  return Math.ceil(numerator / denominator);
}

/** Nearest 50c step, halves up. 1225 -> 1250, 1224 -> 1200. */
export function roundToNearest50(cents: number): number {
  assertNonNegativeInt(cents, 'cents');
  return divRoundHalfUp(cents, 50) * 50;
}

/** `cents * bps / 10000`, floored. Basis points: 2000 bps = 20%. */
export function applyBpsFloor(cents: number, bps: number): number {
  assertNonNegativeInt(cents, 'cents');
  assertNonNegativeInt(bps, 'bps');
  return divFloor(cents * bps, 10_000);
}

/** `cents * bps / 10000`, rounded up. */
export function applyBpsCeil(cents: number, bps: number): number {
  assertNonNegativeInt(cents, 'cents');
  assertNonNegativeInt(bps, 'bps');
  return divCeil(cents * bps, 10_000);
}

export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new MoneyError(`clamp called with min ${min} greater than max ${max}`);
  }
  return Math.min(Math.max(value, min), max);
}

/** `12.5` dollars -> `1250` cents. Only for config literals and tests. */
export function dollarsToCents(dollars: number): number {
  const cents = Math.round(dollars * 100);
  return assertInt(cents, 'cents');
}

/** `1250` -> `"$12.50"`. Display only; never feed the result back into maths. */
export function formatCents(cents: number, currency = 'USD', locale = 'en-US'): string {
  assertInt(cents, 'cents');
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs / 100);
  return `${sign}${formatted}`;
}

/** `1250` -> `"12.50 credits"`-ish. Credits and dollars are 1:1 by definition. */
export function formatCredits(cents: number): string {
  assertInt(cents, 'cents');
  return `${(cents / 100).toFixed(2)} credits`;
}
