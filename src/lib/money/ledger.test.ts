import { describe, expect, it } from 'vitest';
import { MoneyError } from './cents';
import {
  assertBalanced,
  assertUniqueKeys,
  balanceKey,
  bookingEscrowEntries,
  creditPurchaseEntries,
  payoutPaidEntries,
  payoutReleaseEntries,
  payoutRequestEntries,
  pendingToAvailableEntries,
  projectBalances,
  sumEntries,
  type LedgerEntryDraft,
} from './ledger';

describe('sumEntries and assertBalanced', () => {
  const balanced: LedgerEntryDraft[] = [
    { account: 'student_credits', ownerId: 'u1', deltaCents: -1_000, reason: 'r', idempotencyKey: 'a' },
    { account: 'escrow', ownerId: 'u1', deltaCents: 1_000, reason: 'r', idempotencyKey: 'b' },
  ];

  it('sums deltas', () => {
    expect(sumEntries(balanced)).toBe(0);
  });

  it('accepts a balanced group', () => {
    expect(() => assertBalanced(balanced)).not.toThrow();
  });

  it('rejects an unbalanced group', () => {
    expect(() =>
      assertBalanced([
        ...balanced,
        { account: 'escrow', ownerId: 'u1', deltaCents: 1, reason: 'r', idempotencyKey: 'c' },
      ]),
    ).toThrow(MoneyError);
  });

  it('rejects a float delta', () => {
    expect(() =>
      sumEntries([{ account: 'escrow', ownerId: 'u1', deltaCents: 0.5, reason: 'r', idempotencyKey: 'x' }]),
    ).toThrow(MoneyError);
  });
});

describe('assertUniqueKeys', () => {
  it('catches a duplicate idempotency key inside one group', () => {
    expect(() =>
      assertUniqueKeys([
        { account: 'escrow', ownerId: 'u1', deltaCents: 1, reason: 'r', idempotencyKey: 'same' },
        { account: 'escrow', ownerId: 'u1', deltaCents: -1, reason: 'r', idempotencyKey: 'same' },
      ]),
    ).toThrow(MoneyError);
  });
});

describe('projectBalances', () => {
  it('folds entries into per-account, per-owner balances', () => {
    const balances = projectBalances([
      { account: 'student_credits', ownerId: 'u1', deltaCents: 5_000, reason: 'r', idempotencyKey: '1' },
      { account: 'student_credits', ownerId: 'u1', deltaCents: -1_250, reason: 'r', idempotencyKey: '2' },
      { account: 'student_credits', ownerId: 'u2', deltaCents: 700, reason: 'r', idempotencyKey: '3' },
      { account: 'platform_revenue', ownerId: null, deltaCents: 250, reason: 'r', idempotencyKey: '4' },
    ]);
    expect(balances.get(balanceKey('student_credits', 'u1'))).toBe(3_750);
    expect(balances.get(balanceKey('student_credits', 'u2'))).toBe(700);
    expect(balances.get(balanceKey('platform_revenue', null))).toBe(250);
  });
});

describe('bookingEscrowEntries', () => {
  it('moves the price from the wallet into escrow', () => {
    const group = bookingEscrowEntries({ bookingId: 'bk1', studentId: 'u1', priceCents: 2_500 });
    expect(group.external).toBe(false);
    expect(sumEntries(group.entries)).toBe(0);
    expect(projectBalances(group.entries).get(balanceKey('student_credits', 'u1'))).toBe(-2_500);
    expect(projectBalances(group.entries).get(balanceKey('escrow', 'u1'))).toBe(2_500);
  });

  it('refuses a zero-price escrow — trials have no escrow row', () => {
    expect(() => bookingEscrowEntries({ bookingId: 'bk1', studentId: 'u1', priceCents: 0 })).toThrow(MoneyError);
  });
});

describe('pendingToAvailableEntries', () => {
  it('moves a settled share into the withdrawable balance', () => {
    const group = pendingToAvailableEntries({ bookingId: 'bk1', tutorId: 't1', amountCents: 2_000 });
    expect(sumEntries(group.entries)).toBe(0);
    expect(projectBalances(group.entries).get(balanceKey('tutor_pending', 't1'))).toBe(-2_000);
    expect(projectBalances(group.entries).get(balanceKey('tutor_available', 't1'))).toBe(2_000);
  });
});

describe('creditPurchaseEntries', () => {
  it('credits the wallet and is flagged external', () => {
    const group = creditPurchaseEntries({ purchaseId: 'p1', userId: 'u1', creditsCents: 2_600 });
    expect(group.external).toBe(true);
    expect(sumEntries(group.entries)).toBe(2_600);
    expect(group.entries[0]?.idempotencyKey).toBe('purchase:p1:credit');
  });
});

describe('payout lifecycle', () => {
  it('locks the amount on request', () => {
    const group = payoutRequestEntries({ payoutId: 'po1', tutorId: 't1', amountCents: 10_000 });
    expect(sumEntries(group.entries)).toBe(0);
    expect(projectBalances(group.entries).get(balanceKey('tutor_available', 't1'))).toBe(-10_000);
    expect(projectBalances(group.entries).get(balanceKey('payout_locked', 't1'))).toBe(10_000);
  });

  it('returns the amount when a payout is rejected', () => {
    const group = payoutReleaseEntries({ payoutId: 'po1', tutorId: 't1', amountCents: 10_000 });
    expect(sumEntries(group.entries)).toBe(0);
    expect(projectBalances(group.entries).get(balanceKey('tutor_available', 't1'))).toBe(10_000);
  });

  it('empties the lock when paid, and books any fee as revenue', () => {
    const free = payoutPaidEntries({ payoutId: 'po1', tutorId: 't1', amountCents: 10_000, feeCents: 0 });
    expect(free.external).toBe(true);
    expect(free.entries).toHaveLength(1);
    expect(sumEntries(free.entries)).toBe(-10_000);

    const withFee = payoutPaidEntries({ payoutId: 'po2', tutorId: 't1', amountCents: 10_000, feeCents: 250 });
    expect(withFee.entries).toHaveLength(2);
    expect(projectBalances(withFee.entries).get(balanceKey('platform_revenue', null))).toBe(250);
  });

  it('rejects a fee larger than the payout', () => {
    expect(() =>
      payoutPaidEntries({ payoutId: 'po1', tutorId: 't1', amountCents: 100, feeCents: 101 }),
    ).toThrow(MoneyError);
  });

  it('round-trips a request and release back to nothing', () => {
    const entries = [
      ...payoutRequestEntries({ payoutId: 'po1', tutorId: 't1', amountCents: 10_000 }).entries,
      ...payoutReleaseEntries({ payoutId: 'po1', tutorId: 't1', amountCents: 10_000 }).entries,
    ];
    assertUniqueKeys(entries);
    const balances = projectBalances(entries);
    expect(balances.get(balanceKey('tutor_available', 't1'))).toBe(0);
    expect(balances.get(balanceKey('payout_locked', 't1'))).toBe(0);
  });
});
