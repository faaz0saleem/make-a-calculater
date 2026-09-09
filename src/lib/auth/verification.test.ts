import { describe, expect, it } from 'vitest';

import { CREDIT_PACKS } from '@/lib/money/packs';
import {
  payoutGate,
  purchaseGate,
  VERIFIED_PURCHASE_THRESHOLD_CENTS,
} from './verification';

/**
 * The decision under test is a product one: verification nudges, and gates only
 * money. These two functions are the whole of "only money", so the line is
 * pinned here rather than living in a condition inside a form handler.
 */
describe('purchaseGate', () => {
  it('lets a verified account buy anything', () => {
    for (const pack of CREDIT_PACKS) {
      expect(purchaseGate(pack.paidCents, true).allowed, pack.id).toBe(true);
    }
  });

  it('lets an unverified account buy up to and including the threshold', () => {
    expect(purchaseGate(1, false).allowed).toBe(true);
    expect(purchaseGate(VERIFIED_PURCHASE_THRESHOLD_CENTS - 1, false).allowed).toBe(true);
    // Inclusive: $25 is allowed. The threshold is the largest purchase somebody
    // may make on an unproven address, not the smallest one they may not.
    expect(purchaseGate(VERIFIED_PURCHASE_THRESHOLD_CENTS, false).allowed).toBe(true);
  });

  it('refuses an unverified account one cent above it', () => {
    const gate = purchaseGate(VERIFIED_PURCHASE_THRESHOLD_CENTS + 1, false);
    expect(gate.allowed).toBe(false);
    expect(gate.allowed === false && gate.reason).toMatch(/confirm your email/i);
  });

  it('never blocks the first-lesson pack, which is the whole point of it', () => {
    const first = CREDIT_PACKS.find((pack) => pack.firstPurchaseOnly);
    expect(first).toBeDefined();
    expect(purchaseGate(first!.paidCents, false).allowed).toBe(true);
  });
});

describe('payoutGate', () => {
  it('needs a confirmed address', () => {
    expect(payoutGate(true).allowed).toBe(true);

    const gate = payoutGate(false);
    expect(gate.allowed).toBe(false);
    expect(gate.allowed === false && gate.reason).toMatch(/confirm your email/i);
  });
});
