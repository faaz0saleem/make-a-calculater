import { describe, expect, it } from 'vitest';

import { applyCommission } from './pricing';
import { CREDIT_PACKS, findPack, packBonusBps } from './packs';
import { FIRST_BOOKING_COMMISSION_BPS } from './commission';
import { providerFeeCents, PAYMENT_METHODS } from '@/lib/payments/catalogue';

describe('credit packs', () => {
  it('is the repriced table: a $5 taste, and no bonus below $50', () => {
    expect(CREDIT_PACKS.map((pack) => [pack.paidCents, pack.creditsCents])).toEqual([
      [500, 500],
      [1_000, 1_000],
      [2_500, 2_500],
      [5_000, 5_150],
      [10_000, 10_500],
    ]);
  });

  it('advertises the right bonus percentages', () => {
    expect(CREDIT_PACKS.map(packBonusBps)).toEqual([0, 0, 0, 300, 500]);
  });

  it('is all integer cents', () => {
    for (const pack of CREDIT_PACKS) {
      expect(Number.isInteger(pack.paidCents)).toBe(true);
      expect(Number.isInteger(pack.creditsCents)).toBe(true);
    }
  });

  it('looks packs up by id', () => {
    expect(findPack('pro')?.creditsCents).toBe(10_500);
    expect(findPack('nope')).toBeUndefined();
  });

  it('restricts exactly one pack to a first purchase', () => {
    const restricted = CREDIT_PACKS.filter((pack) => pack.firstPurchaseOnly);
    expect(restricted.map((pack) => pack.id)).toEqual(['taste']);
    // And it is the cheapest, which is why it has to be restricted at all.
    expect(Math.min(...CREDIT_PACKS.map((pack) => pack.paidCents))).toBe(restricted[0]!.paidCents);
  });
});

describe('what the bonus actually costs', () => {
  /**
   * A credit is a claim on a lesson, and a lesson costs us the tutor's share of
   * it. So a dollar of bonus is not a dollar of marketing spend — it is about
   * 78c of real payout. These are the numbers behind the tiers being 0/3/5
   * rather than 4/8/10, written down so a future "let's be generous" has to
   * argue with them.
   */
  it('costs roughly 78c of payout per dollar given away', () => {
    const bonusCents = 500; // the Pro pack's bonus
    const { tutorCents } = applyCommission(bonusCents, FIRST_BOOKING_COMMISSION_BPS);
    expect(tutorCents).toBe(390);
    expect(tutorCents / bonusCents).toBeCloseTo(0.78, 2);
  });

  it('never gives away more than the pack earns', () => {
    // A sanity bound, not a margin model: the bonus must not exceed what we
    // take from the credits it buys.
    for (const pack of CREDIT_PACKS) {
      const bonusCents = pack.creditsCents - pack.paidCents;
      const takeIfAllSpent = applyCommission(pack.creditsCents, FIRST_BOOKING_COMMISSION_BPS)
        .platformCents;
      expect(bonusCents).toBeLessThan(takeIfAllSpent);
    }
  });
});

describe('what a purchase costs us to process', () => {
  const card = PAYMENT_METHODS.find((method) => method.id === 'mock')!;
  const wallet = PAYMENT_METHODS.find((method) => method.id === 'jazzcash')!;

  it('shows why the fixed fee is what makes a $5 purchase bad', () => {
    // 5% + 50c on $5 is 75c — fifteen percent of the transaction we most want
    // somebody to make.
    expect(providerFeeCents(card, 500)).toBe(75);
    expect(providerFeeCents(card, 500) / 500).toBeGreaterThan(0.14);

    // The same purchase through a wallet is 10c.
    expect(providerFeeCents(wallet, 500)).toBe(10);
  });

  it('shows the gap closing as the purchase grows', () => {
    // At $100 the fixed fee stops mattering and the rate does.
    expect(providerFeeCents(card, 10_000)).toBe(550);
    expect(providerFeeCents(wallet, 10_000)).toBe(200);
  });
});
