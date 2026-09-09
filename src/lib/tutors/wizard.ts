/**
 * The onboarding wizard (SPEC.md §3).
 *
 * Ten steps, resumable. There is no `current_step` column: which steps are done
 * is derived from the profile itself, so a tutor who fills something in through
 * another route, or whose row is edited by an admin, always sees the truth. It
 * also means the wizard cannot get stuck pointing at a step that is already
 * finished.
 *
 * Every step saves on submit, so leaving the tab open on step 4 and coming back
 * tomorrow resumes at step 4 with steps 1-3 intact.
 */

import { isValidHalfHourCents, isValidHourlyCents } from '@/lib/money/pricing';
import type { TutorStatus } from './status';

export const WIZARD_STEP_SLUGS = [
  'account',
  'identity',
  'profile',
  'video',
  'subjects',
  'credentials',
  'rates',
  'availability',
  'payout',
  'review',
] as const;

export type WizardStepSlug = (typeof WIZARD_STEP_SLUGS)[number];

export type WizardStep = {
  slug: WizardStepSlug;
  number: number;
  title: string;
  blurb: string;
  /** Optional steps do not block submission. */
  optional: boolean;
};

export const WIZARD_STEPS: readonly WizardStep[] = [
  {
    slug: 'account',
    number: 1,
    title: 'Account',
    blurb: 'Your sign-in details. Confirming your email can wait until your first payout.',
    // Optional in the sense that matters here: it does not block submission.
    // Verification nudges and gates money, not access (SPEC.md §1) — a tutor
    // whose profile is finished should be in front of students while they get
    // round to clicking a link, and the payout is where it actually bites.
    optional: true,
  },
  {
    slug: 'identity',
    number: 2,
    title: 'Identity',
    blurb: 'Name, where you are, and the languages you teach in.',
    optional: false,
  },
  {
    slug: 'profile',
    number: 3,
    title: 'Profile',
    blurb: 'A headline, a bio and a photo.',
    optional: false,
  },
  {
    slug: 'video',
    number: 4,
    title: 'Intro video',
    blurb: '30 to 90 seconds. This is what students watch before they book.',
    optional: false,
  },
  {
    slug: 'subjects',
    number: 5,
    title: 'Subjects',
    blurb: 'Up to five, each with a level and your years of experience.',
    optional: false,
  },
  {
    slug: 'credentials',
    number: 6,
    title: 'Credentials',
    blurb: 'At least one document. Only our review team ever sees the file.',
    optional: false,
  },
  { slug: 'rates', number: 7, title: 'Rates', blurb: 'What you charge, and free trials.', optional: false },
  {
    slug: 'availability',
    number: 8,
    title: 'Availability',
    blurb: 'The hours you teach, in your own timezone.',
    optional: false,
  },
  {
    slug: 'payout',
    number: 9,
    title: 'Payout details',
    blurb: 'Where your earnings go. You can leave this until your first payout.',
    optional: true,
  },
  { slug: 'review', number: 10, title: 'Submit', blurb: 'Send your profile for review.', optional: false },
];

export const HEADLINE_MAX = 80;
export const BIO_MIN = 150;
export const BIO_MAX = 2_000;
export const MAX_SUBJECTS = 5;
export const INTRO_VIDEO_MIN_SECONDS = 30;
export const INTRO_VIDEO_MAX_SECONDS = 90;
export const TRIAL_MINUTE_OPTIONS = [10, 15, 20] as const;
export const BUFFER_MINUTE_OPTIONS = [0, 5, 10, 15] as const;

/**
 * Everything the wizard needs to decide what is done. Assembled by one query in
 * `src/db/tutors.ts`; kept as a plain object so completeness stays pure.
 */
export type WizardSnapshot = {
  status: TutorStatus;
  emailVerified: boolean;
  name: string;
  country: string | null;
  city: string | null;
  timezone: string | null;
  languageCount: number;
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  introVideoStatus: 'missing' | 'uploading' | 'processing' | 'ready' | 'failed';
  introVideoSeconds: number | null;
  subjectCount: number;
  credentialCount: number;
  hourlyCents: number;
  halfHourCents: number;
  availabilityRuleCount: number;
  payoutMethodCount: number;
};

export type StepState = 'complete' | 'incomplete';

export function isHeadlineValid(headline: string | null | undefined): boolean {
  const trimmed = headline?.trim() ?? '';
  return trimmed.length > 0 && trimmed.length <= HEADLINE_MAX;
}

export function isBioValid(bio: string | null | undefined): boolean {
  const trimmed = bio?.trim() ?? '';
  return trimmed.length >= BIO_MIN && trimmed.length <= BIO_MAX;
}

export function isIntroVideoValid(snapshot: WizardSnapshot): boolean {
  if (snapshot.introVideoStatus !== 'ready') return false;
  const seconds = snapshot.introVideoSeconds;
  // Length is checked once the file has been probed. Until Phase 2 transcodes
  // and measures it, an unknown duration is accepted rather than blocking.
  if (seconds === null) return true;
  return seconds >= INTRO_VIDEO_MIN_SECONDS && seconds <= INTRO_VIDEO_MAX_SECONDS;
}

export function stepState(slug: WizardStepSlug, snapshot: WizardSnapshot): StepState {
  const done = (value: boolean): StepState => (value ? 'complete' : 'incomplete');

  switch (slug) {
    case 'account':
      return done(snapshot.emailVerified);
    case 'identity':
      return done(
        snapshot.name.trim().length >= 2 &&
          Boolean(snapshot.country) &&
          Boolean(snapshot.city) &&
          Boolean(snapshot.timezone) &&
          snapshot.languageCount > 0,
      );
    case 'profile':
      return done(isHeadlineValid(snapshot.headline) && isBioValid(snapshot.bio) && Boolean(snapshot.avatarUrl));
    case 'video':
      return done(isIntroVideoValid(snapshot));
    case 'subjects':
      return done(snapshot.subjectCount > 0 && snapshot.subjectCount <= MAX_SUBJECTS);
    case 'credentials':
      return done(snapshot.credentialCount > 0);
    case 'rates':
      return done(
        isValidHourlyCents(snapshot.hourlyCents) &&
          isValidHalfHourCents(snapshot.hourlyCents, snapshot.halfHourCents),
      );
    case 'availability':
      return done(snapshot.availabilityRuleCount > 0);
    case 'payout':
      return done(snapshot.payoutMethodCount > 0);
    case 'review':
      // The last step is done once the profile has actually left the tutor's hands.
      return done(snapshot.status !== 'draft' && snapshot.status !== 'rejected');
  }
}

export type WizardProgress = {
  steps: (WizardStep & { state: StepState })[];
  completedRequired: number;
  totalRequired: number;
  /** Steps that must be finished before the profile can be submitted. */
  blocking: WizardStep[];
  canSubmit: boolean;
  /** Where "resume" should send the tutor. */
  resumeSlug: WizardStepSlug;
};

export function wizardProgress(snapshot: WizardSnapshot): WizardProgress {
  const steps = WIZARD_STEPS.map((step) => ({ ...step, state: stepState(step.slug, snapshot) }));

  // `review` is the act of submitting, not a prerequisite for it.
  const required = steps.filter((step) => !step.optional && step.slug !== 'review');
  const blocking = required.filter((step) => step.state === 'incomplete');

  const firstIncomplete = steps.find((step) => step.state === 'incomplete' && !step.optional);

  return {
    steps,
    completedRequired: required.length - blocking.length,
    totalRequired: required.length,
    blocking,
    canSubmit: blocking.length === 0,
    resumeSlug: firstIncomplete?.slug ?? 'review',
  };
}

export function findStep(slug: string): WizardStep | undefined {
  return WIZARD_STEPS.find((step) => step.slug === slug);
}

export function nextStep(slug: WizardStepSlug): WizardStep | undefined {
  const index = WIZARD_STEPS.findIndex((step) => step.slug === slug);
  return index === -1 ? undefined : WIZARD_STEPS[index + 1];
}

export function previousStep(slug: WizardStepSlug): WizardStep | undefined {
  const index = WIZARD_STEPS.findIndex((step) => step.slug === slug);
  return index <= 0 ? undefined : WIZARD_STEPS[index - 1];
}
