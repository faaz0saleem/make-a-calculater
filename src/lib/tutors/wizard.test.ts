import { describe, expect, it } from 'vitest';

import {
  BIO_MAX,
  BIO_MIN,
  findStep,
  HEADLINE_MAX,
  isBioValid,
  isHeadlineValid,
  nextStep,
  previousStep,
  stepState,
  wizardProgress,
  WIZARD_STEPS,
  WIZARD_STEP_SLUGS,
  type WizardSnapshot,
} from './wizard';

/** A profile with every required step finished. */
function completeSnapshot(overrides: Partial<WizardSnapshot> = {}): WizardSnapshot {
  return {
    status: 'draft',
    emailVerified: true,
    name: 'Hassan Raza',
    country: 'PK',
    city: 'Karachi',
    timezone: 'Asia/Karachi',
    languageCount: 2,
    headline: 'Exam-focused physics tutor',
    bio: 'x'.repeat(BIO_MIN),
    avatarUrl: 'https://cdn.example/avatar.jpg',
    introVideoStatus: 'ready',
    introVideoSeconds: 60,
    subjectCount: 3,
    credentialCount: 1,
    hourlyCents: 2_500,
    halfHourCents: 1_250,
    availabilityRuleCount: 5,
    payoutMethodCount: 0,
    ...overrides,
  };
}

describe('the ten steps', () => {
  it('matches SPEC.md §3, in order', () => {
    expect(WIZARD_STEP_SLUGS).toEqual([
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
    ]);
    expect(WIZARD_STEPS.map((step) => step.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('marks only payout details as optional (SPEC.md §3 step 9)', () => {
    expect(WIZARD_STEPS.filter((step) => step.optional).map((step) => step.slug)).toEqual(['payout']);
  });

  it('walks forwards and backwards', () => {
    expect(nextStep('account')?.slug).toBe('identity');
    expect(previousStep('identity')?.slug).toBe('account');
    expect(previousStep('account')).toBeUndefined();
    expect(nextStep('review')).toBeUndefined();
    expect(findStep('rates')?.number).toBe(7);
    expect(findStep('nonsense')).toBeUndefined();
  });
});

describe('field rules', () => {
  it('caps the headline at 80 characters', () => {
    expect(HEADLINE_MAX).toBe(80);
    expect(isHeadlineValid('a'.repeat(80))).toBe(true);
    expect(isHeadlineValid('a'.repeat(81))).toBe(false);
    expect(isHeadlineValid('   ')).toBe(false);
    expect(isHeadlineValid(null)).toBe(false);
  });

  it('holds the bio between 150 and 2000 characters', () => {
    expect([BIO_MIN, BIO_MAX]).toEqual([150, 2_000]);
    expect(isBioValid('a'.repeat(149))).toBe(false);
    expect(isBioValid('a'.repeat(150))).toBe(true);
    expect(isBioValid('a'.repeat(2_000))).toBe(true);
    expect(isBioValid('a'.repeat(2_001))).toBe(false);
  });
});

describe('step completion', () => {
  it('calls every required step complete for a finished profile', () => {
    const snapshot = completeSnapshot();
    for (const step of WIZARD_STEPS) {
      if (step.slug === 'payout' || step.slug === 'review') continue;
      expect(stepState(step.slug, snapshot)).toBe('complete');
    }
  });

  it('needs a verified email for step 1', () => {
    expect(stepState('account', completeSnapshot({ emailVerified: false }))).toBe('incomplete');
  });

  it('needs a country, city, timezone and at least one language for identity', () => {
    expect(stepState('identity', completeSnapshot({ country: null }))).toBe('incomplete');
    expect(stepState('identity', completeSnapshot({ city: null }))).toBe('incomplete');
    expect(stepState('identity', completeSnapshot({ timezone: null }))).toBe('incomplete');
    expect(stepState('identity', completeSnapshot({ languageCount: 0 }))).toBe('incomplete');
  });

  it('needs a headline, a long enough bio and a photo for the profile step', () => {
    expect(stepState('profile', completeSnapshot({ headline: null }))).toBe('incomplete');
    expect(stepState('profile', completeSnapshot({ bio: 'too short' }))).toBe('incomplete');
    expect(stepState('profile', completeSnapshot({ avatarUrl: null }))).toBe('incomplete');
  });

  it('needs the video to have finished uploading', () => {
    expect(stepState('video', completeSnapshot({ introVideoStatus: 'missing' }))).toBe('incomplete');
    expect(stepState('video', completeSnapshot({ introVideoStatus: 'processing' }))).toBe('incomplete');
    expect(stepState('video', completeSnapshot({ introVideoStatus: 'failed' }))).toBe('incomplete');
  });

  it('holds the video between 30 and 90 seconds once the length is known', () => {
    expect(stepState('video', completeSnapshot({ introVideoSeconds: 29 }))).toBe('incomplete');
    expect(stepState('video', completeSnapshot({ introVideoSeconds: 30 }))).toBe('complete');
    expect(stepState('video', completeSnapshot({ introVideoSeconds: 90 }))).toBe('complete');
    expect(stepState('video', completeSnapshot({ introVideoSeconds: 91 }))).toBe('incomplete');
  });

  it('accepts an unmeasured video, because transcoding is Phase 2', () => {
    expect(stepState('video', completeSnapshot({ introVideoSeconds: null }))).toBe('complete');
  });

  it('allows one to five subjects and no more', () => {
    expect(stepState('subjects', completeSnapshot({ subjectCount: 0 }))).toBe('incomplete');
    expect(stepState('subjects', completeSnapshot({ subjectCount: 5 }))).toBe('complete');
    expect(stepState('subjects', completeSnapshot({ subjectCount: 6 }))).toBe('incomplete');
  });

  it('needs at least one credential document', () => {
    expect(stepState('credentials', completeSnapshot({ credentialCount: 0 }))).toBe('incomplete');
  });

  it('needs rates inside the bounds from SPEC.md §2', () => {
    expect(stepState('rates', completeSnapshot({ hourlyCents: 499 }))).toBe('incomplete');
    expect(stepState('rates', completeSnapshot({ hourlyCents: 20_001 }))).toBe('incomplete');
    // 30 minutes may not cost the same as 60.
    expect(stepState('rates', completeSnapshot({ halfHourCents: 2_500 }))).toBe('incomplete');
  });

  it('needs at least one availability rule', () => {
    expect(stepState('availability', completeSnapshot({ availabilityRuleCount: 0 }))).toBe('incomplete');
  });

  it('treats payout details as done only once a method exists', () => {
    expect(stepState('payout', completeSnapshot())).toBe('incomplete');
    expect(stepState('payout', completeSnapshot({ payoutMethodCount: 1 }))).toBe('complete');
  });

  it('treats the final step as done once the profile has been submitted', () => {
    expect(stepState('review', completeSnapshot({ status: 'draft' }))).toBe('incomplete');
    expect(stepState('review', completeSnapshot({ status: 'rejected' }))).toBe('incomplete');
    expect(stepState('review', completeSnapshot({ status: 'pending_review' }))).toBe('complete');
    expect(stepState('review', completeSnapshot({ status: 'verified' }))).toBe('complete');
  });
});

describe('wizardProgress', () => {
  it('lets a finished profile submit, without payout details', () => {
    const progress = wizardProgress(completeSnapshot());
    expect(progress.canSubmit).toBe(true);
    expect(progress.blocking).toEqual([]);
    expect(progress.completedRequired).toBe(progress.totalRequired);
    expect(progress.totalRequired).toBe(8);
    expect(progress.resumeSlug).toBe('review');
  });

  it('blocks submission and names every missing step', () => {
    const progress = wizardProgress(
      completeSnapshot({ credentialCount: 0, availabilityRuleCount: 0, bio: null }),
    );
    expect(progress.canSubmit).toBe(false);
    expect(progress.blocking.map((step) => step.slug)).toEqual(['profile', 'credentials', 'availability']);
    expect(progress.completedRequired).toBe(5);
  });

  it('resumes at the first unfinished step', () => {
    // An empty profile resumes at identity, because the account already exists.
    const empty = wizardProgress(
      completeSnapshot({
        country: null,
        headline: null,
        introVideoStatus: 'missing',
        subjectCount: 0,
        credentialCount: 0,
        availabilityRuleCount: 0,
      }),
    );
    expect(empty.resumeSlug).toBe('identity');

    // Fill identity in and it moves on, leaving the earlier steps done.
    const partway = wizardProgress(
      completeSnapshot({ introVideoStatus: 'missing', subjectCount: 0, credentialCount: 0 }),
    );
    expect(partway.resumeSlug).toBe('video');
  });

  it('does not send a tutor back to an optional step', () => {
    const progress = wizardProgress(completeSnapshot({ payoutMethodCount: 0 }));
    expect(progress.resumeSlug).not.toBe('payout');
    expect(progress.canSubmit).toBe(true);
  });

  it('reports a state for every step', () => {
    expect(wizardProgress(completeSnapshot()).steps).toHaveLength(WIZARD_STEPS.length);
  });
});
