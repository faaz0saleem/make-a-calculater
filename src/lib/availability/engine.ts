/**
 * The availability engine (SPEC.md §5).
 *
 * Pure. Everything here takes rules, exceptions and existing bookings and
 * returns intervals or slots. Reading those from Postgres is
 * `src/lib/availability/database.ts`.
 *
 * The one thing that makes this correct rather than nearly-correct: a weekly
 * rule is a *local* fact. "Monday 17:00-21:00" means five in the afternoon
 * where the tutor lives, in January and in July. Expanding it by adding 7×24
 * hours to a UTC instant silently shifts a New York tutor's evening by an hour
 * twice a year. So expansion walks calendar days in the tutor's own timezone
 * and converts each one, which is why `zonedTimeToUtc` appears in the loop.
 */

import { getLocalParts, parseClock, zonedTimeToUtc } from '@/lib/time';

/** SPEC.md §5: slots are on a 30-minute grid. */
export const SLOT_MINUTES = 30;

export const MINUTE_MS = 60_000;

export type Interval = { startUtc: Date; endUtc: Date };

export type WeeklyRule = {
  /** 0 = Sunday, in the tutor's timezone. */
  weekdayLocal: number;
  /** `HH:MM:SS` in the tutor's timezone. */
  startTimeLocal: string;
  endTimeLocal: string;
  timezone: string;
  active: boolean;
};

export type AvailabilityException = {
  kind: 'block' | 'extra';
  startUtc: Date;
  endUtc: Date;
};

export type BusyInterval = Interval;

export type SlotConstraints = {
  /** Minutes of clear time the tutor wants after each session. */
  bufferMinutes: number;
  maxSessionsPerDay: number;
  bookingHorizonDays: number;
  minLeadMinutes: number;
  /** The tutor's IANA timezone — "per day" is a local day, not a UTC one. */
  timezone: string;
};

// ---------------------------------------------------------------------------
// Interval arithmetic
// ---------------------------------------------------------------------------

export function overlaps(a: Interval, b: Interval): boolean {
  return a.startUtc < b.endUtc && b.startUtc < a.endUtc;
}

/** Sorts by start, then merges anything touching or overlapping. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
  const merged: Interval[] = [{ ...sorted[0]! }];

  for (const interval of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (interval.startUtc.getTime() <= last.endUtc.getTime()) {
      if (interval.endUtc > last.endUtc) last.endUtc = interval.endUtc;
    } else {
      merged.push({ ...interval });
    }
  }

  return merged;
}

/** Removes `holes` from `intervals`, splitting where a hole lands in the middle. */
export function subtractIntervals(intervals: Interval[], holes: Interval[]): Interval[] {
  if (holes.length === 0) return intervals.map((interval) => ({ ...interval }));

  const merged = mergeIntervals(holes);
  let remaining = intervals.map((interval) => ({ ...interval }));

  for (const hole of merged) {
    const next: Interval[] = [];

    for (const interval of remaining) {
      if (!overlaps(interval, hole)) {
        next.push(interval);
        continue;
      }
      if (interval.startUtc < hole.startUtc) {
        next.push({ startUtc: interval.startUtc, endUtc: hole.startUtc });
      }
      if (hole.endUtc < interval.endUtc) {
        next.push({ startUtc: hole.endUtc, endUtc: interval.endUtc });
      }
    }

    remaining = next;
  }

  return remaining;
}

export function clipToRange(intervals: Interval[], range: Interval): Interval[] {
  const clipped: Interval[] = [];

  for (const interval of intervals) {
    const startUtc = interval.startUtc < range.startUtc ? range.startUtc : interval.startUtc;
    const endUtc = interval.endUtc > range.endUtc ? range.endUtc : interval.endUtc;
    if (startUtc < endUtc) clipped.push({ startUtc, endUtc });
  }

  return clipped;
}

export function totalMinutes(intervals: Interval[]): number {
  return intervals.reduce(
    (sum, interval) => sum + (interval.endUtc.getTime() - interval.startUtc.getTime()) / MINUTE_MS,
    0,
  );
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

/**
 * Turn weekly rules into concrete UTC intervals across a date range.
 *
 * Walks one local calendar day at a time in the tutor's timezone. A rule whose
 * end time is not after its start (an overnight window) is skipped rather than
 * silently producing a negative interval — the wizard does not allow one.
 */
export function expandWeeklyRules(rules: WeeklyRule[], range: Interval): Interval[] {
  const active = rules.filter((rule) => rule.active);
  if (active.length === 0) return [];

  const intervals: Interval[] = [];

  // Group by timezone: in practice one tutor has one, but the range has to be
  // walked in whatever zone each rule was written in.
  const byTimezone = new Map<string, WeeklyRule[]>();
  for (const rule of active) {
    const list = byTimezone.get(rule.timezone) ?? [];
    list.push(rule);
    byTimezone.set(rule.timezone, list);
  }

  for (const [timezone, zoneRules] of byTimezone) {
    // Start a day early and end a day late: a local day can begin before the
    // range in UTC and end after it.
    const firstDay = getLocalParts(new Date(range.startUtc.getTime() - 86_400_000), timezone);
    const lastDay = getLocalParts(new Date(range.endUtc.getTime() + 86_400_000), timezone);

    const cursor = { year: firstDay.year, month: firstDay.month, day: firstDay.day };
    const stop = Date.UTC(lastDay.year, lastDay.month - 1, lastDay.day);

    // Iterate on the local calendar, so DST never shifts the local start time.
    for (let guard = 0; guard < 800; guard += 1) {
      const asUtcDay = Date.UTC(cursor.year, cursor.month - 1, cursor.day);
      if (asUtcDay > stop) break;

      // Which local weekday this calendar date is.
      const weekday = new Date(asUtcDay).getUTCDay();

      for (const rule of zoneRules) {
        if (rule.weekdayLocal !== weekday) continue;

        const start = parseClock(rule.startTimeLocal);
        const end = parseClock(rule.endTimeLocal);
        if (end.hour * 60 + end.minute <= start.hour * 60 + start.minute) continue;

        const startUtc = zonedTimeToUtc(
          { year: cursor.year, month: cursor.month, day: cursor.day, hour: start.hour, minute: start.minute },
          timezone,
        );
        const endUtc = zonedTimeToUtc(
          { year: cursor.year, month: cursor.month, day: cursor.day, hour: end.hour, minute: end.minute },
          timezone,
        );

        if (startUtc < endUtc) intervals.push({ startUtc, endUtc });
      }

      // Next calendar day.
      const next = new Date(asUtcDay + 86_400_000);
      cursor.year = next.getUTCFullYear();
      cursor.month = next.getUTCMonth() + 1;
      cursor.day = next.getUTCDate();
    }
  }

  return clipToRange(mergeIntervals(intervals), range);
}

/**
 * Published availability: the weekly rules, plus one-off extra windows, minus
 * blocks (which is how vacation mode is stored — one row over a date range).
 *
 * Blocks are applied last, so a block always wins over an extra window.
 */
export function applyExceptions(
  published: Interval[],
  exceptions: AvailabilityException[],
  range: Interval,
): Interval[] {
  const extras = exceptions.filter((exception) => exception.kind === 'extra');
  const blocks = exceptions.filter((exception) => exception.kind === 'block');

  const withExtras = mergeIntervals([...published, ...clipToRange(extras, range)]);
  return clipToRange(subtractIntervals(withExtras, blocks), range);
}

/**
 * Free time: published availability minus existing bookings, each widened by
 * the tutor's buffer.
 *
 * The buffer is applied on both sides, because a gap is needed after the
 * previous session and before the next one — it is the same gap seen from
 * either side.
 */
export function subtractBusy(
  available: Interval[],
  busy: BusyInterval[],
  bufferMinutes: number,
): Interval[] {
  const padded = busy.map((interval) => ({
    startUtc: new Date(interval.startUtc.getTime() - bufferMinutes * MINUTE_MS),
    endUtc: new Date(interval.endUtc.getTime() + bufferMinutes * MINUTE_MS),
  }));

  return subtractIntervals(available, padded);
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export type Slot = {
  startUtc: Date;
  endUtc: Date;
};

/** Rounds an instant up to the next 30-minute boundary. */
export function ceilToSlot(instant: Date): Date {
  const step = SLOT_MINUTES * MINUTE_MS;
  return new Date(Math.ceil(instant.getTime() / step) * step);
}

/**
 * Every start time inside `free` at which a session of `durationMinutes` fits.
 *
 * A 60-minute booking needs two contiguous 30-minute slots (SPEC.md §5), which
 * falls out of requiring the whole duration to sit inside one free interval.
 */
export function slotsWithin(free: Interval[], durationMinutes: number): Slot[] {
  const slots: Slot[] = [];
  const durationMs = durationMinutes * MINUTE_MS;
  const step = SLOT_MINUTES * MINUTE_MS;

  for (const interval of mergeIntervals(free)) {
    let start = ceilToSlot(interval.startUtc);
    while (start.getTime() + durationMs <= interval.endUtc.getTime()) {
      slots.push({ startUtc: new Date(start), endUtc: new Date(start.getTime() + durationMs) });
      start = new Date(start.getTime() + step);
    }
  }

  return slots;
}

/**
 * The bookable window: not before the minimum lead time, not beyond the
 * booking horizon.
 */
export function bookableRange(constraints: SlotConstraints, now: Date): Interval {
  return {
    startUtc: new Date(now.getTime() + constraints.minLeadMinutes * MINUTE_MS),
    endUtc: new Date(now.getTime() + constraints.bookingHorizonDays * 86_400_000),
  };
}

/**
 * Drop slots on local days that already have the maximum number of sessions.
 *
 * "Per day" is the tutor's local day: a tutor in Karachi means their Tuesday,
 * not the UTC one, and the two are not the same twenty-four hours.
 */
export function enforceDailyLimit(
  slots: Slot[],
  bookedStarts: Date[],
  constraints: SlotConstraints,
): Slot[] {
  if (constraints.maxSessionsPerDay <= 0) return [];

  const localDay = (instant: Date) => {
    const parts = getLocalParts(instant, constraints.timezone);
    return `${parts.year}-${parts.month}-${parts.day}`;
  };

  const counts = new Map<string, number>();
  for (const start of bookedStarts) {
    const key = localDay(start);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return slots.filter((slot) => (counts.get(localDay(slot.startUtc)) ?? 0) < constraints.maxSessionsPerDay);
}

export type FreeSlotsInput = {
  rules: WeeklyRule[];
  exceptions: AvailabilityException[];
  busy: BusyInterval[];
  /** Start times of bookings that already exist, for the per-day cap. */
  bookedStarts: Date[];
  constraints: SlotConstraints;
  durationMinutes: number;
  /** Optional narrower window; intersected with the bookable range. */
  range?: Interval;
  now: Date;
};

/**
 * The whole pipeline: rules → exceptions → minus busy → slots → limits.
 *
 * This is the one function the rest of the product asks for free time.
 */
export function freeSlots(input: FreeSlotsInput): Slot[] {
  const bookable = bookableRange(input.constraints, input.now);

  const range: Interval = input.range
    ? {
        startUtc: input.range.startUtc > bookable.startUtc ? input.range.startUtc : bookable.startUtc,
        endUtc: input.range.endUtc < bookable.endUtc ? input.range.endUtc : bookable.endUtc,
      }
    : bookable;

  if (range.startUtc >= range.endUtc) return [];

  const published = expandWeeklyRules(input.rules, range);
  const withExceptions = applyExceptions(published, input.exceptions, range);
  const free = subtractBusy(withExceptions, input.busy, input.constraints.bufferMinutes);

  return enforceDailyLimit(slotsWithin(free, input.durationMinutes), input.bookedStarts, input.constraints);
}

/**
 * Published minutes over a window, ignoring bookings.
 *
 * Used as the denominator when reporting how much of a tutor's time is open.
 */
export function publishedMinutes(
  rules: WeeklyRule[],
  exceptions: AvailabilityException[],
  range: Interval,
): number {
  return totalMinutes(applyExceptions(expandWeeklyRules(rules, range), exceptions, range));
}
