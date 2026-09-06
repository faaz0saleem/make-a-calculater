import { describe, expect, it } from 'vitest';

import { buildIcs, googleCalendarUrl, toIcsStamp } from './ics';

const EVENT = {
  bookingId: '11111111-2222-3333-4444-555555555555',
  title: 'Chemistry with Sadia',
  description: 'Acids, bases and salts; Electrochemistry',
  startUtc: new Date('2026-09-15T13:00:00Z'),
  endUtc: new Date('2026-09-15T14:00:00Z'),
  url: 'https://tutorly.test/sessions/abc',
};

describe('the stamp format', () => {
  it('is the basic UTC form every client parses', () => {
    expect(toIcsStamp(new Date('2026-09-15T13:00:00.000Z'))).toBe('20260915T130000Z');
  });
});

describe('the file', () => {
  const ics = buildIcs(EVENT, new Date('2026-09-01T00:00:00Z'));

  it('is a whole calendar with one event', () => {
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics.endsWith('\r\n')).toBe(true);
  });

  it('uses CRLF, which the spec requires and some clients enforce', () => {
    expect(ics.includes('\r\n')).toBe(true);
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  /**
   * The one that decides whether these are trusted. A moved session has to
   * replace the old entry; without a stable UID a reschedule leaves two
   * lessons in somebody's calendar and they stop adding them.
   */
  it('keeps one UID per booking, whatever else changes', () => {
    const moved = buildIcs({ ...EVENT, startUtc: new Date('2026-09-16T13:00:00Z'), sequence: 1 });
    expect(ics).toContain(`UID:booking-${EVENT.bookingId}@tutorly`);
    expect(moved).toContain(`UID:booking-${EVENT.bookingId}@tutorly`);
    expect(moved).toContain('SEQUENCE:1');
  });

  it('escapes the separators, so a chapter with a comma stays one field', () => {
    const tricky = buildIcs({ ...EVENT, description: 'Acids, bases; and salts\\here' });
    expect(tricky).toContain('Acids\\, bases\; and salts\\\\here');
  });

  it('folds long lines at 75 octets', () => {
    const long = buildIcs({ ...EVENT, description: 'x'.repeat(400) });
    for (const line of long.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
  });

  it('carries an alarm, so it fires with the app closed', () => {
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-PT15M');
  });

  it('can cancel the entry rather than leaving a ghost', () => {
    const cancelled = buildIcs({ ...EVENT, cancelled: true, sequence: 2 });
    expect(cancelled).toContain('METHOD:CANCEL');
    expect(cancelled).toContain('STATUS:CANCELLED');
  });
});

describe('the Google link', () => {
  const url = new URL(googleCalendarUrl(EVENT));

  it('carries the times in the form Google expects', () => {
    expect(url.searchParams.get('dates')).toBe('20260915T130000Z/20260915T140000Z');
  });

  it('puts the room in the details, so the link is one tap from the entry', () => {
    expect(url.searchParams.get('details')).toContain(EVENT.url);
    expect(url.searchParams.get('text')).toBe(EVENT.title);
  });
});
