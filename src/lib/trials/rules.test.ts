import { describe, expect, it } from 'vitest';

import {
  MAX_OUTSTANDING_TRIAL_REQUESTS,
  MAX_TRIALS_PER_STUDENT_PER_WEEK,
  isTrialRequestExpired,
  trialExpiresAt,
  trialProblemMessage,
  trialRequestProblem,
  trialSecondsRemaining,
  type TrialRequestFacts,
} from './rules';

const NOW = new Date('2026-04-15T10:00:00Z');
const hours = (n: number) => n * 3_600_000;

describe('trialExpiresAt', () => {
  it('is twelve hours after the request when the slot is far away', () => {
    const expiry = trialExpiresAt(NOW, new Date('2026-04-20T09:00:00Z'));
    expect(expiry.toISOString()).toBe('2026-04-15T22:00:00.000Z');
  });

  it('is two hours before the start when the slot is soon', () => {
    // Requested at 10:00 for a 15:00 slot: twelve hours would be 22:00, but the
    // slot's own cutoff at 13:00 comes first.
    const expiry = trialExpiresAt(NOW, new Date('2026-04-15T15:00:00Z'));
    expect(expiry.toISOString()).toBe('2026-04-15T13:00:00.000Z');
  });

  it('takes whichever comes first, exactly at the crossover', () => {
    // A slot fourteen hours out puts both rules at the same instant.
    const expiry = trialExpiresAt(NOW, new Date(NOW.getTime() + hours(14)));
    expect(expiry.getTime()).toBe(NOW.getTime() + hours(12));
  });
});

describe('isTrialRequestExpired', () => {
  const request = { requestedAt: NOW, startAtUtc: new Date('2026-04-20T09:00:00Z') };

  it('is answerable inside the window', () => {
    expect(isTrialRequestExpired(request, new Date(NOW.getTime() + hours(11)))).toBe(false);
  });

  it('is dead at the boundary, not a second later', () => {
    expect(isTrialRequestExpired(request, new Date(NOW.getTime() + hours(12)))).toBe(true);
  });

  it('counts down in seconds and floors at zero', () => {
    expect(trialSecondsRemaining(request, NOW)).toBe(12 * 3_600);
    expect(trialSecondsRemaining(request, new Date(NOW.getTime() + hours(20)))).toBe(0);
  });
});

describe('trialRequestProblem', () => {
  const base: TrialRequestFacts = {
    offersTrial: true,
    verified: true,
    tutorRestricted: false,
    maxTrialsPerWeek: 5,
    isSelf: false,
    pairHasTrial: false,
    outstandingRequests: 0,
    trialsThisWeek: 0,
    tutorTrialsThisWeek: 0,
    startAtUtc: new Date('2026-04-16T10:00:00Z'),
  };

  it('lets a first-time student ask', () => {
    expect(trialRequestProblem(base, NOW)).toBeNull();
  });

  it('turns away a new trial request from a restricted tutor', () => {
    expect(trialRequestProblem({ ...base, tutorRestricted: true }, NOW)).toBe('tutor_restricted');
  });

  it('tells the student they can still pay that tutor, because they can', () => {
    // The restriction takes away the tutor's next student, not their current
    // ones. A message that read like a ban would be wrong and would also send
    // the student looking for them somewhere else.
    expect(trialProblemMessage('tutor_restricted')).toContain('book a paid session');
  });

  it('refuses a second trial with the same tutor, ever', () => {
    expect(trialRequestProblem({ ...base, pairHasTrial: true }, NOW)).toBe('already_used');
  });

  it('refuses a tutor who does not offer trials, or is not verified', () => {
    expect(trialRequestProblem({ ...base, offersTrial: false }, NOW)).toBe('not_offered');
    expect(trialRequestProblem({ ...base, verified: false }, NOW)).toBe('not_verified');
  });

  it('refuses booking a trial with yourself', () => {
    expect(trialRequestProblem({ ...base, isSelf: true }, NOW)).toBe('own_profile');
  });

  it('holds the three-outstanding line', () => {
    expect(
      trialRequestProblem({ ...base, outstandingRequests: MAX_OUTSTANDING_TRIAL_REQUESTS - 1 }, NOW),
    ).toBeNull();
    expect(
      trialRequestProblem({ ...base, outstandingRequests: MAX_OUTSTANDING_TRIAL_REQUESTS }, NOW),
    ).toBe('too_many_outstanding');
  });

  it('holds the five-a-week line across all tutors', () => {
    expect(
      trialRequestProblem({ ...base, trialsThisWeek: MAX_TRIALS_PER_STUDENT_PER_WEEK - 1 }, NOW),
    ).toBeNull();
    expect(
      trialRequestProblem({ ...base, trialsThisWeek: MAX_TRIALS_PER_STUDENT_PER_WEEK }, NOW),
    ).toBe('too_many_this_week');
  });

  it("respects the tutor's own weekly cap", () => {
    expect(trialRequestProblem({ ...base, maxTrialsPerWeek: 2, tutorTrialsThisWeek: 2 }, NOW)).toBe(
      'tutor_full_this_week',
    );
  });

  it('refuses a slot too close to start to be answered', () => {
    // Ninety minutes out: the request would be born expired.
    const soon = new Date(NOW.getTime() + 90 * 60_000);
    expect(trialRequestProblem({ ...base, startAtUtc: soon }, NOW)).toBe('too_late');
  });

  it('allows a slot just past the cutoff', () => {
    const later = new Date(NOW.getTime() + 121 * 60_000);
    expect(trialRequestProblem({ ...base, startAtUtc: later }, NOW)).toBeNull();
  });

  it('says something a person can act on for every problem', () => {
    const problems = [
      'not_offered', 'own_profile', 'already_used', 'too_many_outstanding',
      'too_many_this_week', 'tutor_full_this_week', 'too_late', 'not_verified',
    ] as const;
    for (const problem of problems) {
      expect(trialProblemMessage(problem).length).toBeGreaterThan(20);
    }
  });
});
