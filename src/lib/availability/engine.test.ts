/**
 * The availability engine, including the scenario SPEC.md §16 asks for by name:
 * a Karachi tutor and a New York student either side of a US daylight-saving
 * change.
 */

import { describe, expect, it } from 'vitest';

import { formatClock, formatInTimeZone, getLocalParts, zonedTimeToUtc } from '@/lib/time';
import {
  applyExceptions,
  bookableRange,
  ceilToSlot,
  clipToRange,
  enforceDailyLimit,
  expandWeeklyRules,
  freeSlots,
  mergeIntervals,
  publishedMinutes,
  SLOT_MINUTES,
  slotsWithin,
  subtractBusy,
  subtractIntervals,
  totalMinutes,
  type AvailabilityException,
  type Interval,
  type SlotConstraints,
  type WeeklyRule,
} from './engine';

const KARACHI = 'Asia/Karachi';
const NEW_YORK = 'America/New_York';

const at = (iso: string) => new Date(iso);
const range = (start: string, end: string): Interval => ({ startUtc: at(start), endUtc: at(end) });

function rule(overrides: Partial<WeeklyRule> = {}): WeeklyRule {
  return {
    weekdayLocal: 1,
    startTimeLocal: '17:00:00',
    endTimeLocal: '21:00:00',
    timezone: KARACHI,
    active: true,
    ...overrides,
  };
}

function constraints(overrides: Partial<SlotConstraints> = {}): SlotConstraints {
  return {
    bufferMinutes: 0,
    maxSessionsPerDay: 8,
    bookingHorizonDays: 30,
    minLeadMinutes: 60,
    timezone: KARACHI,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('interval arithmetic', () => {
  it('merges overlapping and touching intervals', () => {
    expect(
      mergeIntervals([
        range('2026-03-02T10:00Z', '2026-03-02T11:00Z'),
        range('2026-03-02T10:30Z', '2026-03-02T12:00Z'),
        range('2026-03-02T12:00Z', '2026-03-02T13:00Z'),
        range('2026-03-02T15:00Z', '2026-03-02T16:00Z'),
      ]),
    ).toEqual([range('2026-03-02T10:00Z', '2026-03-02T13:00Z'), range('2026-03-02T15:00Z', '2026-03-02T16:00Z')]);
  });

  it('splits an interval when a hole lands in the middle', () => {
    expect(
      subtractIntervals(
        [range('2026-03-02T09:00Z', '2026-03-02T17:00Z')],
        [range('2026-03-02T12:00Z', '2026-03-02T13:00Z')],
      ),
    ).toEqual([range('2026-03-02T09:00Z', '2026-03-02T12:00Z'), range('2026-03-02T13:00Z', '2026-03-02T17:00Z')]);
  });

  it('removes an interval a hole swallows entirely', () => {
    expect(
      subtractIntervals(
        [range('2026-03-02T10:00Z', '2026-03-02T11:00Z')],
        [range('2026-03-02T09:00Z', '2026-03-02T12:00Z')],
      ),
    ).toEqual([]);
  });

  it('leaves an interval alone when a hole only touches its edge', () => {
    expect(
      subtractIntervals(
        [range('2026-03-02T10:00Z', '2026-03-02T11:00Z')],
        [range('2026-03-02T11:00Z', '2026-03-02T12:00Z')],
      ),
    ).toEqual([range('2026-03-02T10:00Z', '2026-03-02T11:00Z')]);
  });

  it('clips to a range and totals minutes', () => {
    const clipped = clipToRange(
      [range('2026-03-02T08:00Z', '2026-03-02T20:00Z')],
      range('2026-03-02T09:00Z', '2026-03-02T12:00Z'),
    );
    expect(clipped).toEqual([range('2026-03-02T09:00Z', '2026-03-02T12:00Z')]);
    expect(totalMinutes(clipped)).toBe(180);
  });
});

// ---------------------------------------------------------------------------

describe('expandWeeklyRules', () => {
  it('produces one window per matching weekday', () => {
    const windows = expandWeeklyRules([rule()], range('2026-03-01T00:00Z', '2026-03-29T00:00Z'));
    // Mondays: 2, 9, 16, 23 March.
    expect(windows).toHaveLength(4);
    for (const window of windows) {
      expect(getLocalParts(window.startUtc, KARACHI).weekday).toBe(1);
      expect(formatClock(window.startUtc, KARACHI)).toBe('17:00');
      expect(formatClock(window.endUtc, KARACHI)).toBe('21:00');
    }
  });

  it('ignores inactive rules', () => {
    expect(expandWeeklyRules([rule({ active: false })], range('2026-03-01T00:00Z', '2026-03-29T00:00Z'))).toEqual(
      [],
    );
  });

  it('ignores a window that does not end after it starts', () => {
    expect(
      expandWeeklyRules(
        [rule({ startTimeLocal: '21:00:00', endTimeLocal: '17:00:00' })],
        range('2026-03-01T00:00Z', '2026-03-29T00:00Z'),
      ),
    ).toEqual([]);
  });

  it('merges two rules that abut on the same day', () => {
    const windows = expandWeeklyRules(
      [
        rule({ startTimeLocal: '09:00:00', endTimeLocal: '12:00:00' }),
        rule({ startTimeLocal: '12:00:00', endTimeLocal: '15:00:00' }),
      ],
      range('2026-03-01T00:00Z', '2026-03-08T00:00Z'),
    );
    expect(windows).toHaveLength(1);
    expect(totalMinutes(windows)).toBe(360);
  });

  it('clips a window that straddles the edge of the range', () => {
    const windows = expandWeeklyRules([rule()], range('2026-03-02T13:00Z', '2026-03-02T15:00Z'));
    expect(windows).toEqual([range('2026-03-02T13:00Z', '2026-03-02T15:00Z')]);
  });
});

// ---------------------------------------------------------------------------

describe('daylight saving (SPEC.md §13.2, §16)', () => {
  // A New York tutor teaching 17:00-21:00 every Monday, across the March 2026
  // change. Their evening must stay their evening.
  const newYorkRule = rule({ timezone: NEW_YORK, weekdayLocal: 1 });

  it('keeps a DST-observing tutor at the same local time either side', () => {
    // The range ends midday on the 10th so both Mondays are whole; a window
    // that straddles the edge is clipped, which is a different behaviour.
    const windows = expandWeeklyRules([newYorkRule], range('2026-03-01T00:00Z', '2026-03-10T12:00Z'));
    expect(windows).toHaveLength(2); // Mondays 2 and 9 March

    for (const window of windows) {
      expect(formatClock(window.startUtc, NEW_YORK)).toBe('17:00');
      expect(formatClock(window.endUtc, NEW_YORK)).toBe('21:00');
    }

    // Which means the UTC instants differ by an hour, as they must.
    expect(windows[0]!.startUtc.toISOString()).toBe('2026-03-02T22:00:00.000Z');
    expect(windows[1]!.startUtc.toISOString()).toBe('2026-03-09T21:00:00.000Z');
  });

  it('keeps a Karachi tutor at the same UTC instant, because Pakistan has no DST', () => {
    const windows = expandWeeklyRules([rule()], range('2026-03-01T00:00Z', '2026-03-10T12:00Z'));
    expect(windows[0]!.startUtc.toISOString()).toBe('2026-03-02T12:00:00.000Z');
    expect(windows[1]!.startUtc.toISOString()).toBe('2026-03-09T12:00:00.000Z');
  });

  it('shows a Karachi tutor and a New York student the right local times across the change', () => {
    // The tutor teaches Saturdays 23:00-01:00 Karachi… which is the evening
    // before in New York.
    const saturdayNight = rule({ weekdayLocal: 6, startTimeLocal: '22:00:00', endTimeLocal: '23:30:00' });
    const windows = expandWeeklyRules([saturdayNight], range('2026-03-01T00:00Z', '2026-03-22T00:00Z'));

    // 7 March (before the change), 14 and 21 March (after it).
    expect(windows).toHaveLength(3);

    const before = windows[0]!;
    const after = windows[1]!;

    // The tutor sees 22:00 on every one of them.
    expect(formatClock(before.startUtc, KARACHI)).toBe('22:00');
    expect(formatClock(after.startUtc, KARACHI)).toBe('22:00');

    // The student's clock moved, so they see a different hour after the change.
    expect(formatClock(before.startUtc, NEW_YORK)).toBe('12:00');
    expect(formatClock(after.startUtc, NEW_YORK)).toBe('13:00');

    // And the dates render correctly for each of them.
    expect(formatInTimeZone(before.startUtc, KARACHI, { dateStyle: 'medium' })).toBe('Mar 7, 2026');
    expect(formatInTimeZone(before.startUtc, NEW_YORK, { dateStyle: 'medium' })).toBe('Mar 7, 2026');
  });

  it('does not lose or duplicate a Sunday across the spring-forward night', () => {
    // 2026-03-08 is the US spring-forward Sunday. A Sunday rule must produce
    // exactly one window that week, not zero and not two.
    const sunday = rule({ timezone: NEW_YORK, weekdayLocal: 0, startTimeLocal: '09:00:00', endTimeLocal: '17:00:00' });
    const windows = expandWeeklyRules([sunday], range('2026-03-05T00:00Z', '2026-03-12T00:00Z'));

    expect(windows).toHaveLength(1);
    expect(formatClock(windows[0]!.startUtc, NEW_YORK)).toBe('09:00');
    // Eight local hours, even though only seven wall-clock hours of UTC pass
    // through the transition — the transition is at 02:00, before the window.
    expect(totalMinutes(windows)).toBe(480);
  });

  it('handles a window containing the spring-forward gap', () => {
    // 01:00-05:00 on 2026-03-08 in New York: 02:00-03:00 does not exist, so the
    // window is three real hours, not four.
    const overnight = rule({
      timezone: NEW_YORK,
      weekdayLocal: 0,
      startTimeLocal: '01:00:00',
      endTimeLocal: '05:00:00',
    });
    const windows = expandWeeklyRules([overnight], range('2026-03-07T00:00Z', '2026-03-09T00:00Z'));

    expect(windows).toHaveLength(1);
    expect(totalMinutes(windows)).toBe(180);
  });

  it('handles the ambiguous hour on fall-back night', () => {
    // 2026-11-01: 01:00-01:59 happens twice in New York. A 00:30-02:30 window
    // is three real hours, and starts at the first 00:30.
    const overnight = rule({
      timezone: NEW_YORK,
      weekdayLocal: 0,
      startTimeLocal: '00:30:00',
      endTimeLocal: '02:30:00',
    });
    const windows = expandWeeklyRules([overnight], range('2026-10-31T00:00Z', '2026-11-02T00:00Z'));

    expect(windows).toHaveLength(1);
    expect(totalMinutes(windows)).toBe(180);
    expect(windows[0]!.startUtc.toISOString()).toBe('2026-11-01T04:30:00.000Z');
  });

  it('gives a student in another zone slots that convert back correctly', () => {
    const windows = expandWeeklyRules([rule()], range('2026-03-01T00:00Z', '2026-03-15T00:00Z'));
    const slots = slotsWithin(windows, 60);

    for (const slot of slots) {
      // Whatever the student's zone, the instant is the same moment.
      const asKarachi = zonedTimeToUtc(
        {
          ...getLocalParts(slot.startUtc, KARACHI),
          month: getLocalParts(slot.startUtc, KARACHI).month,
        },
        KARACHI,
      );
      expect(asKarachi.getTime()).toBe(slot.startUtc.getTime());
    }
  });
});

// ---------------------------------------------------------------------------

describe('exceptions', () => {
  const published = [range('2026-03-02T12:00Z', '2026-03-02T16:00Z')];
  const window = range('2026-03-01T00:00Z', '2026-03-03T00:00Z');

  it('adds a one-off extra window', () => {
    const extra: AvailabilityException = {
      kind: 'extra',
      startUtc: at('2026-03-01T09:00Z'),
      endUtc: at('2026-03-01T11:00Z'),
    };
    expect(applyExceptions(published, [extra], window)).toHaveLength(2);
  });

  it('blocks a range, splitting the day around it', () => {
    const block: AvailabilityException = {
      kind: 'block',
      startUtc: at('2026-03-02T13:00Z'),
      endUtc: at('2026-03-02T14:00Z'),
    };
    expect(applyExceptions(published, [block], window)).toEqual([
      range('2026-03-02T12:00Z', '2026-03-02T13:00Z'),
      range('2026-03-02T14:00Z', '2026-03-02T16:00Z'),
    ]);
  });

  it('clears a whole week for vacation mode', () => {
    const vacation: AvailabilityException = {
      kind: 'block',
      startUtc: at('2026-03-01T00:00Z'),
      endUtc: at('2026-03-08T00:00Z'),
    };
    expect(applyExceptions(published, [vacation], window)).toEqual([]);
  });

  it('lets a block win over an extra window that overlaps it', () => {
    const extra: AvailabilityException = {
      kind: 'extra',
      startUtc: at('2026-03-01T09:00Z'),
      endUtc: at('2026-03-01T17:00Z'),
    };
    const block: AvailabilityException = {
      kind: 'block',
      startUtc: at('2026-03-01T00:00Z'),
      endUtc: at('2026-03-02T00:00Z'),
    };
    expect(applyExceptions(published, [extra, block], window)).toEqual(published);
  });
});

// ---------------------------------------------------------------------------

describe('subtractBusy', () => {
  const available = [range('2026-03-02T12:00Z', '2026-03-02T16:00Z')];

  it('removes a booking', () => {
    expect(subtractBusy(available, [range('2026-03-02T13:00Z', '2026-03-02T14:00Z')], 0)).toEqual([
      range('2026-03-02T12:00Z', '2026-03-02T13:00Z'),
      range('2026-03-02T14:00Z', '2026-03-02T16:00Z'),
    ]);
  });

  it('widens the booking by the buffer on both sides', () => {
    expect(subtractBusy(available, [range('2026-03-02T13:00Z', '2026-03-02T14:00Z')], 15)).toEqual([
      range('2026-03-02T12:00Z', '2026-03-02T12:45Z'),
      range('2026-03-02T14:15Z', '2026-03-02T16:00Z'),
    ]);
  });

  it('a buffer can close a gap entirely', () => {
    const tight = [range('2026-03-02T12:00Z', '2026-03-02T14:00Z')];
    const busy = [range('2026-03-02T12:30Z', '2026-03-02T13:00Z'), range('2026-03-02T13:15Z', '2026-03-02T13:45Z')];
    // With a 15-minute buffer the 15 minutes between the two is unusable.
    const free = subtractBusy(tight, busy, 15);
    expect(free.some((interval) => interval.startUtc.toISOString() === '2026-03-02T13:00:00.000Z')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('slots', () => {
  it('rounds up to the 30-minute grid', () => {
    expect(ceilToSlot(at('2026-03-02T12:00Z')).toISOString()).toBe('2026-03-02T12:00:00.000Z');
    expect(ceilToSlot(at('2026-03-02T12:01Z')).toISOString()).toBe('2026-03-02T12:30:00.000Z');
    expect(ceilToSlot(at('2026-03-02T12:31Z')).toISOString()).toBe('2026-03-02T13:00:00.000Z');
  });

  it('offers a 30-minute slot every half hour', () => {
    const slots = slotsWithin([range('2026-03-02T12:00Z', '2026-03-02T14:00Z')], 30);
    expect(slots.map((slot) => slot.startUtc.toISOString())).toEqual([
      '2026-03-02T12:00:00.000Z',
      '2026-03-02T12:30:00.000Z',
      '2026-03-02T13:00:00.000Z',
      '2026-03-02T13:30:00.000Z',
    ]);
  });

  it('needs two contiguous slots for a 60-minute booking (SPEC.md §5)', () => {
    const slots = slotsWithin([range('2026-03-02T12:00Z', '2026-03-02T14:00Z')], 60);
    expect(slots.map((slot) => slot.startUtc.toISOString())).toEqual([
      '2026-03-02T12:00:00.000Z',
      '2026-03-02T12:30:00.000Z',
      '2026-03-02T13:00:00.000Z',
    ]);
  });

  it('will not offer 60 minutes in a 30-minute gap', () => {
    expect(slotsWithin([range('2026-03-02T12:00Z', '2026-03-02T12:30Z')], 60)).toEqual([]);
  });

  it('never spans two separate free intervals', () => {
    const free = [range('2026-03-02T12:00Z', '2026-03-02T12:30Z'), range('2026-03-02T12:30Z', '2026-03-02T13:30Z')];
    // These merge, so an hour does fit.
    expect(slotsWithin(free, 60)).toHaveLength(2);

    const split = [range('2026-03-02T12:00Z', '2026-03-02T12:30Z'), range('2026-03-02T13:00Z', '2026-03-02T13:30Z')];
    expect(slotsWithin(split, 60)).toEqual([]);
  });

  it('uses a 30-minute grid, as SPEC.md §5 says', () => {
    expect(SLOT_MINUTES).toBe(30);
  });
});

// ---------------------------------------------------------------------------

describe('constraints', () => {
  const now = at('2026-03-02T08:00Z');

  it('starts after the minimum lead time and ends at the horizon', () => {
    const window = bookableRange(constraints({ minLeadMinutes: 60, bookingHorizonDays: 30 }), now);
    expect(window.startUtc.toISOString()).toBe('2026-03-02T09:00:00.000Z');
    expect(window.endUtc.toISOString()).toBe('2026-04-01T08:00:00.000Z');
  });

  it('drops days that already hit the session cap', () => {
    const slots = slotsWithin([range('2026-03-02T12:00Z', '2026-03-02T16:00Z')], 60);
    const booked = [at('2026-03-02T06:00Z'), at('2026-03-02T07:00Z')];

    expect(enforceDailyLimit(slots, booked, constraints({ maxSessionsPerDay: 2 }))).toEqual([]);
    expect(enforceDailyLimit(slots, booked, constraints({ maxSessionsPerDay: 3 }))).toHaveLength(slots.length);
  });

  it('counts a day in the tutor\'s timezone, not in UTC', () => {
    // 20:00 UTC on 2 March is already 3 March in Karachi (+5).
    const booked = [at('2026-03-02T20:00Z')];
    const slots = slotsWithin([range('2026-03-03T05:00Z', '2026-03-03T07:00Z')], 60);

    // Karachi: both are 3 March, so a cap of 1 removes the slots.
    expect(enforceDailyLimit(slots, booked, constraints({ maxSessionsPerDay: 1 }))).toEqual([]);
    // UTC would have called them different days and let them through.
    expect(enforceDailyLimit(slots, booked, constraints({ maxSessionsPerDay: 1, timezone: 'UTC' }))).toHaveLength(
      slots.length,
    );
  });
});

// ---------------------------------------------------------------------------

describe('freeSlots', () => {
  // Monday 2 March 2026, 17:00-21:00 Karachi = 12:00-16:00 UTC.
  const now = at('2026-03-02T06:00Z');

  it('runs the whole pipeline', () => {
    const slots = freeSlots({
      rules: [rule()],
      exceptions: [],
      busy: [range('2026-03-02T13:00Z', '2026-03-02T14:00Z')],
      bookedStarts: [at('2026-03-02T13:00Z')],
      constraints: constraints({ bufferMinutes: 15 }),
      durationMinutes: 60,
      now,
    });

    const starts = slots.map((slot) => slot.startUtc.toISOString());

    // The booking plus its buffer occupies 12:45-14:15, leaving 12:00-12:45 and
    // 14:15-16:00. Forty-five minutes is not an hour, so nothing fits before
    // the session at all.
    expect(starts).not.toContain('2026-03-02T12:00:00.000Z');
    expect(starts).not.toContain('2026-03-02T13:00:00.000Z');

    // After it, the grid picks up at 14:30 and the last hour that fits is 15:00.
    expect(starts).toContain('2026-03-02T14:30:00.000Z');
    expect(starts).toContain('2026-03-02T15:00:00.000Z');
    expect(starts).not.toContain('2026-03-02T15:30:00.000Z'); // would run past 16:00

    // A 30-minute session does fit in that first gap.
    const halfHours = freeSlots({
      rules: [rule()],
      exceptions: [],
      busy: [range('2026-03-02T13:00Z', '2026-03-02T14:00Z')],
      bookedStarts: [at('2026-03-02T13:00Z')],
      constraints: constraints({ bufferMinutes: 15 }),
      durationMinutes: 30,
      now,
    }).map((slot) => slot.startUtc.toISOString());
    expect(halfHours).toContain('2026-03-02T12:00:00.000Z');
  });

  it('respects the minimum lead time', () => {
    const slots = freeSlots({
      rules: [rule()],
      exceptions: [],
      busy: [],
      bookedStarts: [],
      constraints: constraints({ minLeadMinutes: 60 }),
      durationMinutes: 30,
      now: at('2026-03-02T12:00Z'),
    });
    expect(slots[0]!.startUtc.toISOString()).toBe('2026-03-02T13:00:00.000Z');
  });

  it('respects the booking horizon', () => {
    const slots = freeSlots({
      rules: [rule()],
      exceptions: [],
      busy: [],
      bookedStarts: [],
      constraints: constraints({ bookingHorizonDays: 7 }),
      durationMinutes: 60,
      now,
    });
    for (const slot of slots) {
      expect(slot.startUtc.getTime()).toBeLessThanOrEqual(now.getTime() + 7 * 86_400_000);
    }
  });

  it('returns nothing during vacation', () => {
    const slots = freeSlots({
      rules: [rule()],
      exceptions: [{ kind: 'block', startUtc: at('2026-03-01T00:00Z'), endUtc: at('2026-04-01T00:00Z') }],
      busy: [],
      bookedStarts: [],
      constraints: constraints(),
      durationMinutes: 30,
      now,
    });
    expect(slots).toEqual([]);
  });

  it('returns nothing for a tutor who has published no hours', () => {
    expect(
      freeSlots({
        rules: [],
        exceptions: [],
        busy: [],
        bookedStarts: [],
        constraints: constraints(),
        durationMinutes: 30,
        now,
      }),
    ).toEqual([]);
  });

  it('never returns a slot in the past', () => {
    const slots = freeSlots({
      rules: [rule()],
      exceptions: [],
      busy: [],
      bookedStarts: [],
      constraints: constraints(),
      durationMinutes: 30,
      now: at('2026-03-16T00:00Z'),
    });
    for (const slot of slots) {
      expect(slot.startUtc.getTime()).toBeGreaterThan(at('2026-03-16T00:00Z').getTime());
    }
  });
});

describe('publishedMinutes', () => {
  it('counts published time regardless of bookings', () => {
    expect(publishedMinutes([rule()], [], range('2026-03-01T00:00Z', '2026-03-08T00:00Z'))).toBe(240);
  });

  it('drops to zero during vacation', () => {
    expect(
      publishedMinutes(
        [rule()],
        [{ kind: 'block', startUtc: at('2026-03-01T00:00Z'), endUtc: at('2026-03-08T00:00Z') }],
        range('2026-03-01T00:00Z', '2026-03-08T00:00Z'),
      ),
    ).toBe(0);
  });
});
