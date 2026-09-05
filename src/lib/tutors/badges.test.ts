import { describe, expect, it } from 'vitest';

import { badgesFor, FAST_RESPONSE_SECONDS, isFastResponder, isNewTutor, NEW_TUTOR_DAYS } from './badges';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function inputs(overrides: Partial<Parameters<typeof badgesFor>[0]> = {}) {
  return {
    offersTrial: false,
    trialMinutes: 15,
    responseMedianSeconds: null,
    verifiedAt: null,
    availableToday: null,
    ...overrides,
  };
}

describe('isNewTutor', () => {
  it('covers the first 30 days after verification', () => {
    expect(isNewTutor(daysAgo(0), NOW)).toBe(true);
    expect(isNewTutor(daysAgo(NEW_TUTOR_DAYS), NOW)).toBe(true);
    expect(isNewTutor(daysAgo(NEW_TUTOR_DAYS + 1), NOW)).toBe(false);
  });

  it('is false for a tutor who was never verified', () => {
    expect(isNewTutor(null, NOW)).toBe(false);
  });
});

describe('isFastResponder', () => {
  it('needs a median reply under an hour', () => {
    expect(isFastResponder(FAST_RESPONSE_SECONDS - 1)).toBe(true);
    expect(isFastResponder(FAST_RESPONSE_SECONDS)).toBe(false);
    expect(isFastResponder(null)).toBe(false);
  });
});

describe('badgesFor', () => {
  it('shows nothing for a plain tutor', () => {
    expect(badgesFor(inputs(), NOW)).toEqual([]);
  });

  it('names the trial length, so the offer is concrete', () => {
    const [badge] = badgesFor(inputs({ offersTrial: true, trialMinutes: 20 }), NOW);
    expect(badge?.label).toBe('Free 20-min trial');
  });

  it('hides "Available today" while the calendar does not know', () => {
    const kinds = badgesFor(inputs({ availableToday: null }), NOW).map((badge) => badge.kind);
    expect(kinds).not.toContain('available_today');
  });

  it('hides it when the calendar says no', () => {
    const kinds = badgesFor(inputs({ availableToday: false }), NOW).map((badge) => badge.kind);
    expect(kinds).not.toContain('available_today');
  });

  it('shows it only when the calendar says yes', () => {
    const kinds = badgesFor(inputs({ availableToday: true }), NOW).map((badge) => badge.kind);
    expect(kinds).toContain('available_today');
  });

  it('puts the most useful badge first', () => {
    const kinds = badgesFor(
      inputs({
        offersTrial: true,
        availableToday: true,
        responseMedianSeconds: 300,
        verifiedAt: daysAgo(3),
      }),
      NOW,
    ).map((badge) => badge.kind);

    expect(kinds).toEqual(['free_trial', 'available_today', 'fast_responder', 'new']);
  });
});
