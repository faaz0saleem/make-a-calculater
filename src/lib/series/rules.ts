/**
 * The rules a standing arrangement runs by (SPEC.md §5, DECISIONS_NEEDED item 32).
 *
 * All of it pure and all of it in one file, because these are the numbers
 * somebody will want to argue about and they should not have to read a
 * transaction to find them.
 */

import { FIRST_BOOKING_COMMISSION_BPS, REBOOKING_COMMISSION_BPS } from '@/lib/money/commission';

/**
 * How far ahead occurrences exist as real bookings.
 *
 * Four weeks is enough that a student can see a month of their schedule and a
 * tutor can plan around it, and short enough that ending a series does not
 * leave a year of rows to clean up. Beyond it, the slot is still held — the
 * availability engine projects the series forward — there is just no row yet.
 */
export const MATERIALISE_DAYS = 28;

/** When the credits for one occurrence are taken. */
export const CHARGE_HOURS_BEFORE = 48;

/** When a student who cannot cover the next one is told. */
export const WARN_HOURS_BEFORE = 72;

/**
 * How much notice either side must give to end a series.
 *
 * Seven days is one full cycle of a weekly arrangement, so nobody loses a
 * session they had already planned around, and it is short enough that
 * somebody who wants out is out.
 */
export const END_NOTICE_DAYS = 7;

/**
 * Durations a series may run at.
 *
 * The same two the booking form offers, deliberately. A 90-minute series would
 * need a 90-minute price, and there is no rule for one — inventing a rate here
 * would put a number in front of a tutor that nobody decided.
 */
export const SERIES_DURATIONS = [30, 60] as const;
export type SeriesDuration = (typeof SERIES_DURATIONS)[number];

export function isSeriesDuration(value: number): value is SeriesDuration {
  return (SERIES_DURATIONS as readonly number[]).includes(value);
}

/**
 * The commission on one occurrence of a series.
 *
 * "Every session after the first is a rebooking." Deliberately decided by the
 * occurrence's position rather than by re-asking "has a session completed
 * yet?" at materialisation time: four weeks are created at once, before any of
 * them has happened, so asking would price the whole month at the
 * first-session rate and quietly overcharge a tutor who has just been handed
 * eight sessions of committed work.
 *
 * A student who has already paid this tutor is on the rebooking rate from
 * occurrence one, which is the existing rule and not a special case.
 */
export function commissionForOccurrence(
  occurrenceIndex: number,
  hasPaidThisTutorBefore: boolean,
  negotiatedBps?: number | null,
): number {
  const retention =
    hasPaidThisTutorBefore || occurrenceIndex > 0
      ? REBOOKING_COMMISSION_BPS
      : FIRST_BOOKING_COMMISSION_BPS;

  const negotiated =
    typeof negotiatedBps === 'number' && Number.isInteger(negotiatedBps) && negotiatedBps > 0
      ? negotiatedBps
      : null;

  return negotiated === null ? retention : Math.min(negotiated, retention);
}

/** The instant an occurrence's credits are due. */
export function chargeDueAt(startAtUtc: Date): Date {
  return new Date(startAtUtc.getTime() - CHARGE_HOURS_BEFORE * 3_600_000);
}

/** The instant a student should be warned they are short. */
export function warnDueAt(startAtUtc: Date): Date {
  return new Date(startAtUtc.getTime() - WARN_HOURS_BEFORE * 3_600_000);
}

/**
 * The last day a series may still produce occurrences after somebody ends it.
 *
 * Returned as `YYYY-MM-DD` in the series timezone, because the notice is a
 * number of days and days are a local idea.
 */
export function noticeEndsOn(fromDate: string, days = END_NOTICE_DAYS): string {
  const [year, month, day] = fromDate.split('-').map(Number);
  const at = new Date(Date.UTC(year!, month! - 1, day!) + days * 86_400_000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/** What a series costs a student over four weeks, for the copy at booking. */
export function monthlyCommitmentCents(
  priceCents: number,
  sessionsPerWeek: number,
  weeks = 4,
): number {
  return priceCents * sessionsPerWeek * weeks;
}
