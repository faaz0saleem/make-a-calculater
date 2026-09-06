/**
 * When a standing arrangement actually happens (SPEC.md §5).
 *
 * Pure: a series definition and a date range in, a list of instants out. No
 * database, no clock beyond what is passed in.
 *
 * The one subtlety is which side of the world the weekday belongs to. A series
 * is anchored to the **tutor's** local time, because the tutor's published
 * hours are, and a slot that drifted out of those hours twice a year would be
 * a slot nobody can teach. So "Tuesday at 18:00" means Tuesday at 18:00 where
 * the tutor is, every week, and the student sees whatever that is where they
 * are — including the hour it moves at a DST boundary. That is what a standing
 * appointment across five time zones does in real life, and hiding it would
 * only mean somebody misses a lesson.
 */

import { getLocalParts, zonedTimeToUtc, parseClock } from '@/lib/time';

/** Sunday-first, matching `availability_rules.weekday_local`. */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type SeriesDefinition = {
  /** 0 = Sunday, in `timezone`. */
  weekdays: readonly number[];
  /** `HH:MM` or `HH:MM:SS` in `timezone`. */
  startTimeLocal: string;
  timezone: string;
  durationMinutes: number;
  /** `YYYY-MM-DD`, the first day the series may produce an occurrence. */
  startsOn: string;
  /** `YYYY-MM-DD` inclusive, or null while open-ended. */
  endsOn?: string | null;
};

export type Occurrence = {
  /** The local date in the series timezone — the row's `occurrence_date`. */
  date: string;
  startUtc: Date;
  endUtc: Date;
};

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` -> the parts, with no timezone anywhere near it. */
function parseDate(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) throw new Error(`not a date: ${value}`);
  return { year, month, day };
}

export function toDateString(parts: { year: number; month: number; day: number }): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** The local date, in `timezone`, that an instant falls on. */
export function dateInZone(instant: Date, timeZone: string): string {
  return toDateString(getLocalParts(instant, timeZone));
}

/**
 * Walk local dates, not instants.
 *
 * Adding 24 hours repeatedly would drift by an hour twice a year and start
 * producing Wednesdays. Stepping the calendar date and re-resolving the wall
 * clock each time cannot.
 */
function* eachDate(from: string, to: string): Generator<{ year: number; month: number; day: number }> {
  const start = parseDate(from);
  const end = parseDate(to);

  let cursor = Date.UTC(start.year, start.month - 1, start.day);
  const last = Date.UTC(end.year, end.month - 1, end.day);

  while (cursor <= last) {
    const at = new Date(cursor);
    yield { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
    cursor += DAY_MS;
  }
}

/** Day of week for a calendar date, 0 = Sunday. Nothing timezone-shaped here. */
export function weekdayOf(date: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/**
 * Every occurrence of `series` whose local date falls in `[from, to]`.
 *
 * Both bounds are `YYYY-MM-DD` in the series timezone, and both are inclusive,
 * because a caller asking "what happens in the next four weeks" means the whole
 * of the last day.
 */
export function occurrencesBetween(
  series: SeriesDefinition,
  from: string,
  to: string,
): Occurrence[] {
  if (series.weekdays.length === 0) return [];

  const wanted = new Set(series.weekdays);
  const clock = parseClock(series.startTimeLocal);

  const first = from > series.startsOn ? from : series.startsOn;
  const last = series.endsOn && series.endsOn < to ? series.endsOn : to;
  if (first > last) return [];

  const out: Occurrence[] = [];

  for (const date of eachDate(first, last)) {
    if (!wanted.has(weekdayOf(date))) continue;

    const startUtc = zonedTimeToUtc(
      { ...date, hour: clock.hour, minute: clock.minute, second: 0 },
      series.timezone,
    );

    out.push({
      date: toDateString(date),
      startUtc,
      endUtc: new Date(startUtc.getTime() + series.durationMinutes * 60_000),
    });
  }

  return out;
}

/** How many occurrences a series produces in a week, for the copy. */
export function sessionsPerWeek(series: Pick<SeriesDefinition, 'weekdays'>): number {
  return series.weekdays.length;
}

/**
 * "Tuesdays and Thursdays at 6:00 PM", for a human.
 *
 * Sorted, so a student who ticked Thursday first does not read their own
 * arrangement back in the wrong order.
 */
export function describeSchedule(
  weekdays: readonly number[],
  startTimeLocal: string,
  timeZone?: string,
): string {
  const days = [...new Set(weekdays)]
    .filter((day) => day >= 0 && day <= 6)
    .sort((a, b) => a - b)
    .map((day) => `${WEEKDAY_NAMES[day]}s`);

  if (days.length === 0) return 'No days chosen';

  const list =
    days.length === 1
      ? days[0]!
      : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]!}`;

  const { hour, minute } = parseClock(startTimeLocal);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  const time = `${twelve}:${String(minute).padStart(2, '0')} ${suffix}`;

  return timeZone ? `${list} at ${time} (${timeZone})` : `${list} at ${time}`;
}
