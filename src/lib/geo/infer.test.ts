import { describe, expect, it } from 'vitest';

import { countryName, countryOptions, inferPlace, knownViewerTimezone } from './infer';
import { countryFromTimeZone } from './timezone-country';

describe('inferPlace', () => {
  it('takes the timezone the browser reports and the country it implies', () => {
    expect(inferPlace('Asia/Karachi')).toEqual({ timezone: 'Asia/Karachi', country: 'PK' });
    expect(inferPlace('Europe/London')).toEqual({ timezone: 'Europe/London', country: 'GB' });
  });

  it('falls back to UTC rather than trusting a made-up zone', () => {
    expect(inferPlace('Mars/Olympus_Mons')).toEqual({ timezone: 'UTC', country: null });
    expect(inferPlace(null)).toEqual({ timezone: 'UTC', country: null });
    expect(inferPlace('')).toEqual({ timezone: 'UTC', country: null });
  });

  it('says nothing about the country when the zone does not imply one', () => {
    // Better a blank the visitor can fill than a confident guess they have to
    // notice and undo.
    expect(inferPlace('Asia/Tashkent').country).toBeNull();
  });
});

describe('countryName', () => {
  it('turns a code into something a person reads', () => {
    expect(countryName('PK')).toBe('Pakistan');
    expect(countryName('gb')).toBe('United Kingdom');
  });

  it('returns the code rather than a blank when it does not know', () => {
    // A malformed code must not blow up a signup form.
    expect(countryName('nonsense')).toBe('nonsense');
    expect(countryName('ZZ')).toBe('Unknown Region');
    expect(countryName(null)).toBeNull();
  });
});

describe('countryOptions', () => {
  it('offers every country the timezone map can produce', () => {
    // Otherwise somebody would be shown an inferred country they cannot select
    // again after changing it by accident.
    const offered = new Set(countryOptions().map((option) => option.code));
    const inferable = new Set(
      [
        'Asia/Karachi',
        'Asia/Kolkata',
        'Europe/London',
        'America/New_York',
        'Africa/Lagos',
        'Asia/Dubai',
        'Australia/Sydney',
      ].map((zone) => countryFromTimeZone(zone)!),
    );

    for (const code of inferable) expect(offered.has(code)).toBe(true);
  });

  it('is sorted by the name, not the code', () => {
    const names = countryOptions().map((option) => option.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });
});

describe('knownViewerTimezone', () => {
  const withHeaders = (values: Record<string, string>) => new Headers(values);

  it('prefers the account over everything else', () => {
    expect(
      knownViewerTimezone({
        accountTimezone: 'Asia/Karachi',
        cookieValue: 'Europe/London',
        headers: withHeaders({ 'x-vercel-ip-timezone': 'America/New_York' }),
      }),
    ).toBe('Asia/Karachi');
  });

  it('falls back to the cookie, then to the edge, then to nothing', () => {
    const headers = withHeaders({ 'x-vercel-ip-timezone': 'America/New_York' });

    expect(knownViewerTimezone({ cookieValue: 'Europe/London', headers })).toBe('Europe/London');
    expect(knownViewerTimezone({ headers })).toBe('America/New_York');
    expect(knownViewerTimezone({})).toBeNull();
  });

  it('reads Cloudflare as well as Vercel', () => {
    expect(knownViewerTimezone({ headers: withHeaders({ 'cf-timezone': 'Asia/Dubai' }) })).toBe(
      'Asia/Dubai',
    );
  });

  it('ignores rubbish from any of the three', () => {
    // A header or a cookie is attacker-controllable in principle, and an
    // invalid zone would throw inside `Intl` at render time rather than here.
    expect(
      knownViewerTimezone({
        accountTimezone: 'Mars/Olympus',
        cookieValue: '; drop table',
        headers: withHeaders({ 'x-vercel-ip-timezone': 'not a zone' }),
      }),
    ).toBeNull();
  });

  it('returns null rather than UTC when nobody has said', () => {
    // The caller decides what to do with "unknown": the feed leaves the
    // timezone-overlap term out of its ordering, and rendering falls back to
    // UTC. Collapsing the two here would quietly rank everybody as if they
    // lived in Greenwich.
    expect(knownViewerTimezone({ accountTimezone: null, cookieValue: null })).toBeNull();
  });
});
