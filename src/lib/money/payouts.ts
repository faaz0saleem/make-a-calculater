/**
 * Payout rules (SPEC.md §2).
 *
 * A tutor may request a payout once their available balance reaches $100, and
 * may request any amount between the threshold and their whole balance. The
 * requested amount is locked immediately so it cannot be spent or requested twice.
 */

import { assertNonNegativeInt, formatCents } from './cents';

export const PAYOUT_THRESHOLD_CENTS = 10_000; // $100.00
export const DEFAULT_PAYOUT_FEE_CENTS = 0;

export const PAYOUT_STATUSES = ['requested', 'approved', 'processing', 'paid', 'rejected'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

const PAYOUT_TRANSITIONS: Record<PayoutStatus, readonly PayoutStatus[]> = {
  requested: ['approved', 'rejected'],
  approved: ['processing', 'rejected'],
  processing: ['paid', 'rejected'],
  paid: [],
  rejected: [],
};

export function canTransitionPayout(from: PayoutStatus, to: PayoutStatus): boolean {
  return PAYOUT_TRANSITIONS[from].includes(to);
}

export type PayoutEligibility = { ok: true } | { ok: false; reason: string };

export function canRequestPayout(availableCents: number, amountCents: number): PayoutEligibility {
  assertNonNegativeInt(availableCents, 'availableCents');
  assertNonNegativeInt(amountCents, 'amountCents');

  if (availableCents < PAYOUT_THRESHOLD_CENTS) {
    return {
      ok: false,
      reason: `You need at least ${formatCents(PAYOUT_THRESHOLD_CENTS)} available to request a payout. You have ${formatCents(availableCents)}.`,
    };
  }
  if (amountCents < PAYOUT_THRESHOLD_CENTS) {
    return {
      ok: false,
      reason: `The smallest payout is ${formatCents(PAYOUT_THRESHOLD_CENTS)}.`,
    };
  }
  if (amountCents > availableCents) {
    return {
      ok: false,
      reason: `You asked for ${formatCents(amountCents)} but only ${formatCents(availableCents)} is available.`,
    };
  }
  return { ok: true };
}

/** What actually lands in the tutor's bank after the flat payout fee. */
export function netPayoutCents(amountCents: number, feeCents = DEFAULT_PAYOUT_FEE_CENTS): number {
  assertNonNegativeInt(amountCents, 'amountCents');
  assertNonNegativeInt(feeCents, 'feeCents');
  return Math.max(0, amountCents - feeCents);
}
