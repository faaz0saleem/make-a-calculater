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
