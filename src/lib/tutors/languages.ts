/**
 * The languages a tutor can say they teach in (SPEC.md §3 step 2, §4 filters).
 *
 * A short controlled list rather than free text, so the search filter has
 * something to match on. Add to it as demand appears.
 */

export const LANGUAGE_PROFICIENCIES = ['basic', 'conversational', 'fluent', 'native'] as const;
export type LanguageProficiency = (typeof LANGUAGE_PROFICIENCIES)[number];

export const PROFICIENCY_LABELS: Record<LanguageProficiency, string> = {
  basic: 'Basic',
  conversational: 'Conversational',
  fluent: 'Fluent',
  native: 'Native',
};

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ur', name: 'Urdu' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'bn', name: 'Bengali' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'zh', name: 'Mandarin' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'fa', name: 'Persian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'tl', name: 'Filipino' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export function isLanguageCode(value: string): value is LanguageCode {
  return LANGUAGES.some((language) => language.code === value);
}

export function languageName(code: string): string {
  return LANGUAGES.find((language) => language.code === code)?.name ?? code;
}

export function isProficiency(value: string): value is LanguageProficiency {
  return (LANGUAGE_PROFICIENCIES as readonly string[]).includes(value);
}
