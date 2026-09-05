import { describe, expect, it } from 'vitest';

import {
  isRestricted,
  nextSanctionLevel,
  RESTRICTION_DAYS,
  restrictionEndsAt,
  SANCTION_COPY,
  unacknowledgedWarning,
} from './sanctions';

describe('the ladder', () => {
  it('starts with a warning, not a punishment', () => {
    expect(nextSanctionLevel(0)).toBe('warning');
  });

  it('takes away future business on the second confirmed attempt', () => {
    expect(nextSanctionLevel(1)).toBe('restriction');
  });

  it('sends the third to a person rather than acting', () => {
    expect(nextSanctionLevel(2)).toBe('review');
    expect(nextSanctionLevel(9)).toBe('review');
  });

  it('has no rung that stops somebody teaching their existing students', () => {
    // The rung that would is the one that pushes fifteen students to WhatsApp.
    for (const level of ['warning', 'restriction', 'review'] as const) {
      expect(SANCTION_COPY[level].consequence.toLowerCase()).not.toContain('suspended');
    }
    expect(SANCTION_COPY.restriction.consequence).toContain('current students');
  });

  it('tells the admin the consequence before they cause it', () => {
    for (const level of ['warning', 'restriction', 'review'] as const) {
      expect(SANCTION_COPY[level].adminWarning.length).toBeGreaterThan(40);
    }
  });
});

describe('restrictions expiring', () => {
  const now = new Date('2026-09-05T00:00:00Z');

  it('lasts the documented number of days', () => {
    const end = restrictionEndsAt(now)!;
    expect(end.getTime() - now.getTime()).toBe(RESTRICTION_DAYS * 86_400_000);
  });

  it('applies while it is live', () => {
    expect(
      isRestricted([{ level: 'restriction', restrictedUntil: restrictionEndsAt(now), status: 'issued' }], now),
    ).toBe(true);
  });

  it('stops applying on its own, without anybody remembering to lift it', () => {
    const expired = new Date(now.getTime() - 1_000);
    expect(isRestricted([{ level: 'restriction', restrictedUntil: expired, status: 'issued' }], now)).toBe(
      false,
    );
  });

  it('stops applying the moment an appeal succeeds', () => {
    expect(
      isRestricted([{ level: 'restriction', restrictedUntil: restrictionEndsAt(now), status: 'lifted' }], now),
    ).toBe(false);
  });

  it('does not treat a warning as a restriction', () => {
    expect(isRestricted([{ level: 'warning', restrictedUntil: null, status: 'issued' }], now)).toBe(false);
  });
});

describe('acknowledgement', () => {
  it('finds the one still waiting to be read', () => {
    const found = unacknowledgedWarning([
      { level: 'warning', acknowledgedAt: new Date() },
      { level: 'restriction', acknowledgedAt: null },
    ]);
    expect(found?.level).toBe('restriction');
  });

  it('is null when everything has been seen', () => {
    expect(unacknowledgedWarning([{ level: 'warning', acknowledgedAt: new Date() }])).toBeNull();
  });
});
