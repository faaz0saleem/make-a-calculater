/**
 * The ledger (SPEC.md §12).
 *
 * `ledger_entries` is append-only and is the single source of truth for every
 * balance in the system. The materialised columns (`student_wallets.credits_cents`,
 * `tutor_profiles.available_cents`, and so on) exist only so the UI does not have
 * to sum a growing table on every page load, and a nightly job asserts they still
 * equal the ledger.
 *
 * This module is pure: it builds and checks entry drafts. Writing them to
 * Postgres and reconciling against the materialised columns lives in
 * `src/db/ledger.ts`, which imports from here.
 *
 * Balancing rule. Internal movements — a booking's escrow, a settlement, a payout
 * request — must sum to zero across accounts. Two groups are deliberately
 * single-sided because value crosses the system boundary:
 *
 *   - a credit purchase brings money in from the payment provider
 *   - a paid-out payout sends money out to a tutor's bank
 *
 * Those are marked with `external: true` on the group so nothing accidentally
 * asserts them to zero.
 */

import { assertInt, assertPositiveInt, MoneyError } from './cents';

export const LEDGER_ACCOUNTS = [
  'student_credits',
  'escrow',
  'tutor_pending',
  'tutor_available',
  'platform_revenue',
  'payout_locked',
] as const;

export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number];

export type LedgerEntryDraft = {
  account: LedgerAccount;
  /**
   * The user the balance belongs to. Null for `platform_revenue`, which belongs
   * to the business rather than to any user.
   */
  ownerId: string | null;
  deltaCents: number;
  reason: string;
  /** Unique across the table. Replaying the same event is a no-op. */
  idempotencyKey: string;
  bookingId?: string | null;
  payoutId?: string | null;
  purchaseId?: string | null;
};

export type LedgerGroup = {
  entries: LedgerEntryDraft[];
  /** True when value legitimately enters or leaves the system. */
  external: boolean;
};

export function sumEntries(entries: readonly LedgerEntryDraft[]): number {
  return entries.reduce((total, entry) => total + assertInt(entry.deltaCents, 'deltaCents'), 0);
}

/** Throws unless the entries net to zero. Internal transfers must balance. */
export function assertBalanced(entries: readonly LedgerEntryDraft[], label = 'ledger group'): void {
  const total = sumEntries(entries);
  if (total !== 0) {
    throw new MoneyError(`${label} does not balance: net ${total} cents across ${entries.length} entries`);
  }
}

/** Throws if two entries in the same group share an idempotency key. */
export function assertUniqueKeys(entries: readonly LedgerEntryDraft[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.idempotencyKey)) {
      throw new MoneyError(`duplicate idempotency key in group: ${entry.idempotencyKey}`);
    }
    seen.add(entry.idempotencyKey);
  }
}

export type BalanceKey = `${LedgerAccount}:${string}`;

export function balanceKey(account: LedgerAccount, ownerId: string | null): BalanceKey {
  return `${account}:${ownerId ?? 'platform'}`;
}

/**
 * Fold entries into per-account, per-owner balances. This is what reconciliation
 * compares the materialised columns against.
 */
export function projectBalances(entries: readonly LedgerEntryDraft[]): Map<BalanceKey, number> {
  const balances = new Map<BalanceKey, number>();
  for (const entry of entries) {
    const key = balanceKey(entry.account, entry.ownerId);
    balances.set(key, (balances.get(key) ?? 0) + assertInt(entry.deltaCents, 'deltaCents'));
  }
  return balances;
}

// ---------------------------------------------------------------------------
// Entry builders
//
// Every money movement in the product is one of these. Nothing else may write
// to `ledger_entries`.
// ---------------------------------------------------------------------------

/**
 * Booking created: credits leave the student's wallet and sit in escrow until
 * the dispute window closes.
 */
export function bookingEscrowEntries(params: {
  bookingId: string;
  studentId: string;
  priceCents: number;
}): LedgerGroup {
  assertPositiveInt(params.priceCents, 'priceCents');
  const entries: LedgerEntryDraft[] = [
    {
      account: 'student_credits',
      ownerId: params.studentId,
      deltaCents: -params.priceCents,
      reason: 'booking_created',
      idempotencyKey: `booking:${params.bookingId}:debit`,
      bookingId: params.bookingId,
    },
    {
      account: 'escrow',
      ownerId: params.studentId,
      deltaCents: params.priceCents,
      reason: 'booking_created',
      idempotencyKey: `booking:${params.bookingId}:escrow`,
      bookingId: params.bookingId,
    },
  ];
  assertBalanced(entries, 'booking escrow');
  return { entries, external: false };
}

/**
 * Hold period elapsed: the tutor's settled share becomes withdrawable.
 * The hold is currently zero hours, so this runs immediately after settlement.
 */
export function pendingToAvailableEntries(params: {
  bookingId: string;
  tutorId: string;
  amountCents: number;
}): LedgerGroup {
  assertPositiveInt(params.amountCents, 'amountCents');
  const entries: LedgerEntryDraft[] = [
    {
      account: 'tutor_pending',
      ownerId: params.tutorId,
      deltaCents: -params.amountCents,
      reason: 'hold_released',
      idempotencyKey: `booking:${params.bookingId}:release:pending`,
      bookingId: params.bookingId,
    },
    {
      account: 'tutor_available',
      ownerId: params.tutorId,
      deltaCents: params.amountCents,
      reason: 'hold_released',
      idempotencyKey: `booking:${params.bookingId}:release:available`,
      bookingId: params.bookingId,
    },
  ];
  assertBalanced(entries, 'pending to available');
  return { entries, external: false };
}

/**
 * A credit purchase settled with the payment provider. Single-sided: this is
 * new value entering the system.
 */
export function creditPurchaseEntries(params: {
  purchaseId: string;
  userId: string;
  creditsCents: number;
}): LedgerGroup {
  assertPositiveInt(params.creditsCents, 'creditsCents');
  return {
    external: true,
    entries: [
      {
        account: 'student_credits',
        ownerId: params.userId,
        deltaCents: params.creditsCents,
        reason: 'credit_purchase',
        idempotencyKey: `purchase:${params.purchaseId}:credit`,
        purchaseId: params.purchaseId,
      },
    ],
  };
}

/**
 * Payout requested: the amount moves out of `available` so it cannot be spent
 * or requested twice while an admin looks at it.
 */
export function payoutRequestEntries(params: {
  payoutId: string;
  tutorId: string;
  amountCents: number;
}): LedgerGroup {
  assertPositiveInt(params.amountCents, 'amountCents');
  const entries: LedgerEntryDraft[] = [
    {
      account: 'tutor_available',
      ownerId: params.tutorId,
      deltaCents: -params.amountCents,
      reason: 'payout_requested',
      idempotencyKey: `payout:${params.payoutId}:lock:available`,
      payoutId: params.payoutId,
    },
    {
      account: 'payout_locked',
      ownerId: params.tutorId,
      deltaCents: params.amountCents,
      reason: 'payout_requested',
      idempotencyKey: `payout:${params.payoutId}:lock:locked`,
      payoutId: params.payoutId,
    },
  ];
  assertBalanced(entries, 'payout request');
  return { entries, external: false };
}

/** Payout rejected or cancelled: the locked amount goes back to available. */
export function payoutReleaseEntries(params: {
  payoutId: string;
  tutorId: string;
  amountCents: number;
}): LedgerGroup {
  assertPositiveInt(params.amountCents, 'amountCents');
  const entries: LedgerEntryDraft[] = [
    {
      account: 'payout_locked',
      ownerId: params.tutorId,
      deltaCents: -params.amountCents,
      reason: 'payout_released',
      idempotencyKey: `payout:${params.payoutId}:release:locked`,
      payoutId: params.payoutId,
    },
    {
      account: 'tutor_available',
      ownerId: params.tutorId,
      deltaCents: params.amountCents,
      reason: 'payout_released',
      idempotencyKey: `payout:${params.payoutId}:release:available`,
      payoutId: params.payoutId,
    },
  ];
  assertBalanced(entries, 'payout release');
  return { entries, external: false };
}

/**
 * Payout marked paid by an admin. Single-sided: the money has left for a bank.
 * Any payout fee is platform revenue, so that part stays inside the system.
 */
export function payoutPaidEntries(params: {
  payoutId: string;
  tutorId: string;
  amountCents: number;
  feeCents: number;
}): LedgerGroup {
  assertPositiveInt(params.amountCents, 'amountCents');
  assertInt(params.feeCents, 'feeCents');
  if (params.feeCents < 0 || params.feeCents > params.amountCents) {
    throw new MoneyError(`payout fee ${params.feeCents} must be between 0 and ${params.amountCents}`);
  }

  const entries: LedgerEntryDraft[] = [
    {
      account: 'payout_locked',
      ownerId: params.tutorId,
      deltaCents: -params.amountCents,
      reason: 'payout_paid',
      idempotencyKey: `payout:${params.payoutId}:paid:locked`,
      payoutId: params.payoutId,
    },
  ];

  if (params.feeCents > 0) {
    entries.push({
      account: 'platform_revenue',
      ownerId: null,
      deltaCents: params.feeCents,
      reason: 'payout_fee',
      idempotencyKey: `payout:${params.payoutId}:paid:fee`,
      payoutId: params.payoutId,
    });
  }

  return { entries, external: true };
}
