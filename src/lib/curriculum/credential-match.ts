/**
 * Does the paperwork look like it supports what they say they teach?
 *
 * This raises a **flag for a human**, never a decision. A physics graduate who
 * has taught GCSE English for a decade is a real person and a good tutor, and
 * an automatic rejection would lose them. What an admin wants is not to be
 * told the answer but to be told where to look: "they teach Chemistry and
 * nothing they uploaded mentions chemistry — ask about it."
 *
 * The matching is deliberately crude and deliberately generous. Every rule
 * here can only ever *remove* a flag, never add a rejection, so a keyword list
 * that is too broad costs an admin nothing and one that is too narrow costs
 * them a pointless question. When in doubt, add the word.
 *
 * Pure: no database, no clock.
 */

/**
 * Words in a qualification that make a subject plausible.
 *
 * A degree does not have to be *in* the subject. A mathematics degree supports
 * teaching physics; an engineering degree supports both. A teaching licence or
 * a PGCE supports anything, because that is exactly what it certifies.
 */
const SUBJECT_KEYWORDS: Record<string, string[]> = {
  math: [
    'math', 'mathematic', 'statistic', 'actuar', 'econom', 'engineer', 'physic',
    'computer', 'quantitative', 'accounting', 'finance',
  ],
  physics: ['physic', 'engineer', 'math', 'astronom', 'mechanic', 'electric', 'science'],
  chemistry: ['chem', 'biochem', 'pharma', 'material', 'chemical', 'science', 'medic'],
  biology: ['bio', 'life science', 'zoolog', 'botan', 'medic', 'mbbs', 'nurs', 'science', 'genetic'],
  english: ['english', 'literature', 'linguistic', 'journalis', 'humanit', 'writing', 'tesol', 'celta'],
  'ielts-toefl': ['english', 'linguistic', 'tesol', 'celta', 'tefl', 'ielts', 'toefl', 'literature'],
  programming: [
    'computer', 'software', 'informatic', 'information technolog', 'data', 'engineer',
    'math', 'cs', 'programming',
  ],
  'quran-arabic': ['arabic', 'quran', 'islam', 'shariah', 'hifz', 'tajweed', 'linguistic', 'theolog'],
  business: ['business', 'commerce', 'econom', 'accounting', 'finance', 'management', 'mba', 'marketing'],
  music: ['music', 'conservat', 'performance', 'abrsm', 'trinity', 'composition'],
  'test-prep': ['education', 'teach', 'math', 'english', 'psycholog', 'test', 'sat', 'gre', 'gmat'],
  languages: ['language', 'linguistic', 'literature', 'translat', 'philolog', 'tesol', 'celta'],
};

/**
 * Qualifications that support anything.
 *
 * A teaching licence certifies the ability to teach, and a school or ministry
 * of education has already checked the subject. Flagging those would flag the
 * best-evidenced tutors on the platform.
 */
const UNIVERSAL_KEYWORDS = [
  'teaching licence',
  'teaching license',
  'teacher',
  'pgce',
  'b.ed',
  'bed ',
  'm.ed',
  'education',
  'qualified teacher',
];

export type CredentialSummary = {
  kind: string;
  title: string;
  institution: string;
};

export type SubjectClaim = {
  slug: string;
  name: string;
};

export type CredentialFlag = {
  subjectSlug: string;
  subjectName: string;
  reason: string;
};

function haystack(documents: readonly CredentialSummary[]): string {
  return documents
    .map((document) => `${document.title} ${document.institution}`)
    .join(' | ')
    .toLowerCase();
}

/** True when any uploaded document certifies teaching in general. */
export function hasTeachingQualification(documents: readonly CredentialSummary[]): boolean {
  const text = haystack(documents);
  if (documents.some((document) => document.kind === 'teaching_licence')) return true;
  return UNIVERSAL_KEYWORDS.some((keyword) => text.includes(keyword));
}

/**
 * Subjects with no visible support in the uploaded documents.
 *
 * Empty when there is nothing to compare against — no documents, or none that
 * are qualifications. Silence is the right answer when we know nothing; a flag
 * would just be noise on every profile.
 */
export function unsupportedSubjects(
  claims: readonly SubjectClaim[],
  documents: readonly CredentialSummary[],
): CredentialFlag[] {
  // Identity documents say who somebody is, not what they know.
  const qualifications = documents.filter((document) => document.kind !== 'id');
  if (qualifications.length === 0 || claims.length === 0) return [];
  if (hasTeachingQualification(qualifications)) return [];

  const text = haystack(qualifications);

  return claims
    .filter((claim) => {
      const keywords = SUBJECT_KEYWORDS[claim.slug];
      // A subject nobody wrote a keyword list for is never flagged. Guessing
      // about a subject we have not thought about is worse than staying quiet.
      if (!keywords) return false;
      if (claim.name.toLowerCase().split(/\s+/).some((word) => word.length > 3 && text.includes(word))) {
        return false;
      }
      return !keywords.some((keyword) => text.includes(keyword));
    })
    .map((claim) => ({
      subjectSlug: claim.slug,
      subjectName: claim.name,
      reason: `Nothing in the uploaded documents mentions ${claim.name.toLowerCase()} or a related field.`,
    }));
}
