/**
 * Timezone conversion (SPEC.md §13.2).
 *
 * Everything in the database is UTC. Every user carries an IANA timezone, and
 * conversion happens only at the edges: rendering a slot to a student, and
 * turning a tutor's "Monday 9am my time" into stored instants.
 *
 * Built on `Intl`, which ships the IANA database with the runtime, so there is
 * no offset table to keep up to date and DST is handled for free.
 */

export type LocalParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  /** 0 = Sunday, matching Postgres `extract(dow ...)`. */
  weekday: number;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export class TimeZoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeZoneError';
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function assertValidTimeZone(timeZone: string): string {
  if (!isValidTimeZone(timeZone)) {
    throw new TimeZoneError(`"${timeZone}" is not an IANA timezone identifier`);
  }
  return timeZone;
}

/** The wall-clock reading in `timeZone` at a given instant. */
export function getLocalParts(instant: Date, timeZone: string): LocalParts {
  assertValidTimeZone(timeZone);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }

  const weekdayIndex = WEEKDAYS.indexOf((parts.weekday ?? 'Sun') as (typeof WEEKDAYS)[number]);

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // `hour12: false` can render midnight as 24 in some ICU versions.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdayIndex === -1 ? 0 : weekdayIndex,
  };
}

/**
 * Minutes `timeZone` is ahead of UTC at a given instant. Positive east of
 * Greenwich: `Asia/Karachi` is +300 all year, `America/New_York` is -300 in
 * winter and -240 in summer.
 */
export function getTimeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const local = getLocalParts(instant, timeZone);
  const asIfUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return (asIfUtc - instant.getTime()) / 60_000;
}

/**
 * Turn a wall-clock reading in `timeZone` into the UTC instant it names.
 *
 * Guess using the offset at the naive instant, then re-read the offset at that
 * guess and correct. The result is verified by reading it back, because two
 * days a year a local time is not a simple function of an offset:
 *
 *  - Spring forward: 02:30 in New York on 2026-03-08 never happens. We return
 *    the instant the clock jumps to (03:30 EDT), the same choice Luxon and
 *    date-fns-tz make, so a booking in the gap moves forward rather than back.
 *  - Fall back: 01:30 on 2026-11-01 happens twice. We return the first, still
 *    on daylight time.
 */
export function zonedTimeToUtc(
  parts: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  timeZone: string,
): Date {
  assertValidTimeZone(timeZone);

  const wanted = {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };

  const naive = Date.UTC(
    wanted.year,
    wanted.month - 1,
    wanted.day,
    wanted.hour,
    wanted.minute,
    wanted.second,
  );

  const firstGuess = new Date(naive - getTimeZoneOffsetMinutes(new Date(naive), timeZone) * 60_000);
  const refined = new Date(naive - getTimeZoneOffsetMinutes(firstGuess, timeZone) * 60_000);

  const reads = (candidate: Date) => {
    const local = getLocalParts(candidate, timeZone);
    return (
      local.year === wanted.year &&
      local.month === wanted.month &&
      local.day === wanted.day &&
      local.hour === wanted.hour &&
      local.minute === wanted.minute &&
      local.second === wanted.second
    );
  };

  if (reads(refined)) return refined;
  if (reads(firstGuess)) return firstGuess;

  // The requested wall-clock time does not exist. `firstGuess` is the instant on
  // the far side of the gap.
  return firstGuess;
}

/** `2026-04-15T18:00:00Z` in `America/New_York` -> `Apr 15, 2026, 02:00 PM`. */
export function formatInTimeZone(
  instant: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
  },
  locale = 'en-US',
): string {
  assertValidTimeZone(timeZone);
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(instant);
}

/** `18:30` in the given zone. Used by the calendar grid. */
export function formatClock(instant: Date, timeZone: string): string {
  const { hour, minute } = getLocalParts(instant, timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** `"09:30:00"` -> `{ hour: 9, minute: 30 }`. Postgres `time` columns come back like this. */
export function parseClock(value: string): { hour: number; minute: number } {
  const [hourText = '0', minuteText = '0'] = value.split(':');
  return { hour: Number(hourText), minute: Number(minuteText) };
}

export function clockToString(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

/** Slots are on a 30-minute grid (SPEC.md §5). */
export const SLOT_MINUTES = 30;

export function isOnSlotGrid(instant: Date): boolean {
  return instant.getUTCSeconds() === 0 && instant.getUTCMilliseconds() === 0 && instant.getUTCMinutes() % SLOT_MINUTES === 0;
}
