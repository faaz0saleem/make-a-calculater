/**
 * What we can work out about a visitor without asking them anything.
 *
 * Timezone and country are both inferrable from the browser, and asking for
 * them costs more than getting them wrong does. A wrong timezone is visible
 * immediately — every time is displayed in it — and a wrong country only
 * reorders two lists. So: infer, **show what was inferred**, and let them
 * correct it. Never a required field.
 *
 * This matters more than it looks. The timezone feeds the overlap term in the
 * ranking, so a student who never answers a question still gets tutors who are
 * awake when they are.
 */

import { countryFromTimeZone } from './timezone-country';
import { isValidTimeZone } from '@/lib/time';

export type InferredPlace = {
  timezone: string;
  /** ISO 3166-1 alpha-2, or null when the timezone tells us nothing. */
  country: string | null;
};

/** The countries offered in the "that's not right" corrector, most likely first. */
export const COUNTRY_CHOICES = [
  'PK',
  'IN',
  'AE',
  'SA',
  'QA',
  'OM',
  'KW',
  'BH',
  'GB',
  'US',
  'CA',
  'AU',
  'NZ',
  'BD',
  'LK',
  'NP',
  'MY',
  'SG',
  'ID',
  'PH',
  'NG',
  'GH',
  'KE',
  'ZA',
  'EG',
  'TR',
  'DE',
  'FR',
  'ES',
  'IT',
  'NL',
  'IE',
  'SE',
  'NO',
  'DK',
  'PL',
  'PT',
  'CH',
  'AT',
  'BR',
  'MX',
  'AR',
  'CL',
  'CO',
] as const;

export function inferPlace(timezone: string | null | undefined): InferredPlace {
  const zone = timezone && isValidTimeZone(timezone) ? timezone : 'UTC';
  return { timezone: zone, country: countryFromTimeZone(zone) };
}

/**
 * "Pakistan" from "PK".
 *
 * `Intl.DisplayNames` ships with the runtime, so there is no country-name table
 * to keep up to date and no translation to write. An unknown code comes back as
 * itself rather than as a blank.
 */
export function countryName(code: string | null | undefined, locale = 'en'): string | null {
  if (!code) return null;

  try {
    // `fallback: 'code'` so an unrecognised code comes back as itself rather
    // than as undefined, and a malformed one throws into the catch below.
    return (
      new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }).of(code.toUpperCase()) ??
      code
    );
  } catch {
    return code;
  }
}

/** The corrector's options, alphabetical by the name a person reads. */
export function countryOptions(locale = 'en'): { code: string; name: string }[] {
  return COUNTRY_CHOICES.map((code) => ({ code, name: countryName(code, locale) ?? code })).sort(
    (a, b) => a.name.localeCompare(b.name),
  );
}

/**
 * The timezone the edge already knows, before the browser gets a chance to say.
 *
 * The probe in `TimezoneProbe` is fast but it is not instant: a first-time
 * signed-out visitor has no cookie, so the first paint of a calendar labels
 * every time UTC and then swaps. The label is honest and the swap is quick,
 * but somebody in Karachi still sees 09:00 for a lesson that is at 14:00 for
 * them, which is exactly the mistake this product cannot afford to make even
 * for a moment.
 *
 * Both Vercel and Cloudflare resolve the visitor's timezone at the edge and
 * pass it as a header, so most of the time there is no need to guess. Absent
 * or nonsense, we are back to UTC and the probe, which is where we were.
 */
const EDGE_TIMEZONE_HEADERS = ['x-vercel-ip-timezone', 'cf-timezone'] as const;

export function timezoneFromHeaders(headers: Headers): string | null {
  for (const name of EDGE_TIMEZONE_HEADERS) {
    const value = headers.get(name)?.trim();
    if (value && isValidTimeZone(value)) return value;
  }
  return null;
}

/**
 * Where to render this viewer's times, best source first.
 *
 * Their account, then the cookie their browser set, then whatever the edge
 * knows, then UTC. Returns null rather than UTC when nothing is known, because
 * two callers need to tell those apart: the ranking leaves the overlap term
 * out entirely rather than pretending everybody lives in Greenwich.
 */
export function knownViewerTimezone(input: {
  accountTimezone?: string | null;
  cookieValue?: string | null;
  headers?: Headers | null;
}): string | null {
  if (input.accountTimezone && isValidTimeZone(input.accountTimezone)) return input.accountTimezone;
  if (input.cookieValue && isValidTimeZone(input.cookieValue)) return input.cookieValue;
  if (input.headers) return timezoneFromHeaders(input.headers);
  return null;
}
