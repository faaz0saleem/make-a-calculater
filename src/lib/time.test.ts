/**
 * The scenario SPEC.md §13.2 asks for by name: a tutor in Asia/Karachi and a
 * student in America/New_York, across a US daylight-saving boundary.
 */

import { describe, expect, it } from 'vitest';
import {
  clockToString,
  formatClock,
  formatInTimeZone,
  getLocalParts,
  getTimeZoneOffsetMinutes,
  isOnSlotGrid,
  isValidTimeZone,
  parseClock,
  TimeZoneError,
  zonedTimeToUtc,
  assertValidTimeZone,
} from './time';

const KARACHI = 'Asia/Karachi';
const NEW_YORK = 'America/New_York';

describe('timezone validation', () => {
  it('accepts IANA identifiers and rejects offsets', () => {
    expect(isValidTimeZone(KARACHI)).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(() => assertValidTimeZone('GMT+5')).toThrow(TimeZoneError);
  });
});

describe('offsets', () => {
  it('Karachi is +5 all year — Pakistan does not observe DST', () => {
    expect(getTimeZoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), KARACHI)).toBe(300);
    expect(getTimeZoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), KARACHI)).toBe(300);
  });

  it('New York moves from -5 to -4 over the March 2026 boundary', () => {
    expect(getTimeZoneOffsetMinutes(new Date('2026-03-07T12:00:00Z'), NEW_YORK)).toBe(-300);
    expect(getTimeZoneOffsetMinutes(new Date('2026-03-09T12:00:00Z'), NEW_YORK)).toBe(-240);
  });
});

describe('a Karachi tutor and a New York student across the DST change', () => {
  // A weekly 23:00 Karachi lesson. Karachi never moves; New York does.
  const beforeDst = zonedTimeToUtc({ year: 2026, month: 3, day: 7, hour: 23, minute: 0 }, KARACHI);
  const afterDst = zonedTimeToUtc({ year: 2026, month: 3, day: 14, hour: 23, minute: 0 }, KARACHI);

  it('stores both lessons at the same UTC clock time', () => {
    expect(beforeDst.toISOString()).toBe('2026-03-07T18:00:00.000Z');
    expect(afterDst.toISOString()).toBe('2026-03-14T18:00:00.000Z');
  });

  it('shows the tutor 23:00 on both dates', () => {
    expect(formatClock(beforeDst, KARACHI)).toBe('23:00');
    expect(formatClock(afterDst, KARACHI)).toBe('23:00');
  });

  it('shows the student 13:00 before the change and 14:00 after it', () => {
    expect(formatClock(beforeDst, NEW_YORK)).toBe('13:00');
    expect(formatClock(afterDst, NEW_YORK)).toBe('14:00');
  });

  it('renders a readable local string for each party', () => {
    expect(formatInTimeZone(beforeDst, NEW_YORK)).toBe('Mar 7, 2026, 1:00 PM');
    expect(formatInTimeZone(beforeDst, KARACHI)).toBe('Mar 7, 2026, 11:00 PM');
  });
});

describe('zonedTimeToUtc', () => {
  it('round-trips through getLocalParts', () => {
    for (const timeZone of [KARACHI, NEW_YORK, 'Europe/London', 'Australia/Sydney', 'UTC']) {
      for (const month of [1, 3, 6, 7, 11, 12]) {
        const instant = zonedTimeToUtc({ year: 2026, month, day: 15, hour: 14, minute: 30 }, timeZone);
        const parts = getLocalParts(instant, timeZone);
        expect([parts.year, parts.month, parts.day, parts.hour, parts.minute]).toEqual([
          2026,
          month,
          15,
          14,
          30,
        ]);
      }
    }
  });

  it('handles the hour that does not exist on spring-forward night', () => {
    // 02:30 on 2026-03-08 never happens in New York; the clock jumps 02:00 -> 03:00.
    const instant = zonedTimeToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NEW_YORK);
    expect(getLocalParts(instant, NEW_YORK).hour).toBe(3);
  });

  it('handles midnight without wrapping to 24', () => {
    const instant = zonedTimeToUtc({ year: 2026, month: 6, day: 1, hour: 0, minute: 0 }, KARACHI);
    expect(getLocalParts(instant, KARACHI).hour).toBe(0);
    expect(instant.toISOString()).toBe('2026-05-31T19:00:00.000Z');
  });
});

describe('weekday numbering', () => {
  it('matches Postgres, with Sunday at 0', () => {
    // 2026-03-08 is a Sunday.
    expect(getLocalParts(new Date('2026-03-08T12:00:00Z'), 'UTC').weekday).toBe(0);
    expect(getLocalParts(new Date('2026-03-09T12:00:00Z'), 'UTC').weekday).toBe(1);
    expect(getLocalParts(new Date('2026-03-14T12:00:00Z'), 'UTC').weekday).toBe(6);
  });

  it('can differ between the two parties on the same instant', () => {
    // Monday 08:00 in Karachi is still Sunday in New York.
    const instant = zonedTimeToUtc({ year: 2026, month: 3, day: 9, hour: 8, minute: 0 }, KARACHI);
    expect(getLocalParts(instant, KARACHI).weekday).toBe(1);
    expect(getLocalParts(instant, NEW_YORK).weekday).toBe(0);
  });
});

describe('clock helpers', () => {
  it('parses and formats Postgres time values', () => {
    expect(parseClock('09:30:00')).toEqual({ hour: 9, minute: 30 });
    expect(clockToString(9, 30)).toBe('09:30:00');
  });

  it('recognises the 30-minute slot grid', () => {
    expect(isOnSlotGrid(new Date('2026-04-15T18:00:00.000Z'))).toBe(true);
    expect(isOnSlotGrid(new Date('2026-04-15T18:30:00.000Z'))).toBe(true);
    expect(isOnSlotGrid(new Date('2026-04-15T18:15:00.000Z'))).toBe(false);
    expect(isOnSlotGrid(new Date('2026-04-15T18:00:30.000Z'))).toBe(false);
  });
});

describe('daylight-saving edge cases', () => {
  it('returns the first of two ambiguous instants on fall-back night', () => {
    // 01:30 on 2026-11-01 happens twice in New York; we take the EDT one.
    const instant = zonedTimeToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NEW_YORK);
    expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(formatClock(instant, NEW_YORK)).toBe('01:30');
  });

  it('never returns an instant whose local reading is on the wrong day', () => {
    for (let day = 1; day <= 31; day += 1) {
      const instant = zonedTimeToUtc({ year: 2026, month: 3, day, hour: 12, minute: 0 }, NEW_YORK);
      const local = getLocalParts(instant, NEW_YORK);
      expect(local.day).toBe(day);
      expect(local.hour).toBe(12);
    }
  });
});
