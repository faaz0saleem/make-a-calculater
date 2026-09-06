import { describe, expect, it } from 'vitest';

import {
  dateInZone,
  describeSchedule,
  occurrencesBetween,
  weekdayOf,
  type SeriesDefinition,
} from './occurrences';

const KARACHI: SeriesDefinition = {
  weekdays: [2, 4], // Tuesday and Thursday
  startTimeLocal: '18:00:00',
  timezone: 'Asia/Karachi',
  durationMinutes: 60,
  startsOn: '2026-09-07',
};

describe('picking the right days', () => {
  it('produces only the chosen weekdays', () => {
    const out = occurrencesBetween(KARACHI, '2026-09-07', '2026-09-20');
    expect(out.map((o) => o.date)).toEqual([
      '2026-09-08',
      '2026-09-10',
      '2026-09-15',
      '2026-09-17',
    ]);
    for (const occurrence of out) {
      expect([2, 4]).toContain(weekdayOf({
        year: Number(occurrence.date.slice(0, 4)),
        month: Number(occurrence.date.slice(5, 7)),
        day: Number(occurrence.date.slice(8, 10)),
      }));
    }
  });

  it('never starts before the series does', () => {
    const out = occurrencesBetween(KARACHI, '2026-08-01', '2026-09-10');
    expect(out[0]?.date).toBe('2026-09-08');
  });

  it('stops at the end date, inclusive', () => {
    const ending = { ...KARACHI, endsOn: '2026-09-15' };
    expect(occurrencesBetween(ending, '2026-09-07', '2026-09-30').map((o) => o.date)).toEqual([
      '2026-09-08',
      '2026-09-10',
      '2026-09-15',
    ]);
  });

  it('is empty when the window is entirely before the series', () => {
    expect(occurrencesBetween(KARACHI, '2026-01-01', '2026-01-31')).toEqual([]);
  });

  it('is empty when no weekdays are chosen', () => {
    expect(occurrencesBetween({ ...KARACHI, weekdays: [] }, '2026-09-01', '2026-12-01')).toEqual([]);
  });
});

describe('the clock stays put where the tutor is', () => {
  it('keeps 18:00 local across a whole month', () => {
    const out = occurrencesBetween(KARACHI, '2026-09-01', '2026-10-31');
    for (const occurrence of out) {
      expect(dateInZone(occurrence.startUtc, 'Asia/Karachi')).toBe(occurrence.date);
      const local = occurrence.startUtc.toLocaleString('en-GB', {
        timeZone: 'Asia/Karachi',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      expect(local).toBe('18:00');
    }
  });

  /**
   * The case that breaks a naive "add seven days" implementation. London puts
   * its clocks back on 2026-10-25; a Karachi-anchored series must not move.
   */
  it('does not drift across a DST change in the student\'s zone', () => {
    const out = occurrencesBetween(KARACHI, '2026-10-18', '2026-11-01');
    const utcHours = out.map((o) => o.startUtc.getUTCHours());
    // Karachi does not observe DST, so every occurrence is the same UTC hour.
    expect(new Set(utcHours).size).toBe(1);
    expect(utcHours[0]).toBe(13);
  });

  /** And the mirror: a tutor in a zone that *does* shift keeps their own hour. */
  it('keeps the tutor\'s wall clock when the tutor\'s zone shifts', () => {
    const london: SeriesDefinition = {
      weekdays: [1],
      startTimeLocal: '18:00:00',
      timezone: 'Europe/London',
      durationMinutes: 60,
      startsOn: '2026-10-19',
    };

    const out = occurrencesBetween(london, '2026-10-19', '2026-11-09');
    for (const occurrence of out) {
      const local = occurrence.startUtc.toLocaleString('en-GB', {
        timeZone: 'Europe/London',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      expect(local).toBe('18:00');
    }

    // Same wall clock, different instants: that is the point.
    expect(new Set(out.map((o) => o.startUtc.getUTCHours())).size).toBe(2);
  });
});

describe('the end time', () => {
  it('is the duration after the start', () => {
    const [first] = occurrencesBetween(KARACHI, '2026-09-07', '2026-09-09');
    expect(first!.endUtc.getTime() - first!.startUtc.getTime()).toBe(60 * 60_000);
  });
});

describe('describeSchedule', () => {
  it('reads back the way somebody would say it', () => {
    expect(describeSchedule([2, 4], '18:00:00')).toBe('Tuesdays and Thursdays at 6:00 PM');
    expect(describeSchedule([1], '09:30:00')).toBe('Mondays at 9:30 AM');
    expect(describeSchedule([1, 3, 5], '16:00')).toBe(
      'Mondays, Wednesdays and Fridays at 4:00 PM',
    );
  });

  it('sorts, so ticking Thursday first does not read back wrong', () => {
    expect(describeSchedule([4, 2], '18:00:00')).toBe('Tuesdays and Thursdays at 6:00 PM');
  });

  it('handles noon and midnight without saying 0:00 PM', () => {
    expect(describeSchedule([0], '12:00:00')).toContain('12:00 PM');
    expect(describeSchedule([0], '00:00:00')).toContain('12:00 AM');
  });
});
