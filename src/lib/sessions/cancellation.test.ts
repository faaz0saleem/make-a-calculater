import { describe, expect, it } from 'vitest';

import { cancellationConsequence, type CancellableBooking } from './cancellation';

const START = new Date('2026-04-15T18:00:00.000Z');
const booking = (overrides: Partial<CancellableBooking> = {}): CancellableBooking => ({
  startAtUtc: START,
  isTrial: false,
  priceCents: 2_500,
  ...overrides,
});

/** `minutes` before the session starts. */
const at = (minutes: number) => new Date(START.getTime() - minutes * 60_000);

describe('cancellationConsequence', () => {
  it('states the full refund more than 24 hours out', () => {
    expect(cancellationConsequence(booking(), at(48 * 60))).toContain('all $25.00');
  });

  it('states the half refund inside 24 hours', () => {
    const text = cancellationConsequence(booking(), at(12 * 60));
    expect(text).toContain('half');
    expect(text).toContain('$12.50');
  });

  it('says plainly that nothing comes back inside 2 hours', () => {
    // The SPEC.md §16 case: 90 minutes before start.
    const text = cancellationConsequence(booking(), at(90));
    expect(text).toContain('refunds nothing');
    expect(text).toContain('$25.00');
  });

  it('matches the boundaries settlement actually uses', () => {
    expect(cancellationConsequence(booking(), at(24 * 60))).toContain('half');
    expect(cancellationConsequence(booking(), at(120))).toContain('half');
    expect(cancellationConsequence(booking(), at(119))).toContain('refunds nothing');
    expect(cancellationConsequence(booking(), at(24 * 60 + 1))).toContain('all $25.00');
  });

  it('says a trial costs nothing', () => {
    expect(cancellationConsequence(booking({ isTrial: true, priceCents: 0 }), at(30))).toContain(
      'costs nothing',
    );
  });

  it('never leaves someone guessing about the amount', () => {
    for (const minutes of [4_000, 1_000, 200, 90, 5, -10]) {
      expect(cancellationConsequence(booking(), at(minutes))).toMatch(/\$\d/);
    }
  });
});
