/**
 * The subject catalogue (SPEC.md §4).
 *
 * Lives here rather than in the seed because production needs it too — a real
 * database is not seeded, but it still has to have these rows, and a copy of
 * the list in a hand-written SQL file would drift the first time somebody adds
 * one. `pnpm launch:sql` generates the insert from this.
 *
 * Slugs are the URL and the filter value, so they are part of the public
 * interface: renaming one breaks every link and every saved search that used
 * it. Add freely; rename with care.
 */

export type SubjectSeed = { slug: string; name: string };

export const SUBJECTS: readonly SubjectSeed[] = [
  { slug: 'math', name: 'Math' },
  { slug: 'physics', name: 'Physics' },
  { slug: 'chemistry', name: 'Chemistry' },
  { slug: 'biology', name: 'Biology' },
  { slug: 'english', name: 'English' },
  { slug: 'ielts-toefl', name: 'IELTS / TOEFL' },
  { slug: 'programming', name: 'Programming' },
  { slug: 'quran-arabic', name: 'Quran & Arabic' },
  { slug: 'business', name: 'Business' },
  { slug: 'music', name: 'Music' },
  { slug: 'test-prep', name: 'Test Prep' },
  { slug: 'languages', name: 'Languages' },
] as const;
