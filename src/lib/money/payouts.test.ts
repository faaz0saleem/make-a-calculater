import { describe, expect, it } from 'vitest';
import { canRequestPayout, canTransitionPayout, netPayoutCents, PAYOUT_THRESHOLD_CENTS } from './payouts';

describe('canRequestPayout', () => {
  it('blocks a tutor at $99.50 and allows one at $100.00 (SPEC.md §16)', () => {
    expect(canRequestPayout(9_950, 9_950).ok).toBe(false);
    expect(canRequestPayout(10_000, 10_000).ok).toBe(true);
  });

  it('blocks a request one cent under the threshold', () => {
    expect(canRequestPayout(PAYOUT_THRESHOLD_CENTS - 1, PAYOUT_THRESHOLD_CENTS - 1).ok).toBe(false);
  });

  it('allows any amount between the threshold and the whole balance', () => {
    expect(canRequestPayout(25_000, 10_000).ok).toBe(true);
    expect(canRequestPayout(25_000, 25_000).ok).toBe(true);
  });

  it('blocks a partial request below the threshold even with a big balance', () => {
    const result = canRequestPayout(25_000, 5_000);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('$100.00');
  });

  it('blocks a request for more than is available', () => {
    expect(canRequestPayout(10_000, 10_001).ok).toBe(false);
  });

  it('explains itself in dollars, not cents', () => {
    const result = canRequestPayout(9_950, 9_950);
    expect(result.ok === false && result.reason).toContain('$99.50');
  });
});

describe('netPayoutCents', () => {
  it('defaults to no fee', () => {
    expect(netPayoutCents(10_000)).toBe(10_000);
  });

  it('deducts a configured flat fee', () => {
    expect(netPayoutCents(10_000, 250)).toBe(9_750);
  });

  it('never goes negative', () => {
    expect(netPayoutCents(100, 500)).toBe(0);
  });
});

describe('payout status machine', () => {
  it('walks requested -> approved -> processing -> paid', () => {
    expect(canTransitionPayout('requested', 'approved')).toBe(true);
    expect(canTransitionPayout('approved', 'processing')).toBe(true);
    expect(canTransitionPayout('processing', 'paid')).toBe(true);
  });

  it('allows a rejection at any stage before paid', () => {
    expect(canTransitionPayout('requested', 'rejected')).toBe(true);
    expect(canTransitionPayout('approved', 'rejected')).toBe(true);
    expect(canTransitionPayout('processing', 'rejected')).toBe(true);
  });

  it('will not reopen or skip', () => {
    expect(canTransitionPayout('paid', 'rejected')).toBe(false);
    expect(canTransitionPayout('requested', 'paid')).toBe(false);
    expect(canTransitionPayout('rejected', 'approved')).toBe(false);
  });
});
